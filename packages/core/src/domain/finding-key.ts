/**
 * Empreinte d'un message de finding : sert de chemin d'appariement supplémentaire
 * pour les règles d'exclusion, quand le nœud visé a été renommé ou a disparu.
 *
 * La normalisation est volontairement grossière — casse, accents, ponctuation,
 * guillemets et nombres neutralisés — parce que deux passes d'IA reformulent
 * rarement à l'identique mais varient souvent sur ces détails-là. Elle ne
 * prétend pas rattraper une vraie reformulation : c'est le rôle du prompt, qui
 * reçoit les remarques déjà déclarées normales.
 */
export function findingMessageKey(message: string): string {
  return message
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Ce qu'une règle d'exclusion porte d'utile à l'appariement. */
export interface FindingIgnoreRule {
  code: string;
  nodeName: string | null;
  /** Id n8n du nœud visé, quand la règle a été créée après l'ancrage par id. */
  nodeId: string | null;
  /** Empreinte du message d'origine, quand la règle la porte. */
  messageKey: string | null;
}

/** Finding candidat, tel que les modules d'analyse le produisent (avant persistance). */
export interface IgnorableFinding {
  code: string;
  nodeName?: string | null;
  message?: string;
}

/**
 * Une règle couvre-t-elle ce finding ? Le code doit correspondre ; le nœud est
 * reconnu par son NOM, par son ID n8n (le nom change, l'id non), ou à défaut par
 * l'empreinte du message — même remarque, nœud renommé ou déplacé. Sans ces deux
 * derniers chemins, un simple renommage faisait revenir un finding déclaré normal,
 * sans rien dire à personne.
 */
export function findingIgnoreCovers(
  rule: FindingIgnoreRule,
  finding: IgnorableFinding,
  nodeIdByName: ReadonlyMap<string, string> = new Map(),
): boolean {
  if (rule.code !== finding.code) return false;
  if (rule.nodeName === null && rule.nodeId === null) return true; // règle « n'importe quel nœud »
  const nodeName = finding.nodeName ?? null;
  if (rule.nodeName !== null && rule.nodeName === nodeName) return true;
  if (rule.nodeId !== null && nodeName !== null && nodeIdByName.get(nodeName) === rule.nodeId) return true;
  return (
    rule.messageKey !== null &&
    finding.message !== undefined &&
    findingMessageKey(finding.message) === rule.messageKey
  );
}
