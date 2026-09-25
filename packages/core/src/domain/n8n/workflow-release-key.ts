import { createHash } from 'crypto';
import { workflowFamilyName } from '../workflow-family';
import { stableJson } from '../stable-json';
import { N8nWorkflow } from './workflow.types';

/**
 * Clé de contenu d'un exemplaire, pour répondre à UNE question : a-t-il bougé
 * depuis la promotion qui l'a mis en service ? Un exemplaire resté identique à sa
 * release n'a rien de neuf à publier — la promotion REPORTE alors son numéro au
 * lieu d'en inventer un autre.
 *
 * Deux écarts avec `hashWorkflow`, et ils font tout l'objet du fichier :
 * - le nom est réduit à son nom métier, parce que la promotion RENOMME elle-même
 *   l'exemplaire pour y reporter le numéro (« … (1.0.4) ») : pris tel quel, le nom
 *   ferait paraître sale, dès la synchro suivante, l'exemplaire qu'elle vient de
 *   publier — et le numéro décrirait alors une modification qui n'existe pas ;
 * - le `pinData` est ignoré : la promotion ne le transporte jamais, un bouchon posé
 *   pour un essai ne change rien à ce qui a été mis en service.
 *
 * La clé ne compare JAMAIS deux environnements : entre eux, noms suffixés et
 * ressources basculées diffèrent par construction. C'est le même exemplaire à deux
 * moments, et rien d'autre.
 */
export function releaseKey(workflow: N8nWorkflow): string {
  const significant = {
    name: workflowFamilyName(workflow.name ?? ''),
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {},
  };
  return createHash('sha256').update(stableJson(significant)).digest('hex');
}
