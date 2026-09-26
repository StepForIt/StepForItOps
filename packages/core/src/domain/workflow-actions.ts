/**
 * Ce qu'on peut FAIRE sur un workflow, selon la plateforme qui le sert.
 *
 * Sans cette liste, l'écran propose douze boutons dont huit répondent 400 sur un
 * scénario Make. Un bouton qui échoue apprend quelque chose de faux : que la
 * plateforme est cassée, alors qu'elle n'a simplement pas cette fonction là-bas.
 *
 * Deux raisons distinctes d'être indisponible, et il faut les dire séparément :
 *
 * - `platform` — la plateforme ne le PERMET pas. Épingler une donnée n'existe
 *   pas chez Make, les bundles d'une exécution n'y sont pas lisibles. Aucun
 *   travail de notre côté n'y changera quoi que ce soit.
 * - `not-yet` — nous ne l'avons pas encore porté. C'est une dette, pas une
 *   limite, et le dire ainsi évite de faire passer notre retard pour une
 *   contrainte du fournisseur.
 */
import { msg } from '../i18n';
import { PlatformCapabilities, PlatformId } from '../ports/workflow-platform.port';

export type WorkflowActionId =
  | 'export'
  | 'test'
  | 'envSwitch'
  | 'assistant'
  | 'doc'
  | 'naming'
  | 'fields'
  | 'remoteSchema'
  | 'publish'
  | 'verify'
  | 'sync';

export interface ActionState {
  available: boolean;
  /** Renseigné quand ce n'est pas disponible : la phrase montrée à l'écran. */
  why?: string;
  reason?: 'platform' | 'not-yet';
}

export type WorkflowActions = Record<WorkflowActionId, ActionState>;

const OK: ActionState = { available: true };

const impossible = (why: string): ActionState => ({ available: false, why, reason: 'platform' });
/** La phrase entière, et non un gabarit : « la bascule » ne se porte pas comme « l'export ». */
const notYet = (why: string): ActionState => ({ available: false, why, reason: 'not-yet' });

export function workflowActions(platform: PlatformId, capabilities: PlatformCapabilities): WorkflowActions {
  if (platform === 'n8n') {
    return {
      export: OK,
      test: OK,
      envSwitch: OK,
      assistant: OK,
      doc: OK,
      naming: OK,
      fields: OK,
      remoteSchema: OK,
      publish: OK,
      verify: OK,
      sync: OK,
    };
  }

  return {
    // Lire, contrôler et sortir le blueprint marchent : c'est tout le miroir.
    sync: OK,
    verify: OK,
    export: OK,
    // Renommer y est sûr par construction : les expressions visent l'id du module.
    naming: OK,
    doc: OK,
    // Retouche des modules existants seulement : l'ajout demanderait leur description, que Make ne sert pas.
    assistant: OK,

    test: capabilities.pinData ? OK : impossible(msg('platform.actionMakeNoPinData')),
    fields: capabilities.executionData ? OK : impossible(msg('platform.actionMakeNoExecutionData')),

    // Ce qui manque de notre côté, dit comme tel.
    envSwitch: notYet(msg('platform.actionMakeEnvSwitchNotYet')),
    remoteSchema: notYet(msg('platform.actionMakeRemoteSchemaNotYet')),
    publish: impossible(msg('platform.actionMakeNoPublish')),
  };
}

/** Ce qui est indisponible, pour l'annoncer d'une ligne sous la barre d'actions. */
export function unavailableActions(actions: WorkflowActions): Array<{ id: WorkflowActionId; why: string }> {
  return (Object.entries(actions) as Array<[WorkflowActionId, ActionState]>)
    .filter(([, state]) => !state.available)
    .map(([id, state]) => ({ id, why: state.why ?? '' }));
}
