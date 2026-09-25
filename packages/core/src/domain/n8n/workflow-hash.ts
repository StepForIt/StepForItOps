import { createHash } from 'crypto';
import { N8nWorkflow } from './workflow.types';
import { stableJson } from '../stable-json';

/** Hash stable du contenu significatif d'un workflow (ignore updatedAt & co). */
export function hashWorkflow(workflow: N8nWorkflow): string {
  const significant = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {},
    pinData: workflow.pinData ?? {},
  };
  return createHash('sha256').update(stableJson(significant)).digest('hex');
}
