'use client';

import React from 'react';
import { Drawer, Modal } from 'antd';
import { useTranslations } from 'next-intl';
import { WorkflowChatPanel } from './workflow-chat-panel';

interface ChatTarget {
  workflowId: string;
  /** Conversation à ouvrir (correctif fraîchement proposé) ; sinon la plus récente. */
  sessionId?: string;
  /** Nom affiché en titre, quand la page appelante le connaît déjà. */
  workflowName?: string;
  /** Rappelé quand une proposition a été appliquée : la page se recharge. */
  onWorkflowChanged?: () => void;
}

interface ChatContextValue {
  open: (target: ChatTarget) => void;
  close: () => void;
  /** Workflow dont le chat est ouvert (null si fermé) : sert aux pages qui hébergent le chat autrement. */
  openWorkflowId: string | null;
  /**
   * Le panneau signale qu'il porte un brouillon non envoyé (texte ou pièces
   * jointes). Le tiroir ne peut pas le lire lui-même — le brouillon vit dans
   * l'état du panneau —, et sans ce signal il détruisait la saisie en cours.
   */
  setDirty: (dirty: boolean) => void;
}

const WorkflowChatContext = React.createContext<ChatContextValue | null>(null);

/**
 * Un seul chat pour toute la console, ouvert en tiroir. L'assistant ne vivait que
 * sur la page `view` d'un workflow : depuis une liste de findings ou la page
 * d'analyses, le corriger imposait un changement de page — et un rechargement
 * complet — avant même de lire la réponse.
 */
export function WorkflowChatProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('chat.drawer');
  const [target, setTarget] = React.useState<ChatTarget | null>(null);
  const [modal, modalHolder] = Modal.useModal();
  // Une ref et non un état : ce drapeau ne change rien à l'affichage, il n'est
  // lu qu'au moment de la fermeture. En état, chaque lettre tapée dans le
  // brouillon aurait remonté un rendu jusqu'à la console entière.
  const dirty = React.useRef(false);

  const close = React.useCallback(() => {
    dirty.current = false;
    setTarget(null);
  }, []);

  /**
   * Fermer détruit le panneau (`destroyOnClose`), donc le brouillon et ses
   * pièces jointes. Tant qu'il y a quelque chose à perdre, on demande — c'est
   * la même intention que `warnWhenUnsavedChanges` sur les formulaires Refine,
   * qui ne couvre pas ce tiroir.
   */
  const requestClose = React.useCallback(() => {
    if (!dirty.current) return close();
    modal.confirm({
      title: t('discard.title'),
      content: t('discard.content'),
      okText: t('discard.ok'),
      okButtonProps: { danger: true },
      cancelText: t('discard.cancel'),
      onOk: close,
    });
  }, [close, modal, t]);

  const value = React.useMemo<ChatContextValue>(
    () => ({
      open: setTarget,
      close,
      openWorkflowId: target?.workflowId ?? null,
      setDirty: (value) => {
        dirty.current = value;
      },
    }),
    [close, target],
  );

  return (
    <WorkflowChatContext.Provider value={value}>
      {children}
      {modalHolder}
      <Drawer
        open={!!target}
        onClose={requestClose}
        // Un clic sur le voile fermait le tiroir — donc détruisait le brouillon —
        // sans rien demander, et le geste part souvent d'une main qui visait la
        // page derrière. La croix et Échap restent les sorties, elles passent
        // par la confirmation.
        maskClosable={false}
        title={target?.workflowName ? t('titleWithName', { name: target.workflowName }) : t('title')}
        placement="right"
        // Largeur en CSS et non par un breakpoint JS : sur un écran étroit le tiroir
        // prend tout, sans dépendre d'un hook qui se trompe au premier rendu.
        width="min(620px, 100vw)"
        styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column' } }}
        // Remonté à chaque ouverture : la conversation à afficher change avec la cible.
        destroyOnClose
      >
        {target && (
          // flex:1 + minHeight:0 : sans quoi la carte du chat, en height 100%,
          // déborde du tiroir au lieu de faire défiler ses messages.
          <div style={{ flex: 1, minHeight: 0 }}>
            <WorkflowChatPanel
              workflowId={target.workflowId}
              initialSessionId={target.sessionId}
              onWorkflowChanged={target.onWorkflowChanged}
            />
          </div>
        )}
      </Drawer>
    </WorkflowChatContext.Provider>
  );
}

/**
 * Ouvre le chat sur un workflow depuis n'importe quelle page de la console.
 * Hors provider (tests, rendu isolé), l'ouverture est un non-événement plutôt
 * qu'une exception : un bouton d'assistant ne doit pas casser une page.
 */
export function useWorkflowChat(): ChatContextValue {
  return (
    React.useContext(WorkflowChatContext) ?? {
      open: () => undefined,
      close: () => undefined,
      openWorkflowId: null,
      setDirty: () => undefined,
    }
  );
}
