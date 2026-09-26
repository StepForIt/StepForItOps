/**
 * Le diff d'une proposition sur un scénario Make, sous la forme de celui de n8n.
 *
 * Même objet que `diffWorkflows` — les modules y tiennent la place des nœuds,
 * l'enchaînement celle des connexions, les réglages du scénario celle des
 * settings — pour que la revue n'ait qu'un écran : deux revues divergeraient au
 * premier changement de l'une. Les modules s'apparient par id, stable au
 * renommage : un module renommé ne se lit jamais « supprimé ici, ajouté là ».
 */
import { msg } from '../../i18n';
import { ChangeExplanation, explainLeafChanges } from '../n8n/change-impact';
import { NodeDiff, WorkflowDiff, diffJson } from '../n8n/workflow-diff';
import { MakeBlueprint, MakeModule, flattenModules, isMakeBlueprint, moduleLabel } from './blueprint';
import { makeModuleEdges } from './blueprint-view';

export function diffBlueprintsForReview(before: unknown, after: unknown): WorkflowDiff {
  const previous = asBlueprint(before);
  const next = asBlueprint(after);
  const beforeById = new Map(flattenModules(previous).map((flat) => [flat.module.id, flat.module]));
  const afterById = new Map(flattenModules(next).map((flat) => [flat.module.id, flat.module]));

  const nodes: NodeDiff[] = [];
  for (const [id, module] of afterById) {
    const old = beforeById.get(id);
    if (!old) {
      nodes.push({
        name: display(module),
        nodeType: module.module ?? '',
        change: 'added',
        fields: [],
        lines: diffJson(undefined, own(module)),
        explanations: [{ text: msg('edit.makeModuleAdded'), level: 'info' }],
      });
      continue;
    }
    const fields = changedFields(old, module);
    if (fields.length === 0) continue;
    const renamed = moduleLabel(old) !== moduleLabel(module);
    nodes.push({
      name: display(module),
      nodeType: module.module ?? '',
      change: renamed ? 'renamed' : 'modified',
      ...(renamed ? { renamedFrom: display(old) } : {}),
      fields,
      lines: diffJson(own(old), own(module)),
      explanations: explainModule(old, module),
    });
  }
  for (const [id, module] of beforeById) {
    if (afterById.has(id)) continue;
    nodes.push({
      name: display(module),
      nodeType: module.module ?? '',
      change: 'removed',
      fields: [],
      lines: diffJson(own(module), undefined),
      explanations: [{ text: msg('edit.makeModuleRemoved'), level: 'warning' }],
    });
  }

  // Comparé sur les ids : un renommage change le libellé des liens, pas l'enchaînement.
  const structureChanged =
    JSON.stringify(makeModuleEdges(previous)) !== JSON.stringify(makeModuleEdges(next));
  const edgesBefore = readableEdges(previous);
  const edgesAfter = readableEdges(next);
  const settingsChanged = JSON.stringify(previous.metadata ?? {}) !== JSON.stringify(next.metadata ?? {});
  const nameBefore = previous.name ?? '';
  const nameAfter = next.name ?? '';
  const nameChange = nameBefore !== nameAfter ? { before: nameBefore, after: nameAfter } : null;

  return {
    nameChange,
    nodes,
    connections: {
      changed: structureChanged,
      lines: structureChanged ? diffJson(edgesBefore, edgesAfter) : [],
      explanations: structureChanged ? [{ text: msg('edit.makeChainChanged'), level: 'warning' }] : [],
    },
    settings: {
      changed: settingsChanged,
      lines: settingsChanged ? diffJson(previous.metadata ?? {}, next.metadata ?? {}) : [],
      explanations: settingsChanged ? explainLeafChanges(previous.metadata, next.metadata) : [],
    },
    counts: {
      added: nodes.filter((node) => node.change === 'added').length,
      removed: nodes.filter((node) => node.change === 'removed').length,
      modified: nodes.filter((node) => node.change === 'modified').length,
      renamed: nodes.filter((node) => node.change === 'renamed').length,
    },
    hasChanges: nodes.length > 0 || structureChanged || settingsChanged || nameChange !== null,
  };
}

function asBlueprint(value: unknown): MakeBlueprint {
  return isMakeBlueprint(value) ? value : { flow: [] };
}

function display(module: MakeModule): string {
  return `${moduleLabel(module)} (#${module.id})`;
}

/**
 * Le module sans ce qu'il porte : un routeur dont une route change n'est pas
 * modifié lui-même, et le compter ferait remonter chaque porteur jusqu'à la racine.
 */
function own(module: MakeModule): Omit<MakeModule, 'routes' | 'onerror'> {
  const { routes: _routes, onerror: _onerror, branches, ...rest } = module;
  const shells = branches?.map(({ flow: _flow, ...shell }) => shell);
  return shells ? { ...rest, branches: shells } : rest;
}

function changedFields(before: MakeModule, after: MakeModule): string[] {
  const a = own(before) as Record<string, unknown>;
  const b = own(after) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
}

function explainModule(before: MakeModule, after: MakeModule): ChangeExplanation[] {
  const out: ChangeExplanation[] = [];
  if (moduleLabel(before) !== moduleLabel(after)) {
    out.push({ text: msg('edit.makeRenamed', { name: moduleLabel(after) }), level: 'info' });
  }
  if (JSON.stringify(before.filter ?? null) !== JSON.stringify(after.filter ?? null)) {
    out.push(
      after.filter
        ? { text: msg('edit.makeFilterChanged'), level: 'warning' }
        : { text: msg('edit.makeFilterDropped'), level: 'warning' },
    );
  }
  out.push(...explainLeafChanges(before.mapper, after.mapper).map((e) => prefixed(e, 'mapper')));
  out.push(...explainLeafChanges(before.parameters, after.parameters).map((e) => prefixed(e, 'parameters')));
  return out;
}

function prefixed(explanation: ChangeExplanation, section: string): ChangeExplanation {
  return explanation.path ? { ...explanation, path: `${section}.${explanation.path}` } : explanation;
}

/** Les liens sous une forme qui se relit dans un diff : des libellés, pas seulement des ids. */
function readableEdges(blueprint: MakeBlueprint): string[] {
  const byId = new Map(flattenModules(blueprint).map((flat) => [flat.module.id, flat.module]));
  const name = (id: number) => {
    const module = byId.get(id);
    return module ? display(module) : `#${id}`;
  };
  return makeModuleEdges(blueprint).map(
    (edge) => `${name(edge.fromId)} → ${name(edge.toId)}${edge.label ? ` [${edge.label}]` : ''}`,
  );
}
