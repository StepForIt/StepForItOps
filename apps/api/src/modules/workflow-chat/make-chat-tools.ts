import {
  AiTool,
  CheckFinding,
  GateVerdict,
  MakeEditOperation,
  flattenModules,
  isMakeBlueprint,
  moduleLabel,
  redactSecrets,
} from '@nwm/core';
import { SharedChatToolContext, buildSharedChatTools } from './chat-shared-tools';

/** Le brouillon passé à `check_scenario`, retenu pour le cas où la réponse finale ne le porte pas. */
export interface CheckedMakeDraft {
  operations: MakeEditOperation[];
  clean: boolean;
}

export interface MakeChatToolContext extends SharedChatToolContext {
  /** Le scénario tel que Make le sert, relu au début du tour. */
  blueprint: unknown;
  /** Applique un brouillon à une copie et le juge par la porte, sans rien écrire. */
  evaluate(operations: MakeEditOperation[]): Promise<{ gate: GateVerdict; warnings: string[] }>;
  draftChecked(draft: CheckedMakeDraft): void;
}

function renderFindings(findings: CheckFinding[]): string {
  if (findings.length === 0) return 'aucun';
  return findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.code}${finding.nodeName ? ` (${finding.nodeName})` : ''} : ${finding.message}`,
    )
    .join('\n');
}

/**
 * Ce que l'assistant peut aller chercher lui-même sur un scénario Make : la
 * configuration complète d'un module, et le verdict de la porte sur son
 * brouillon. Plus les outils communs (mémoire, conversations, doc des tiers).
 */
export function buildMakeChatTools(context: MakeChatToolContext): AiTool[] {
  const readModule: AiTool = {
    name: 'read_module',
    description:
      'Renvoie la configuration COMPLÈTE d’un module du scénario (mapper, parameters, filtre) et la ' +
      'description que Make embarque de ses champs (types, valeurs admises, champs requis). À appeler ' +
      'avant de retoucher un module, plutôt que de deviner une valeur.',
    input: {
      type: 'object',
      properties: { moduleId: { type: 'number', description: 'Id entier du module' } },
      required: ['moduleId'],
    },
    async run(input) {
      const moduleId = Number(input.moduleId);
      if (!isMakeBlueprint(context.blueprint)) throw new Error('Scénario illisible.');
      const found = flattenModules(context.blueprint).find((flat) => flat.module.id === moduleId);
      if (!found) {
        const ids = flattenModules(context.blueprint)
          .map((flat) => `#${flat.module.id} ${moduleLabel(flat.module)}`)
          .join(', ');
        throw new Error(`Module #${moduleId} introuvable. Modules du scénario : ${ids}`);
      }
      // Ce que le module porte (routes, branches) se lit module par module : le
      // recopier ici ferait relire tout un sous-arbre pour un seul module.
      const { routes, branches, onerror, ...own } = found.module;
      return [
        `Module #${moduleId} — ${moduleLabel(found.module)} (${found.module.module ?? 'type inconnu'}), ` +
          `dans ${found.scope === 'main' ? 'le flow principal' : `une ${found.scope === 'route' ? 'route' : found.scope === 'branch' ? 'branche' : 'gestion d’erreur'} du module #${found.parentId}`}.`,
        found.upstreamIds.length > 0
          ? `Modules qui ont tourné avant lui (lisibles par {{id.…}}) : ${found.upstreamIds.map((id) => `#${id}`).join(', ')}`
          : 'Aucun module ne tourne avant lui.',
        routes?.length || branches?.length || onerror?.length
          ? `Il porte ${routes?.length ?? 0} route(s), ${branches?.length ?? 0} branche(s), ${onerror?.length ?? 0} gestionnaire(s) d’erreur.`
          : '',
        JSON.stringify(redactSecrets(own)),
      ]
        .filter(Boolean)
        .join('\n\n');
    },
  };

  const checkScenario: AiTool = {
    name: 'check_scenario',
    description:
      'Applique un brouillon d’opérations à une COPIE du scénario (rien n’est écrit dans Make) et renvoie ' +
      'ce qu’il introduit, avec le verdict de la porte. À appeler avant de proposer, et à nouveau après ' +
      'avoir corrigé. Vérifier n’est pas proposer : les opérations validées ici doivent être reprises ' +
      'dans la proposition finale.',
    input: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: { type: 'object' },
          description: 'Opérations d’édition du scénario',
        },
      },
      required: ['operations'],
    },
    async run(input) {
      const operations = (Array.isArray(input.operations) ? input.operations : []) as MakeEditOperation[];
      const { gate, warnings } = await context.evaluate(operations);
      context.draftChecked({ operations, clean: !gate.blocked });
      return [
        `Brouillon vérifié — opérations appliquées : ${operations.length}`,
        warnings.length > 0 ? `Avertissements : ${warnings.join(' ; ')}` : 'Avertissements : aucun',
        `Problèmes INTRODUITS par ce brouillon :\n${renderFindings(gate.introduced)}`,
        gate.blocked
          ? `REFUSÉ — ${gate.reason ?? 'la porte refuse ce brouillon'} Corrige et revérifie avant de proposer.`
          : 'La porte laisse passer ce brouillon.',
      ].join('\n\n');
    },
  };

  const { remember, listConversations, readConversation, searchDocs, readDocs } =
    buildSharedChatTools(context);
  return [readModule, checkScenario, remember, listConversations, readConversation, searchDocs, readDocs];
}
