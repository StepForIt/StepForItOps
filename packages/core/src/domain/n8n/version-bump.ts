import { BumpLevel } from '../semver';
import { WorkflowDiff } from './workflow-diff';
import { isStickyNote, isTriggerNode } from './workflow-graph';

export interface BumpProposal {
  level: BumpLevel;
  /** Une phrase : ce qui, dans le changement, décide du digit. */
  reason: string;
}

/** Champs d'un nœud dont le changement ne change rien à ce que le workflow FAIT. */
const COSMETIC_FIELDS = new Set(['position', 'notes', 'notesInFlow', 'color', 'id']);

/**
 * Quel digit un changement mérite, décidé sur le diff et rien d'autre. Sert de
 * proposition par défaut ET de repli quand l'IA est absente ou muette : le niveau
 * ne doit jamais dépendre de la disponibilité d'une clé API.
 *
 * La ligne de partage est ce que le changement fait au CONTRAT du workflow — son
 * déclencheur, son nom, ce qu'il ne fait plus — puis à ce qu'il fait de plus.
 */
export function suggestBumpLevel(diff: WorkflowDiff): BumpProposal {
  const nodes = diff.nodes.filter((node) => !isStickyNote({ type: node.nodeType }));

  const removed = nodes.filter((node) => node.change === 'removed');
  if (removed.length > 0) {
    return {
      level: 'major',
      reason: `${removed.length} nœud(s) retiré(s) (${removed.map((n) => n.name).join(', ')}) : le workflow ne fait plus une partie de ce qu'il faisait.`,
    };
  }

  // Un trigger déplacé sur le canevas n'est pas un contrat qui change : seul compte
  // ce qui touche à son déclenchement (URL de webhook, planning cron, type de nœud).
  const triggers = nodes.filter(
    (node) =>
      isTriggerNode({ type: node.nodeType }) &&
      (node.change !== 'modified' || node.fields.some((field) => !COSMETIC_FIELDS.has(field))),
  );
  if (triggers.length > 0) {
    return {
      level: 'major',
      reason: `Déclencheur touché (${triggers.map((n) => n.name).join(', ')}) : c'est le point d'entrée du workflow qui change.`,
    };
  }

  if (diff.nameChange) {
    return {
      level: 'major',
      reason: `Renommé « ${diff.nameChange.before} » → « ${diff.nameChange.after} » : c'est le nom qui apparie les exemplaires d'un env à l'autre.`,
    };
  }

  const added = nodes.filter((node) => node.change === 'added');
  if (added.length > 0) {
    return {
      level: 'minor',
      reason: `${added.length} nœud(s) ajouté(s) (${added.map((n) => n.name).join(', ')}) : le workflow fait quelque chose de plus.`,
    };
  }

  if (diff.connections.changed) {
    return {
      level: 'minor',
      reason: 'Câblage modifié : le chemin des données change sans que rien ne disparaisse.',
    };
  }

  const substantial = nodes.filter(
    (node) => node.change !== 'renamed' && node.fields.some((field) => !COSMETIC_FIELDS.has(field)),
  );
  if (substantial.length > 0) {
    return {
      level: 'patch',
      reason: `Réglages ajustés sur ${substantial.length} nœud(s) (${substantial.map((n) => n.name).join(', ')}).`,
    };
  }

  return {
    level: 'patch',
    reason: diff.hasChanges
      ? 'Changements de forme seulement (position, notes, renommage de nœud).'
      : 'Contenu identique à la cible : la promotion ne fait que reposer le même workflow.',
  };
}

const RANK: Record<BumpLevel, number> = { patch: 0, minor: 1, major: 2 };
const BY_RANK: BumpLevel[] = ['patch', 'minor', 'major'];

/**
 * Plus haut niveau qu'un avis d'IA peut proposer : un cran au-dessus de la règle.
 * L'IA lit ce que la règle ne sait pas lire (« ce paramètre change le destinataire »),
 * mais elle ne décide pas seule d'une majeure sur un réglage : c'est la règle qui dit
 * si quelque chose a disparu ou si le point d'entrée a bougé, et une réponse qui
 * interprète un libellé d'affichage comme un contrat brisé saute deux crans d'un coup.
 */
export function aiBumpCeiling(rules: BumpLevel): BumpLevel {
  return BY_RANK[Math.min(RANK[rules] + 1, BY_RANK.length - 1)];
}

/** Le niveau proposé par l'IA, ramené sous le plafond ; `capped` dit s'il a fallu le faire. */
export function capAiBump(rules: BumpLevel, proposed: BumpLevel): { level: BumpLevel; capped: boolean } {
  const ceiling = aiBumpCeiling(rules);
  return RANK[proposed] > RANK[ceiling]
    ? { level: ceiling, capped: true }
    : { level: proposed, capped: false };
}
