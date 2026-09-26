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
  if (findings.length === 0) return 'none';
  return findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.code}${finding.nodeName ? ` (${finding.nodeName})` : ''}: ${finding.message}`,
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
      'Returns the COMPLETE configuration of a module of the scenario (mapper, parameters, filter) and the ' +
      'description Make embeds of its fields (types, allowed values, required fields). Call it before ' +
      'touching a module, rather than guessing a value.',
    input: {
      type: 'object',
      properties: { moduleId: { type: 'number', description: 'Integer id of the module' } },
      required: ['moduleId'],
    },
    async run(input) {
      const moduleId = Number(input.moduleId);
      if (!isMakeBlueprint(context.blueprint)) throw new Error('Unreadable scenario.');
      const found = flattenModules(context.blueprint).find((flat) => flat.module.id === moduleId);
      if (!found) {
        const ids = flattenModules(context.blueprint)
          .map((flat) => `#${flat.module.id} ${moduleLabel(flat.module)}`)
          .join(', ');
        throw new Error(`Module #${moduleId} not found. Modules of the scenario: ${ids}`);
      }
      // Ce que le module porte (routes, branches) se lit module par module : le
      // recopier ici ferait relire tout un sous-arbre pour un seul module.
      const { routes, branches, onerror, ...own } = found.module;
      return [
        `Module #${moduleId} — ${moduleLabel(found.module)} (${found.module.module ?? 'unknown type'}), ` +
          `in ${found.scope === 'main' ? 'the main flow' : `${found.scope === 'route' ? 'a route' : found.scope === 'branch' ? 'a branch' : 'an error handler'} of module #${found.parentId}`}.`,
        found.upstreamIds.length > 0
          ? `Modules that ran before it (readable through {{id.…}}): ${found.upstreamIds.map((id) => `#${id}`).join(', ')}`
          : 'No module runs before it.',
        routes?.length || branches?.length || onerror?.length
          ? `It carries ${routes?.length ?? 0} route(s), ${branches?.length ?? 0} branch(es), ${onerror?.length ?? 0} error handler(s).`
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
      'Applies a draft of operations to a COPY of the scenario (nothing is written to Make) and returns ' +
      'what it introduces, with the verdict of the gate. Call it before proposing, and again after ' +
      'fixing. Checking is not proposing: the operations validated here must be copied into the final ' +
      'proposal.',
    input: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: { type: 'object' },
          description: 'Edit operations of the scenario',
        },
      },
      required: ['operations'],
    },
    async run(input) {
      const operations = (Array.isArray(input.operations) ? input.operations : []) as MakeEditOperation[];
      const { gate, warnings } = await context.evaluate(operations);
      context.draftChecked({ operations, clean: !gate.blocked });
      return [
        `Draft checked — operations applied: ${operations.length}`,
        warnings.length > 0 ? `Warnings: ${warnings.join('; ')}` : 'Warnings: none',
        `Problems INTRODUCED by this draft:\n${renderFindings(gate.introduced)}`,
        gate.blocked
          ? `REFUSED — ${gate.reason ?? 'the gate refuses this draft'} Fix it and check again before proposing.`
          : 'The gate lets this draft through.',
      ].join('\n\n');
    },
  };

  const { remember, listConversations, readConversation, searchDocs, readDocs } =
    buildSharedChatTools(context);
  return [readModule, checkScenario, remember, listConversations, readConversation, searchDocs, readDocs];
}
