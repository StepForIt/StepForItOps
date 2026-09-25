import { renameNodeRefsInString } from './expression-refs';
import { N8nConnections, N8nWorkflow } from './workflow.types';

export interface RenameSpec {
  oldName: string;
  newName: string;
}

function renameInValue(value: unknown, renames: RenameSpec[]): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const r of renames) result = renameNodeRefsInString(result, r.oldName, r.newName);
    return result;
  }
  if (Array.isArray(value)) return value.map((v) => renameInValue(v, renames));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, renameInValue(v, renames)]),
    );
  }
  return value;
}

/**
 * Renomme des nœuds SANS casser le workflow :
 * nodes.name, connections (clés + cibles), pinData (clés) et expressions.
 */
export function safeRenameNodes(workflow: N8nWorkflow, renames: RenameSpec[]): N8nWorkflow {
  const nameMap = new Map(renames.map((r) => [r.oldName, r.newName]));
  const mapName = (name: string): string => nameMap.get(name) ?? name;

  const nodes = workflow.nodes.map((node) => ({
    ...node,
    name: mapName(node.name),
    parameters: renameInValue(node.parameters ?? {}, renames) as Record<string, unknown>,
  }));

  const connections: N8nConnections = {};
  for (const [from, byType] of Object.entries(workflow.connections ?? {})) {
    connections[mapName(from)] = Object.fromEntries(
      Object.entries(byType).map(([outputType, outputs]) => [
        outputType,
        outputs.map((targets) => targets.map((t) => ({ ...t, node: mapName(t.node) }))),
      ]),
    );
  }

  const pinData = workflow.pinData
    ? Object.fromEntries(Object.entries(workflow.pinData).map(([k, v]) => [mapName(k), v]))
    : undefined;

  return { ...workflow, nodes, connections, ...(pinData ? { pinData } : {}) };
}
