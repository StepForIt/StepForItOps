'use client';

import React from 'react';
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Empty,
  Popconfirm,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { Markdown } from './markdown';
import { ProposalReviewModal } from './proposal-review-modal';
import { ChatMemory } from './chat-memory';
import { ChatLeftover } from './proposal-review-modal';
import { ChatToolTrace, ThinkingStep, ToolTraceStep } from './chat-tool-trace';
import { ChatTurnProgress } from './chat-turn-progress';
import {
  ACCEPT_ATTR,
  MessageAttachment,
  MessageAttachments,
  PendingAttachmentStrip,
  useChatAttachments,
} from './chat-attachments';
import { ChatGhostInput } from './chat-ghost-input';
import { useWorkflowChat } from './workflow-chat-drawer';
import { BRAND } from '../lib/brand/colors';
import { COMMON_PHRASE_KEYS, CompletionSources, withCommonPhrases } from '../lib/chat-completion';

/** État d'une modification proposée, calculé par l'API (`proposalState`). */
type ProposalState = 'pending' | 'stale' | 'applied' | 'discarded';

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  /** État le plus actionnable des propositions du fil (calculé par l'API). */
  proposalSummary?: { state: ProposalState; count: number } | null;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  proposalId?: string | null;
  /** Outils appelés pour produire cette réponse ; replié par défaut à l'affichage. */
  toolTrace?: ToolTraceStep[] | null;
  /** Résumé du raisonnement du modèle, dans le même repli que les outils. */
  thinking?: ThinkingStep[] | null;
  attachments?: MessageAttachment[];
  createdAt: string;
}

interface ProposalRef {
  id: string;
  summary: string;
  state: ProposalState;
  appliedAt: string | null;
}

interface SessionDetail extends ChatSession {
  messages: ChatMessage[];
  /** Demande enregistrée à laquelle rien n'a répondu : le tour s'est perdu. */
  unanswered?: { messageId: string; createdAt: string } | null;
  proposals?: ProposalRef[];
}

/**
 * Ce que devient une proposition dans le fil. Sans ces états, une conversation de
 * dix tours affichait dix fois « modification proposée » : impossible de voir d'un
 * coup d'œil laquelle est partie en production, laquelle a été refusée, et
 * laquelle ne s'applique plus au workflow d'aujourd'hui.
 */
const PROPOSAL_BADGE_COLOR: Record<ProposalState, string> = {
  pending: 'gold',
  stale: 'orange',
  applied: 'green',
  discarded: 'default',
};

/**
 * Ce que rend l'envoi. `cancelled` : le tour a été arrêté, rien n'a été écrit —
 * ni la réponse ni la demande — et le texte revient pour être repris.
 */
interface SendResult {
  cancelled?: { content: string };
}

interface ChatExport {
  filename: string;
  markdown: string;
}

/** Le Markdown est construit côté API : le front ne fait que poser le fichier sur le disque. */
async function downloadExport(path: string) {
  const { filename, markdown } = await apiGet<ChatExport>(path);
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Libellé et demande envoyée à l'IA, traduits au rendu (`chat.panel.suggestions.<clé>`). */
const SUGGESTIONS = ['explain', 'fragility', 'annotate'] as const;

/** Message utilisateur : texte brut. Réponse IA : Markdown interprété. */
function MessageBody({ role, content }: { role: string; content: string }) {
  if (role === 'user') return <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>;
  return <Markdown content={content} />;
}

/** Chat IA porté sur un workflow : questions, et propositions de modification à revoir en diff. */
export function WorkflowChatPanel({
  workflowId,
  initialSessionId,
  onWorkflowChanged,
}: {
  workflowId: string;
  /** Conversation à ouvrir d'emblée (correctif qu'on vient de demander) ; sinon la plus récente. */
  initialSessionId?: string;
  onWorkflowChanged?: () => void;
}) {
  const t = useTranslations('chat.panel');
  const tPhrases = useTranslations('chat.commonPhrases');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [sessions, setSessions] = React.useState<ChatSession[]>([]);
  const [leftovers, setLeftovers] = React.useState<ChatLeftover[]>([]);
  const [removingLeftover, setRemovingLeftover] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<SessionDetail | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  /** Arrêt demandé : le bouton ne doit pas rester cliquable pendant que le tour se referme. */
  const [stopping, setStopping] = React.useState(false);
  /** De quoi compléter la frappe (demandes déjà écrites, noms de nœuds) ; lu une fois. */
  const [completions, setCompletions] = React.useState<CompletionSources>({ phrases: [], nodeNames: [] });
  const [unavailable, setUnavailable] = React.useState<string | null>(null);
  const [reviewing, setReviewing] = React.useState<string | null>(null);
  /** État de chaque proposition du fil, par id — relu à chaque rechargement de la conversation. */
  const proposalStates = React.useMemo(
    () => new Map((session?.proposals ?? []).map((proposal) => [proposal.id, proposal.state])),
    [session],
  );
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const attachments = useChatAttachments();
  // Le catalogue de demandes courantes suit la langue affichée : c'est un texte
  // que l'humain enverra à l'IA tel quel.
  const completionSources = React.useMemo(
    () =>
      withCommonPhrases(
        completions,
        COMMON_PHRASE_KEYS.map((key) => tPhrases(key)),
      ),
    [completions, tPhrases],
  );

  // Le tiroir qui héberge ce panneau le DÉTRUIT à la fermeture : sans ce signal,
  // il ne saurait pas qu'il y a une saisie à perdre. Hors tiroir (page `view`),
  // le contexte est absent et l'appel ne fait rien.
  const { setDirty } = useWorkflowChat();
  const hasDraft = draft.trim().length > 0 || attachments.count > 0;
  React.useEffect(() => {
    setDirty(hasDraft);
    return () => setDirty(false);
  }, [hasDraft, setDirty]);

  const openSession = React.useCallback(async (sessionId: string) => {
    const detail = await apiGet<SessionDetail>(`/workflow-chat/sessions/${sessionId}`);
    setSession(detail);
  }, []);

  const newSession = React.useCallback(async () => {
    const created = await apiPost<ChatSession>(`/workflow-chat/workflows/${workflowId}/sessions`);
    setSessions((previous) => [created, ...previous]);
    setSession({ ...created, messages: [] });
    return created;
  }, [workflowId]);

  /**
   * Sous-workflows créés par l'assistant et restés vides. Relus après chaque
   * tour : un tour qui crée le workflow puis échoue à proposer ne laisse aucune
   * revue à ouvrir, donc aucun autre endroit où ce reste se verrait.
   */
  const reloadLeftovers = React.useCallback(
    () =>
      apiGet<ChatLeftover[]>(`/workflow-chat/workflows/${workflowId}/leftovers`)
        .then(setLeftovers)
        .catch(() => undefined),
    [workflowId],
  );

  /** Relit la liste : les badges de propositions y changent à chaque décision. */
  const reloadSessions = React.useCallback(
    () =>
      apiGet<ChatSession[]>(`/workflow-chat/workflows/${workflowId}/sessions`)
        .then(setSessions)
        .catch(() => undefined),
    [workflowId],
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiGet<ChatSession[]>(`/workflow-chat/workflows/${workflowId}/sessions`);
        if (cancelled) return;
        setSessions(list);
        const wanted =
          initialSessionId && list.some((s) => s.id === initialSessionId) ? initialSessionId : list[0]?.id;
        if (wanted) await openSession(wanted);
        else await newSession();
      } catch (error) {
        if (!cancelled) setUnavailable((error as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowId, initialSessionId, openSession, newSession]);

  // Aide à la frappe : une absence de sources n'est pas une panne, la saisie
  // marche sans elle — d'où l'échec avalé.
  React.useEffect(() => {
    void reloadLeftovers();
  }, [reloadLeftovers]);

  React.useEffect(() => {
    apiGet<CompletionSources>(`/workflow-chat/workflows/${workflowId}/completions`)
      .then(setCompletions)
      .catch(() => undefined);
  }, [workflowId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, sending]);

  const send = async (text: string) => {
    const content = text.trim();
    const joined = attachments.payload();
    const attached = { images: attachments.images, files: attachments.files };
    // Une pièce jointe seule suffit : c'est le geste courant (copie d'écran d'un
    // nœud en erreur collée sans un mot, export lâché dans la zone). Le texte
    // affiché est alors celui que l'API enregistrera, pour que l'envoi
    // optimiste ne mente pas.
    if ((!content && attachments.count === 0) || !session || sending) return;
    setSending(true);
    setDraft('');
    attachments.clear();
    // Affichage optimiste : la réponse IA peut prendre plusieurs secondes.
    const pending: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      // Une pièce jointe seule est une demande valable : l'API pose alors la même question, dans la même langue.
      content: content || t(attached.files.length > 0 ? 'fileOnlyRequest' : 'imageOnlyRequest'),
      createdAt: new Date().toISOString(),
    };
    setSession((previous) =>
      previous ? { ...previous, messages: [...previous.messages, pending] } : previous,
    );
    try {
      const result = await apiPost<SendResult>(`/workflow-chat/sessions/${session.id}/messages`, {
        content,
        ...joined,
      });
      // Tour arrêté : la demande n'a jamais été enregistrée côté API. On la rend
      // entière — texte ET pièces jointes — plutôt que de laisser reconstituer
      // de mémoire ce qu'on vient tout juste d'écrire.
      if (result?.cancelled) {
        setSession((previous) =>
          previous
            ? { ...previous, messages: previous.messages.filter((m) => m.id !== pending.id) }
            : previous,
        );
        setDraft(result.cancelled.content || content);
        attachments.restore(attached);
        return;
      }
      await openSession(session.id);
      const list = await apiGet<ChatSession[]>(`/workflow-chat/workflows/${workflowId}/sessions`);
      setSessions(list);
      await reloadLeftovers();
    } catch (error) {
      message.error((error as Error).message);
      setSession((previous) =>
        previous ? { ...previous, messages: previous.messages.filter((m) => m.id !== pending.id) } : previous,
      );
      setDraft(content);
      attachments.restore(attached);
    } finally {
      setSending(false);
      setStopping(false);
    }
  };

  /**
   * Arrête le tour en cours. C'est l'envoi lui-même, toujours en attente, qui
   * rendra la demande à la saisie : cette route ne fait que lever la main.
   */
  const stop = async () => {
    if (!sending || stopping) return;
    setStopping(true);
    try {
      const { stopped } = await apiPost<{ stopped: boolean }>(
        `/workflow-chat/sessions/${session!.id}/cancel`,
      );
      // Un tour introuvable ici tourne peut-être ailleurs (API redémarrée, autre
      // réplique) : il ira au bout, et le dire vaut mieux qu'un bouton muet.
      if (!stopped) {
        message.info(t('stopFailed'));
        setStopping(false);
      }
    } catch (error) {
      message.error((error as Error).message);
      setStopping(false);
    }
  };

  /**
   * Échap arrête le tour, comme le bouton — c'est le geste qu'on a déjà dans les
   * doigts, et pendant un tour la saisie est désactivée : aucune autre touche
   * n'a de sens.
   *
   * Écouté en CAPTURE sur le document, propagation coupée : le tiroir qui
   * héberge le chat se ferme lui aussi sur Échap, et fermer l'écran au lieu
   * d'arrêter laisserait le tour courir hors de vue — exactement le contraire de
   * ce qu'on demande. La capture au document précède le panneau du tiroir.
   */
  const stopRef = React.useRef(stop);
  stopRef.current = stop;
  React.useEffect(() => {
    if (!sending) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      void stopRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [sending]);

  /**
   * Relance la demande restée sans réponse. C'est le rattrapage de l'échec dont
   * personne ne revient — process tombé, requête coupée : aucun message d'erreur
   * n'a pu être écrit, seule l'absence de réponse en témoigne.
   */
  const retryLast = async () => {
    if (!session || sending) return;
    setSending(true);
    try {
      await apiPost(`/workflow-chat/sessions/${session.id}/retry`);
      await openSession(session.id);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  const exportConversations = async (path: string) => {
    try {
      await downloadExport(path);
    } catch (error) {
      message.error(t('exportFailed', { error: (error as Error).message }));
    }
  };

  const removeSession = async (sessionId: string) => {
    await apiDelete(`/workflow-chat/sessions/${sessionId}`);
    const list = sessions.filter((item) => item.id !== sessionId);
    setSessions(list);
    if (list.length > 0) await openSession(list[0].id);
    else await newSession();
  };

  if (unavailable) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t('unavailable.title')}
        description={t.rich('unavailable.description', {
          b: (chunks) => <b>{chunks}</b>,
          detail: unavailable,
        })}
      />
    );
  }

  return (
    <Card
      size="small"
      styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%', padding: 12 } }}
      style={{ height: '100%' }}
      title={
        <Space wrap>
          <Select
            size="small"
            style={{ minWidth: 220 }}
            value={session?.id}
            onChange={(value) => openSession(value)}
            // Le badge est DANS l'option : un fil qui a laissé une modification à
            // revoir se repère sans l'ouvrir un par un.
            options={sessions.map((item) => ({
              value: item.id,
              label: (
                <Space size={4}>
                  <span>{item.title}</span>
                  {item.proposalSummary && (
                    <Tag
                      color={PROPOSAL_BADGE_COLOR[item.proposalSummary.state]}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {t('sessionBadge', {
                        state: item.proposalSummary.state,
                        count: item.proposalSummary.count,
                      })}
                    </Tag>
                  )}
                </Space>
              ),
            }))}
          />
          <Button size="small" icon={<PlusOutlined />} onClick={() => newSession()}>
            {t('newSession')}
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: 'session', label: t('export.session'), disabled: !session },
                { key: 'all', label: t('export.all') },
              ],
              onClick: ({ key }) =>
                exportConversations(
                  key === 'all'
                    ? `/workflow-chat/workflows/${workflowId}/export`
                    : `/workflow-chat/sessions/${session!.id}/export`,
                ),
            }}
          >
            <Button size="small" icon={<DownloadOutlined />}>
              {t('export.button')}
            </Button>
          </Dropdown>
          {session && (
            <Popconfirm
              title={t('deleteSession')}
              onConfirm={() => removeSession(session.id)}
              okText={tCommon('delete')}
              cancelText={tCommon('cancel')}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      }
    >
      {session?.unanswered && !sending && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('unanswered', {
            date: new Date(session.unanswered.createdAt).toLocaleString(locale),
          })}
          action={
            <Button size="small" type="primary" onClick={retryLast}>
              {t('retry')}
            </Button>
          }
        />
      )}

      {leftovers.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('leftovers.title', { count: leftovers.length })}
          description={
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {leftovers.map((leftover) => (
                <Space key={leftover.workflowId} wrap>
                  <Typography.Link href={leftover.url} target="_blank" rel="noreferrer">
                    {leftover.name}
                  </Typography.Link>
                  <Popconfirm
                    title={t('leftovers.confirmTitle')}
                    description={t('leftovers.confirmDescription')}
                    okText={tCommon('delete')}
                    cancelText={tCommon('cancel')}
                    onConfirm={async () => {
                      setRemovingLeftover(leftover.workflowId);
                      try {
                        await apiDelete(`/workflow-chat/leftovers/${leftover.workflowId}`);
                        await reloadLeftovers();
                      } catch (error) {
                        message.error((error as Error).message);
                      } finally {
                        setRemovingLeftover(null);
                      }
                    }}
                  >
                    <Button size="small" danger loading={removingLeftover === leftover.workflowId}>
                      {t('leftovers.delete')}
                    </Button>
                  </Popconfirm>
                </Space>
              ))}
            </Space>
          }
        />
      )}

      <ChatMemory workflowId={workflowId} />

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
        {session && session.messages.length === 0 && !sending && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('empty')}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {SUGGESTIONS.map((suggestion) => (
                <Tooltip key={suggestion} title={t(`suggestions.${suggestion}.prompt`)} placement="right">
                  <Button size="small" onClick={() => send(t(`suggestions.${suggestion}.prompt`))}>
                    {t(`suggestions.${suggestion}.label`)}
                  </Button>
                </Tooltip>
              ))}
            </Space>
          </Empty>
        )}

        {session?.messages.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                maxWidth: '88%',
                background: item.role === 'user' ? BRAND.primarySoft : BRAND.papier,
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 13,
              }}
            >
              <MessageAttachments attachments={item.attachments ?? []} />
              <MessageBody role={item.role} content={item.content} />
              {((item.toolTrace?.length ?? 0) > 0 || (item.thinking?.length ?? 0) > 0) && (
                <ChatToolTrace steps={item.toolTrace ?? []} thinking={item.thinking ?? []} />
              )}
              {item.proposalId &&
                (() => {
                  // Proposition inconnue du lot (fil d'avant ce champ) : on retombe
                  // sur « à revoir », l'état qu'elle avait toujours affiché.
                  const state = proposalStates.get(item.proposalId) ?? 'pending';
                  const decided = state === 'applied' || state === 'discarded';
                  return (
                    <div style={{ marginTop: 8 }}>
                      <Space>
                        <Tooltip title={t(`proposalHint.${state}`)}>
                          <Tag color={PROPOSAL_BADGE_COLOR[state]}>{t('proposalTag', { state })}</Tag>
                        </Tooltip>
                        <Button
                          size="small"
                          type={decided ? 'default' : 'primary'}
                          onClick={() => setReviewing(item.proposalId!)}
                        >
                          {decided ? t('seeDiff') : t('reviewDiff')}
                        </Button>
                      </Space>
                    </div>
                  );
                })()}
            </div>
          </div>
        ))}

        {sending && session && <ChatTurnProgress sessionId={session.id} />}
        <div ref={bottomRef} />
      </div>

      <Space.Compact style={{ marginTop: 8, width: '100%' }}>
        <ChatGhostInput
          value={draft}
          onChange={setDraft}
          onSubmit={() => send(draft)}
          sources={completionSources}
          disabled={sending || !session}
          onFiles={(files) => attachments.add(files)}
          placeholder={t('placeholder')}
        />
        <Tooltip title={t('attachTooltip')}>
          <Button
            icon={<PaperClipOutlined />}
            disabled={sending || !session}
            onClick={() => fileInput.current?.click()}
          />
        </Tooltip>
        {sending ? (
          // Le bouton d'envoi CÈDE la place à l'arrêt, il ne s'y ajoute pas : ce
          // qu'on peut faire pendant un tour, c'est l'arrêter, rien d'autre.
          <Tooltip title={t('stopTooltip')}>
            <Button danger icon={<StopOutlined />} loading={stopping} onClick={stop}>
              {t('stop')}
            </Button>
          </Tooltip>
        ) : (
          <Tooltip title={t('sendTooltip')}>
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={(!draft.trim() && attachments.count === 0) || !session}
              onClick={() => send(draft)}
            />
          </Tooltip>
        )}
      </Space.Compact>

      <PendingAttachmentStrip
        images={attachments.images}
        files={attachments.files}
        onRemove={attachments.remove}
      />

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          attachments.add(Array.from(event.target.files ?? []));
          // Sans ce reset, re-choisir le même fichier après l'avoir retiré ne déclenche rien.
          event.target.value = '';
        }}
      />

      <ProposalReviewModal
        proposalId={reviewing}
        onClose={() => setReviewing(null)}
        onResolved={() => {
          onWorkflowChanged?.();
          reloadSessions();
          if (session) openSession(session.id);
        }}
      />
    </Card>
  );
}
