/**
 * Quelles credentials existent sur une instance, et laquelle poser sur un nœud
 * qu'on ajoute.
 *
 * L'API publique n8n ne sait pas les lister — mais chaque nœud porte les siennes
 * (`credentials: { notionApi: { id, name } }`), et le miroir local garde le JSON
 * n8n verbatim. La liste se relève donc dans les workflows de l'instance, sans
 * appel supplémentaire et sans secret : un id et un nom, jamais un jeton.
 *
 * Le type de credential attendu par un type de nœud n'est écrit nulle part de
 * notre côté — n8n seul le sait. On l'apprend par l'usage : ce que portent les
 * autres nœuds du MÊME type sur cette instance. C'est aussi ce qui rend la
 * réponse juste quand un nœud accepte plusieurs authentifications.
 *
 * Limite assumée : une credential qu'aucun workflow n'utilise encore reste
 * invisible. Elle se rattache dans n8n, et le nœud le dit dans ses notes.
 */

import { N8nWorkflow } from './workflow.types';

/** Une credential vue sur l'instance, avec ce qui permet de la préférer à une autre. */
export interface CredentialRef {
  /** Clé n8n du type de credential : `notionApi`, `openAiApi`… */
  type: string;
  id: string;
  name: string;
  /** Nombre de nœuds qui s'en servent sur l'instance — départage les homonymes. */
  uses: number;
}

/** Une credential telle qu'elle apparaît sur un nœud précis. */
export interface CredentialSighting {
  type: string;
  id: string;
  name?: string;
  nodeName: string;
  nodeType: string;
}

/**
 * Relevé brut, nœud par nœud. C'est LA définition de « où sont les credentials »,
 * partagée par tous ceux qui posent la question — sans elle, chaque appelant
 * refaisait sa propre traversée et elles divergeaient.
 */
export function credentialSightings(workflow: N8nWorkflow): CredentialSighting[] {
  const sightings: CredentialSighting[] = [];
  for (const node of workflow.nodes ?? []) {
    for (const [type, credential] of Object.entries(node.credentials ?? {})) {
      if (!credential?.id) continue;
      sightings.push({
        type,
        id: credential.id,
        name: credential.name,
        nodeName: node.name,
        nodeType: node.type,
      });
    }
  }
  return sightings;
}

/** Toutes les credentials relevées dans les nœuds, les plus employées en tête. */
export function collectCredentials(workflows: N8nWorkflow[]): CredentialRef[] {
  const byKey = new Map<string, CredentialRef>();
  for (const workflow of workflows) {
    for (const sighting of credentialSightings(workflow)) {
      const key = `${sighting.type} ${sighting.id}`;
      const known = byKey.get(key);
      if (known) known.uses += 1;
      else {
        byKey.set(key, {
          type: sighting.type,
          id: sighting.id,
          name: sighting.name ?? sighting.id,
          uses: 1,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

/**
 * Types de credential qu'attend un type de nœud, appris des nœuds déjà en place.
 * Les plus fréquents d'abord : un nœud HTTP porte parfois une credential exotique
 * posée une fois, elle ne doit pas passer devant l'authentification usuelle.
 */
export function credentialTypesForNode(workflows: N8nWorkflow[], nodeType: string): string[] {
  const counts = new Map<string, number>();
  for (const workflow of workflows) {
    for (const sighting of credentialSightings(workflow)) {
      if (sighting.nodeType !== nodeType) continue;
      counts.set(sighting.type, (counts.get(sighting.type) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type]) => type);
}

/** Ce qu'on retient pour un type de credential, et ce qu'on aurait pu retenir. */
export interface CredentialChoice {
  type: string;
  /** La credential posée d'office. Absente quand l'instance n'en connaît aucune. */
  chosen?: CredentialRef;
  /** Les autres candidates du même type : c'est leur existence qui impose de le dire. */
  alternatives: CredentialRef[];
}

/**
 * Une seule credential de ce type ⇒ on la pose, il n'y a rien à arbitrer.
 * Plusieurs ⇒ on pose la plus employée et on annonce les autres : deviner en
 * silence entre la prod et le bac à sable est le seul cas qui ne se rattrape pas.
 */
export function chooseCredential(available: CredentialRef[], type: string): CredentialChoice {
  const candidates = available.filter((credential) => credential.type === type);
  return { type, chosen: candidates[0], alternatives: candidates.slice(1) };
}

/** Le bloc `credentials` d'un nœud n8n, prêt à poser. */
export function credentialsPatch(choices: CredentialChoice[]): Record<string, { id: string; name: string }> {
  const patch: Record<string, { id: string; name: string }> = {};
  for (const choice of choices) {
    if (choice.chosen) patch[choice.type] = { id: choice.chosen.id, name: choice.chosen.name };
  }
  return patch;
}
