'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useOne } from '@refinedev/core';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  FloatButton,
  Input,
  InputNumber,
  Popover,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleTwoTone,
  SettingOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  ExportOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { apiGet, apiPatch, apiPost } from '../../../../lib/api';
import { useInstanceScope } from '../../../../lib/instance-scope';
import { Markdown } from '../../../../components/markdown';
import { MermaidView } from '../../../../components/mermaid-view';
import { RenameSuggestionsModal } from '../../../../components/rename-suggestions-modal';
import { ExecutionSamplesPanel } from '../../../../components/execution-samples-panel';
import { RemoteSchemaModal } from '../../../../components/remote-schema-modal';
import { useEnabledModules } from '../../../../lib/enabled-modules';
import { WorkflowJsonModal } from '../../../../components/workflow-json-modal';
import { PromoteModal } from './promote-modal';
import { PublishRunBanner, PublishRunView } from './publish-run';
import { EnvAssistantModal } from './env-assistant-modal';
import { MockTestModal } from './mock-test-modal';
import { TestCasesCard } from './test-cases-card';
import { EnvLinks } from './env-links';
import { GroupLinks } from './group-links';
import { GroupDuplicateModal } from '../../../../components/group-duplicate-modal';
import { WorkflowActionId, WorkflowRow } from '../../workflow-row';
import { useIsMobile } from '../../../../components/mobile/use-is-mobile';
import { useSwipeOpen } from '../../../../components/mobile/use-swipe-open';
import { ActionBar } from '../../../../components/action-bar';
import { WorkflowLockTag, useLockAction } from '../../../../components/workflow-lock';
import {
  WorkflowGraph,
  WorkflowNodes,
  countNodes,
  useWorkflowStructure,
} from '../../../../components/workflow-structure';
import { FindingsList } from '../../../../components/findings-list';
import {
  CheckSelectionModal,
  useCheckCatalog,
  useResolvedChecks,
} from '../../../../components/check-selection-modal';
import { useWorkflowChat } from '../../../../components/workflow-chat-drawer';
import { useEnvColor } from '../../../../lib/envs';

interface Finding {
  id: string;
  module: string;
  severity: string;
  code: string;
  message: string;
  nodeName?: string;
  /** Détail libre de la règle : correctif proposé et position dans le code du nœud. */
  data?: {
    suggestion?: string;
    line?: number;
    snippet?: string;
    snippetStart?: number;
    autoFix?: boolean;
  } | null;
}

/** Étapes de « Vérifier », dans l'ordre où elles sont jouées. */
const VERIFY_STEPS: Array<{ key: string; label: string; path: (id: string) => string }> = [
  { key: 'structure', label: 'Structure', path: (id) => `/verifier/run/${id}?ai=1` },
  { key: 'js', label: 'JS', path: (id) => `/js-checker/run/${id}?ai=1` },
  { key: 'naming', label: 'Naming', path: (id) => `/optimizer/analyze/${id}` },
  { key: 'champs', label: 'Champs', path: (id) => `/field-checker/run/${id}` },
];

type StepStatus = 'pending' | 'running' | 'done' | 'skipped';

const stepIcon: Record<StepStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined style={{ color: '#bfbfbf' }} />,
  running: <LoadingOutlined />,
  done: <CheckCircleTwoTone twoToneColor="#52c41a" />,
  skipped: <MinusCircleOutlined style={{ color: '#bfbfbf' }} />,
};

interface CurrentEnv {
  env: string | null;
  mixed: boolean;
  counts: Record<string, number>;
}

/** Le temps gagné retenu pour le ROI et l'estimation qui le remplit par défaut. */
interface TimeSavedView {
  minutes: number | null;
  estimated: boolean;
  estimate: { minutes: number; why: string | null; source: string | null } | null;
}

/** Coût IA du workflow (miroir de workflowSummary côté module ai-cost). */
interface AiCost {
  days: number;
  costUsd: number;
  calls: number;
  executions: number;
  unpricedCalls: number;
}

export default function WorkflowShow() {
  const mobile = useIsMobile();
  const envColor = useEnvColor();
  const params = useParams<{ id: string }>();
  const workflowId = params.id;
  // Le schéma et l'inventaire ne se chargent qu'à l'ouverture de leur onglet : la
  // fiche s'affiche sans attendre un schéma qu'on ne regarde pas à chaque visite.
  // `?tab=` ouvre directement un onglet : c'est ce que vise un lien vers l'ancienne
  // page de vue, et ce qu'on partage quand on veut montrer un schéma.
  const requestedTab = useSearchParams().get('tab');
  const [tab, setTab] = React.useState(requestedTab ?? 'graph');
  const structure = useWorkflowStructure(workflowId, tab === 'graph' || tab === 'nodes');
  // La doc se lit en ouvrant son onglet : « Voir doc » était un bouton pour
  // aller chercher ce que l'onglet montre déjà.
  const docTabOpened = React.useRef(false);
  React.useEffect(() => {
    if (tab !== 'doc' || docTabOpened.current) return;
    docTabOpened.current = true;
    void loadDoc();
    // `loadDoc` se refait à chaque rendu ; c'est l'ouverture de l'onglet qui compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const { data, isLoading, refetch } = useOne({ resource: 'workflows', id: workflowId });
  const workflow = data?.data as WorkflowRow | undefined;
  /**
   * Un bouton n'est proposé que si la plateforme du workflow le permet. Le calcul
   * vient de l'API (`workflow.actions`) : le web ne connaît pas les plateformes,
   * et deux tables de vérité divergeraient au premier module porté. Tant que la
   * fiche charge, on suppose disponible — sinon la barre clignote au chargement.
   */
  const can = (action: WorkflowActionId): boolean => workflow?.actions?.[action]?.available !== false;
  const unavailable = Object.entries(workflow?.actions ?? {})
    .filter(([, state]) => !state.available)
    .map(([, state]) => state.why)
    .filter((why): why is string => Boolean(why));

  const [findings, setFindings] = useState<Finding[]>([]);
  const [doc, setDoc] = useState<{ mermaid: string; summary?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  /** Env visé par l'assistant quand on l'ouvre depuis un onglet encore vide. */
  const [copyToEnv, setCopyToEnv] = useState<string | null>(null);
  const [mockModalOpen, setMockModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [testPayload, setTestPayload] = useState('{}');
  const [currentEnv, setCurrentEnv] = useState<CurrentEnv | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string | undefined>();
  const [severityFilter, setSeverityFilter] = useState<string | undefined>();
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const { enabled: enabledModules } = useEnabledModules();
  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [publishRun, setPublishRun] = useState<PublishRunView | null>(null);
  // Duplication du groupe auquel appartient ce workflow : le geste part d'ici, là
  // où l'on se pose la question de l'env, et non d'une page qu'il faut connaître.
  const [groupDuplicateId, setGroupDuplicateId] = useState<string | null>(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [minutesSaved, setMinutesSaved] = useState<number | null>(null);
  /** L'estimation qui sert tant que personne n'a saisi son chiffre (cf. `time-saved.ts`). */
  const [timeSavedEstimate, setTimeSavedEstimate] = useState<TimeSavedView['estimate']>(null);
  const [estimating, setEstimating] = useState(false);
  /** Avancement de « Vérifier » : une analyse dure des dizaines de secondes, sans cela l'écran est muet. */
  const [verifyProgress, setVerifyProgress] = useState<Record<string, StepStatus> | null>(null);
  const [checksModalOpen, setChecksModalOpen] = useState(false);
  const checkCatalog = useCheckCatalog();
  const { resolved: checks, reload: reloadChecks } = useResolvedChecks(workflowId);
  const lockAction = useLockAction(workflowId);
  const { instanceName } = useInstanceScope();
  const chat = useWorkflowChat();

  useEffect(() => {
    setMinutesSaved(
      (workflow as { minutesSavedPerExecution?: number | null } | undefined)?.minutesSavedPerExecution ??
        null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.name]);

  useEffect(() => {
    apiGet<TimeSavedView>(`/workflows/${workflowId}/time-saved`)
      .then((view) => setTimeSavedEstimate(view.estimate))
      .catch(() => setTimeSavedEstimate(null));
  }, [workflowId]);

  const saveMinutesSaved = async () => {
    try {
      await apiPatch(`/workflows/${workflowId}/time-saved`, { minutes: minutesSaved });
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  /** Réestime CE workflow — affiné par l'IA quand elle est configurée, la règle sinon. */
  const reestimate = async () => {
    setEstimating(true);
    try {
      const view = await apiPost<TimeSavedView>(`/workflows/${workflowId}/time-saved/estimate`);
      setTimeSavedEstimate(view.estimate);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setEstimating(false);
    }
  };

  const [aiCost, setAiCost] = useState<AiCost | null>(null);
  useEffect(() => {
    apiGet<AiCost | null>(`/ai-cost/workflow/${workflowId}?days=30`)
      .then(setAiCost)
      .catch(() => setAiCost(null)); // module désactivé
  }, [workflowId]);

  const loadCurrentEnv = React.useCallback(() => {
    apiGet<CurrentEnv>(`/env-switcher/current-env/${workflowId}`)
      .then(setCurrentEnv)
      .catch(() => setCurrentEnv(null)); // module désactivé ou pas de mapping
  }, [workflowId]);

  useEffect(loadCurrentEnv, [loadCurrentEnv]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Lance TOUTES les vérifications (un module désactivé est simplement sauté).
   * `selection` : contrôles décochés dans la modale et pas encore enregistrés —
   * absente, l'API applique le profil du workflow. Les quatre étapes sont jouées
   * même quand tous leurs contrôles sont décochés : c'est ce passage qui efface
   * les findings d'un contrôle qu'on vient de retirer. Le coût, lui, est évité
   * côté API (ni appel IA ni échantillonnage d'exécutions).
   */
  const verifyAll = (selection?: string[]) =>
    run('verify', async () => {
      // `undefined` tant que rien n'est chargé ni choisi : le corps est alors omis
      // et c'est l'API qui résout le profil — un `[]` envoyé à sa place vaudrait
      // « tous les contrôles » et écraserait la configuration enregistrée.
      const disabled = selection ?? checks?.disabled;
      const skipped: string[] = [];
      setVerifyProgress(Object.fromEntries(VERIFY_STEPS.map((s) => [s.key, 'pending' as StepStatus])));
      for (const step of VERIFY_STEPS) {
        setVerifyProgress((p) => ({ ...p, [step.key]: 'running' }));
        try {
          await apiPost(step.path(workflowId), disabled ? { disabled } : undefined);
          setVerifyProgress((p) => ({ ...p, [step.key]: 'done' }));
        } catch {
          skipped.push(step.key);
          setVerifyProgress((p) => ({ ...p, [step.key]: 'skipped' }));
        }
      }
      const all = await apiGet<Finding[]>(`/findings?workflowId=${workflowId}&_start=0&_end=500`);
      setFindings(all);
      message.success(
        `${all.length} findings` + (skipped.length ? ` — modules sautés : ${skipped.join(', ')}` : ''),
      );
    });

  /**
   * Recharge la liste depuis la base (après « Ignorer », et au chargement de la page :
   * les findings d'une analyse passée s'affichent sans avoir à tout rejouer).
   */
  const reloadFindings = React.useCallback(
    () =>
      apiGet<Finding[]>(`/findings?workflowId=${workflowId}&_start=0&_end=500`)
        .then(setFindings)
        .catch((error) => message.error((error as Error).message)),
    [workflowId],
  );

  useEffect(() => {
    reloadFindings();
  }, [reloadFindings]);

  /** Après renommage : relance l'analyse naming et recharge les findings. */
  const afterRenames = () =>
    run('verify', async () => {
      // L'échec était avalé : les findings se rechargeaient tels quels et l'on
      // croyait que le renommage n'avait rien changé, alors que l'analyse
      // n'avait simplement pas été relancée.
      await apiPost(`/optimizer/analyze/${workflowId}`).catch((error: unknown) =>
        message.error(`Analyse non relancée — ${(error as Error).message}`),
      );
      const all = await apiGet<Finding[]>(`/findings?workflowId=${workflowId}&_start=0&_end=500`);
      setFindings(all);
    });

  const generateDoc = () =>
    run('doc', async () => {
      const result = await apiPost<{ mermaid: string; summary?: string }>(
        `/doc-schema/generate/${workflowId}?ai=1`,
      );
      setDoc(result);
      message.success('Documentation générée');
    });

  const loadDoc = () =>
    run('doc-load', async () => {
      const result = await apiGet<{ mermaid: string; summary?: string } | null>(`/doc-schema/${workflowId}`);
      if (result) setDoc(result);
      else message.info('Pas encore de doc — génère-la');
    });

  const openAssistant = React.useCallback(
    () =>
      chat.open({
        workflowId,
        workflowName: workflow?.name,
        onWorkflowChanged: () => {
          refetch();
          reloadFindings();
        },
      }),
    // `reloadFindings` et `refetch` sont stables pour ce qui nous concerne ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, workflowId, workflow?.name],
  );

  // Sur mobile, l'assistant s'ouvre aussi d'un glissé vers la gauche : le tiroir
  // vient de ce bord, le geste le tire.
  useSwipeOpen(openAssistant, mobile && can('assistant'));

  /** Repull depuis n8n : la copie locale ne bouge sinon qu'au cron horaire. */
  const resync = () =>
    run('resync', async () => {
      const result = await apiPost<{ name: string; changed: boolean; missing: boolean }>(
        `/workflows/${workflowId}/resync`,
      );
      await refetch();
      if (result.missing) message.warning('n8n ne connaît plus ce workflow : marqué comme absent');
      else message.success(result.changed ? 'Workflow mis à jour depuis n8n' : 'Déjà à jour');
    });

  /**
   * Publie le workflow. Geste à part et jamais automatique — publier, c'est mettre
   * en production. Mais c'est aussi le seul moyen de rouvrir un workflow que n8n
   * renvoie vers « Nouveau workflow » faute de version publiée.
   */
  const publishWorkflow = () =>
    run('publish', async () => {
      const result = await apiPost<{ alreadyPublished: boolean }>(`/workflows/${workflowId}/publish`);
      await refetch();
      message.success(
        result.alreadyPublished
          ? 'Ce workflow était déjà publié.'
          : 'Workflow publié : n8n l’ouvre et l’exécute désormais.',
      );
    });

  const testWebhook = () =>
    run('test', async () => {
      const payload = JSON.parse(testPayload || '{}');
      const result = await apiPost<{ status: string }>(`/tester/webhook/${workflowId}`, payload);
      message.success(`Test terminé : ${result.status}`);
    });

  return (
    <div style={{ padding: 8 }}>
      <Card
        loading={isLoading}
        // Sans quoi un nom long garde sa ligne et pousse la page hors de l'écran.
        styles={{ title: { whiteSpace: 'normal' } }}
        // Recharger la fiche depuis n8n est le geste d'un rafraîchissement de
        // navigateur : une icône au coin, pas une entrée de menu.
        extra={
          <Space size={4}>
            {can('assistant') && (
              <Tooltip title="Assistant IA — ouvrable aussi d'un glissé vers la gauche sur mobile">
                <Button
                  type="text"
                  icon={<RobotOutlined />}
                  aria-label="Assistant IA"
                  onClick={openAssistant}
                />
              </Tooltip>
            )}
            <Tooltip title="Recharger depuis n8n">
              <Button
                type="text"
                icon={<ReloadOutlined />}
                loading={busy === 'resync'}
                aria-label="Recharger depuis n8n"
                onClick={resync}
              />
            </Tooltip>
          </Space>
        }
        title={
          <Space wrap>
            {workflow?.name}
            {workflow?.instanceId && <Tag color="geekblue">{instanceName(workflow.instanceId)}</Tag>}
            {workflow?.active ? <Tag color="green">actif</Tag> : <Tag>inactif</Tag>}
            <WorkflowLockTag workflowId={workflowId} />
            {/* Posée par la promotion, jamais par une édition : c'est la mise en
                production qui fait la version, pas le fait d'avoir touché au workflow. */}
            {(workflow as { version?: string | null } | undefined)?.version && (
              <Tooltip title="Posée par la dernière promotion.">
                <Tag color="purple">v{(workflow as { version?: string }).version}</Tag>
              </Tooltip>
            )}
            {currentEnv?.env && (
              <Tag color={currentEnv.mixed ? 'volcano' : envColor(currentEnv.env)}>
                branché : {currentEnv.env}
                {currentEnv.mixed ? ' (mixte !)' : ''}
              </Tag>
            )}
          </Space>
        }
      >
        <Descriptions size="small" column={mobile ? 1 : 2}>
          {aiCost && aiCost.calls > 0 && (
            <Descriptions.Item label={`Coût IA (${aiCost.days} j)`}>
              <Link href="/llm-costs">
                <Tooltip
                  title={`${aiCost.calls} appel(s) LLM sur ${aiCost.executions} exécution(s)${
                    aiCost.unpricedCalls > 0 ? ` — ${aiCost.unpricedCalls} sans tarif : coût plancher` : ''
                  }`}
                >
                  <span>
                    {aiCost.unpricedCalls > 0 ? '≥ ' : ''}
                    {aiCost.costUsd.toLocaleString('fr-FR', {
                      minimumFractionDigits: aiCost.costUsd >= 1 ? 2 : 4,
                      maximumFractionDigits: aiCost.costUsd >= 1 ? 2 : 4,
                    })}{' '}
                    $
                  </span>
                </Tooltip>
              </Link>
            </Descriptions.Item>
          )}
        </Descriptions>
        {/* Un RÉGLAGE, pas une mesure : affiché en petit, édité au clic. En champ
            ouvert dans la fiche, il se lisait comme un temps réellement mesuré. */}
        <Popover
          trigger="click"
          title="Temps gagné par exécution réussie"
          content={
            <Space direction="vertical" size={8} style={{ maxWidth: 260 }}>
              <InputNumber
                autoFocus
                min={0}
                step={0.5}
                placeholder={timeSavedEstimate ? `${timeSavedEstimate.minutes} (estimé)` : '—'}
                value={minutesSaved}
                onChange={(value) => setMinutesSaved(value)}
                onBlur={saveMinutesSaved}
                addonAfter="min / exéc."
                style={{ width: '100%' }}
              />
              <Space size={4}>
                <Button size="small" type="link" loading={estimating} onClick={reestimate}>
                  Réestimer (IA)
                </Button>
                {timeSavedEstimate?.why && (
                  <Tooltip title={timeSavedEstimate.why}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      pourquoi ?
                    </Typography.Text>
                  </Tooltip>
                )}
              </Space>
            </Space>
          }
        >
          <Typography.Link style={{ fontSize: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Temps gagné :{' '}
            </Typography.Text>
            {minutesSaved != null
              ? `${minutesSaved} min / exéc.`
              : timeSavedEstimate
                ? `${timeSavedEstimate.minutes} min / exéc. (estimé)`
                : 'à renseigner'}
          </Typography.Link>
        </Popover>
        <PublishRunBanner workflowId={workflowId} pushed={publishRun} />
        {workflow && (
          <EnvLinks
            workflow={workflow}
            onCopyTo={(envId) => {
              setCopyToEnv(envId);
              setEnvModalOpen(true);
            }}
          />
        )}
        {workflow && <GroupLinks workflow={workflow} />}
        {/* Quatre actions sous la main, le reste dans « ⋯ » : alignées, les treize
            ne hiérarchisaient plus rien — sur téléphone comme sur grand écran. */}
        <div style={{ marginTop: 16 }}>
          <ActionBar
            collapse="always"
            primary={
              <>
                <Button type="primary" loading={busy === 'verify'} onClick={() => verifyAll()}>
                  Vérifier
                </Button>
                {workflow?.n8nUrl && (
                  <Button
                    icon={<ExportOutlined />}
                    href={workflow.n8nUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ouvrir dans n8n
                  </Button>
                )}
              </>
            }
            actions={[
              // Proposé seulement quand il y a quelque chose à publier. Un workflow sans
              // version publiée n'est pas perdu : l'éditeur n8n ouvre la version publiée,
              // et sans elle il renvoie vers « Nouveau workflow ».
              ...(can('publish') && workflow?.published === false
                ? [
                    {
                      key: 'publish',
                      label: 'Publier',
                      hint: 'Aucune version publiée',
                      danger: true,
                      loading: busy === 'publish',
                      onClick: publishWorkflow,
                    },
                  ]
                : []),
              {
                key: 'checks',
                label:
                  'Contrôles' +
                  (checkCatalog && checks && checks.disabled.length > 0
                    ? ` (${checkCatalog.checks.length - checks.disabled.length}/${checkCatalog.checks.length})`
                    : ''),
                icon: <SettingOutlined />,
                hint: checks?.source
                  ? `Contrôles à jouer — configuration héritée de : ${checks.source.label}`
                  : 'Choisir les contrôles à jouer',
                onClick: () => setChecksModalOpen(true),
              },
              ...(can('remoteSchema') && (!enabledModules || enabledModules.includes('remote-schema'))
                ? [
                    {
                      key: 'remote',
                      label: 'Vérifier le distant',
                      hint: 'Les tables Airtable, NocoDB, Notion, Sheets et Postgres portent-elles les colonnes que ce workflow lit ou écrit ?',
                      onClick: () => setRemoteModalOpen(true),
                    },
                  ]
                : []),
              ...(can('naming')
                ? [{ key: 'naming', label: 'Suggérer des noms', onClick: () => setRenameModalOpen(true) }]
                : []),
              ...(can('envSwitch')
                ? [{ key: 'envs', label: 'Environnements', onClick: () => setEnvModalOpen(true) }]
                : []),
              ...(can('export')
                ? [
                    {
                      key: 'json',
                      label: 'JSON',
                      icon: <CodeOutlined />,
                      onClick: () => setJsonModalOpen(true),
                    },
                  ]
                : []),
              lockAction.action,
            ]}
          />
          {lockAction.modal}
        </div>
        {unavailable.length > 0 && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            <Tooltip title={unavailable.join(' ')}>
              <span style={{ textDecoration: 'underline dotted', cursor: 'help' }}>
                {unavailable.length} action{unavailable.length > 1 ? 's' : ''} indisponible
                {unavailable.length > 1 ? 's' : ''} sur Make
              </span>
            </Tooltip>
          </Typography.Paragraph>
        )}
        {verifyProgress && (
          <Space wrap size="large" style={{ marginTop: 12 }}>
            {VERIFY_STEPS.map((step) => {
              const status = verifyProgress[step.key] ?? 'pending';
              return (
                <Space key={step.key} size={6}>
                  {stepIcon[status]}
                  <span
                    style={{ color: status === 'pending' || status === 'skipped' ? '#8c8c8c' : undefined }}
                  >
                    {step.label}
                    {status === 'skipped' ? ' (module désactivé)' : ''}
                  </span>
                </Space>
              );
            })}
          </Space>
        )}
      </Card>

      {/* Bouton flottant : sur mobile, l'icône du coin est loin du pouce une fois
          la page défilée, et un geste seul ne s'apprend pas tout seul. */}
      {mobile && can('assistant') && (
        <FloatButton icon={<RobotOutlined />} type="primary" tooltip="Assistant IA" onClick={openAssistant} />
      )}
      <Tabs
        style={{ marginTop: 16 }}
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'graph',
            label: 'Schéma',
            children: structure.error ? (
              <Alert type="error" showIcon message={structure.error} />
            ) : structure.view ? (
              <WorkflowGraph view={structure.view} />
            ) : (
              <Skeleton active />
            ),
          },
          {
            key: 'nodes',
            label: `Nœuds${structure.view ? ` (${countNodes(structure.view)})` : ''}`,
            children: structure.view ? <WorkflowNodes view={structure.view} /> : <Skeleton active />,
          },
          ...(can('fields')
            ? [
                {
                  key: 'samples',
                  label: 'Données réelles',
                  children: <ExecutionSamplesPanel workflowId={workflowId} active={tab === 'samples'} />,
                },
              ]
            : []),
          {
            key: 'findings',
            label: `Findings (${findings.length})`,
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Select
                    allowClear
                    placeholder="Type de vérif"
                    style={{ width: mobile ? '100%' : 180 }}
                    value={moduleFilter}
                    onChange={setModuleFilter}
                    options={[
                      { value: 'verifier', label: 'Structure' },
                      { value: 'js-checker', label: 'JS' },
                      { value: 'optimizer', label: 'Naming' },
                      { value: 'field-checker', label: 'Champs (exécutions)' },
                      { value: 'remote-schema', label: 'Tables distantes' },
                    ]}
                  />
                  <Select
                    allowClear
                    placeholder="Sévérité"
                    style={{ width: mobile ? '100%' : 150 }}
                    value={severityFilter}
                    onChange={setSeverityFilter}
                    options={['error', 'warning', 'info'].map((s) => ({ value: s, label: s }))}
                  />
                </Space>
                <FindingsList
                  findings={findings
                    .filter(
                      (f) =>
                        (!moduleFilter || f.module === moduleFilter) &&
                        (!severityFilter || f.severity === severityFilter),
                    )
                    .map((f) => ({
                      ...f,
                      suggestion: f.data?.suggestion ?? null,
                      line: f.data?.line ?? null,
                      snippet: f.data?.snippet ?? null,
                      snippetStart: f.data?.snippetStart ?? null,
                      autoFix: f.data?.autoFix === true,
                    }))}
                  onChanged={reloadFindings}
                />
              </>
            ),
          },
          {
            key: 'doc',
            label: 'Documentation',
            children: doc ? (
              <div>
                <Space style={{ marginBottom: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Documentation enregistrée
                  </Typography.Text>
                  {can('doc') && (
                    <Button size="small" type="link" loading={busy === 'doc'} onClick={generateDoc}>
                      Régénérer (IA)
                    </Button>
                  )}
                </Space>
                {doc.summary && (
                  <Card size="small" style={{ marginBottom: 16 }}>
                    <Markdown content={doc.summary} />
                  </Card>
                )}
                <MermaidView code={doc.mermaid} />
              </div>
            ) : busy === 'doc-load' ? (
              <Skeleton active />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Pas encore de documentation pour ce workflow"
              >
                {can('doc') && (
                  <Button type="primary" loading={busy === 'doc'} onClick={generateDoc}>
                    Générer la documentation (IA)
                  </Button>
                )}
              </Empty>
            ),
          },
          {
            key: 'test',
            label: 'Test',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.TextArea
                  rows={6}
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  placeholder='Payload JSON envoyé au webhook, ex: {"orderId": 42}'
                />
                <Space wrap>
                  <Button type="primary" loading={busy === 'test'} onClick={testWebhook}>
                    Déclencher via webhook
                  </Button>
                  {can('test') && (
                    <Tooltip title="Rejoue le workflow avec des réponses simulées : rien n'est écrit ni envoyé au dehors.">
                      <Button onClick={() => setMockModalOpen(true)}>Tester sans rien envoyer</Button>
                    </Tooltip>
                  )}
                </Space>
                <TestCasesCard workflowId={workflowId} />
              </Space>
            ),
          },
        ]}
      />

      <CheckSelectionModal
        workflowId={workflowId}
        open={checksModalOpen}
        onClose={() => setChecksModalOpen(false)}
        onRun={(disabled) => verifyAll(disabled)}
        onSaved={reloadChecks}
      />

      <RenameSuggestionsModal
        workflowId={workflowId}
        open={renameModalOpen}
        onClose={() => setRenameModalOpen(false)}
        onApplied={afterRenames}
      />

      <RemoteSchemaModal
        workflowId={workflowId}
        open={remoteModalOpen}
        onClose={() => setRemoteModalOpen(false)}
        onChecked={reloadFindings}
      />

      <WorkflowJsonModal
        workflowId={workflowId}
        open={jsonModalOpen}
        onClose={() => setJsonModalOpen(false)}
      />

      <PromoteModal
        workflowId={workflowId}
        sourceInstanceId={workflow?.instanceId}
        open={promoteModalOpen}
        onClose={() => setPromoteModalOpen(false)}
        onPublication={setPublishRun}
      />

      <MockTestModal
        workflowId={workflowId}
        n8nUrl={workflow?.n8nUrl}
        open={mockModalOpen}
        onClose={() => setMockModalOpen(false)}
      />

      <EnvAssistantModal
        workflowId={workflowId}
        workflowName={workflow?.name}
        active={workflow?.active}
        tags={workflow?.tags}
        open={envModalOpen}
        startCopyTo={copyToEnv}
        onClose={() => {
          setEnvModalOpen(false);
          setCopyToEnv(null);
        }}
        onDone={loadCurrentEnv}
        groups={workflow?.groups}
        onPromote={() => setPromoteModalOpen(true)}
        onGroupDuplicate={setGroupDuplicateId}
      />
      {groupDuplicateId && (
        <GroupDuplicateModal
          groupId={groupDuplicateId}
          groupName={
            (workflow?.groups ?? []).find((group) => group.id === groupDuplicateId)?.name ?? 'ce groupe'
          }
          open
          onClose={() => setGroupDuplicateId(null)}
        />
      )}
    </div>
  );
}
