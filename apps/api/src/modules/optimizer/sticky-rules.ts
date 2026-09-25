import {
  N8nWorkflow,
  StickyNote,
  StickyZones,
  buildStickyZones,
  computeZoneRect,
  isDefaultStickyContent,
  rectArea,
  rectsPartiallyOverlap,
  CheckFinding,
} from '@nwm/core';

/** En dessous de cette aire, une sticky documentée sans nœud est une étiquette volontaire. */
const LABEL_MAX_AREA = 96_000; // ≈ 400×240
/** Une sticky est surdimensionnée si son aire dépasse 4× la zone utile ET de plus de 100 000 px². */
const OVERSIZED_RATIO = 4;
const OVERSIZED_MIN_GAP = 100_000;

function hasOwnContent(sticky: StickyNote): boolean {
  return !isDefaultStickyContent(sticky.content);
}

function isDocumented(zones: StickyZones, name: string | null | undefined): boolean {
  if (!name) return false;
  const sticky = zones.stickies.find((s) => s.name === name);
  return !!sticky && hasOwnContent(sticky);
}

/**
 * Règles prudentes sur les zones sticky : tout en severity `info`, avec des exclusions
 * hiérarchiques pour éviter les faux positifs (un parent documenté ou des enfants
 * documentés suffisent à documenter une zone).
 */
export function findStickyIssues(workflow: N8nWorkflow): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const zones = buildStickyZones(workflow);
  if (zones.stickies.length === 0) return findings;

  const nodePositions = new Map(workflow.nodes.filter((n) => n.position).map((n) => [n.name, n.position!]));
  const usesZones = zones.stickies.some((s) => (zones.nodesByZone.get(s.name) ?? []).length > 0);

  // 1. Nœuds hors de toute zone — uniquement si le workflow pratique déjà les zones.
  if (usesZones && zones.uncoveredNodes.length > 0) {
    findings.push({
      severity: 'info',
      code: 'sticky-uncovered-nodes',
      message: `${zones.uncoveredNodes.length} nœud(s) hors de toute zone sticky : ${zones.uncoveredNodes.join(', ')}`,
      data: { names: zones.uncoveredNodes },
    });
  }

  for (const sticky of zones.stickies) {
    const nodes = zones.nodesByZone.get(sticky.name) ?? [];
    const children = zones.childrenOf.get(sticky.name) ?? [];
    const parentName = zones.parentOf.get(sticky.name);

    // 2. Zone vide (ni nœud ni sticky enfant). Une petite sticky documentée est une étiquette.
    if (nodes.length === 0 && children.length === 0) {
      const isLabel = hasOwnContent(sticky) && rectArea(sticky.rect) < LABEL_MAX_AREA;
      if (!isLabel) {
        findings.push({
          severity: 'info',
          code: 'sticky-empty-zone',
          message: `La sticky "${sticky.name}" ne couvre aucun nœud`,
          nodeName: sticky.name,
          data: { stickyName: sticky.name },
        });
      }
    }

    // 3. Contenu manquant — sauf si le parent direct ou tous les enfants directs documentent la zone.
    if (!hasOwnContent(sticky) && nodes.length > 0) {
      const parentDocuments = isDocumented(zones, parentName);
      const childrenDocument = children.length > 0 && children.every((child) => isDocumented(zones, child));
      if (!parentDocuments && !childrenDocument) {
        findings.push({
          severity: 'info',
          code: 'sticky-missing-content',
          message: `La sticky "${sticky.name}" couvre ${nodes.length} nœud(s) sans les documenter`,
          nodeName: sticky.name,
          data: { stickyName: sticky.name, kind: sticky.content.trim() ? 'default' : 'empty' },
        });
      }
    }

    // 4. Surdimensionnée par rapport aux nœuds couverts — un parent de regroupement est
    // naturellement grand, on ne juge que les zones feuilles.
    if (nodes.length > 0 && children.length === 0) {
      const positions = nodes
        .map((name) => nodePositions.get(name))
        .filter((p): p is [number, number] => !!p);
      if (positions.length > 0) {
        const usefulArea = rectArea(computeZoneRect(positions));
        const area = rectArea(sticky.rect);
        if (area > OVERSIZED_RATIO * usefulArea && area - usefulArea > OVERSIZED_MIN_GAP) {
          findings.push({
            severity: 'info',
            code: 'sticky-oversized',
            message: `La sticky "${sticky.name}" est bien plus grande que la zone de ses ${nodes.length} nœud(s)`,
            nodeName: sticky.name,
            data: { stickyName: sticky.name, area, usefulArea },
          });
        }
      }
    }

    // 5. Même couleur que le parent direct : l'imbrication devient invisible.
    if (parentName) {
      const parent = zones.stickies.find((s) => s.name === parentName);
      if (parent && (sticky.color ?? 1) === (parent.color ?? 1)) {
        findings.push({
          severity: 'info',
          code: 'sticky-color-clash',
          message: `La sticky "${sticky.name}" a la même couleur que sa zone parente "${parentName}"`,
          nodeName: sticky.name,
          data: { stickyName: sticky.name, parentName, color: sticky.color ?? 1 },
        });
      }
    }
  }

  // 6. Chevauchements partiels (ni imbrication ni disjonction) — un finding par paire.
  for (let i = 0; i < zones.stickies.length; i++) {
    for (let j = i + 1; j < zones.stickies.length; j++) {
      const a = zones.stickies[i];
      const b = zones.stickies[j];
      if (rectsPartiallyOverlap(a.rect, b.rect)) {
        findings.push({
          severity: 'info',
          code: 'sticky-overlap',
          message: `Les stickies "${a.name}" et "${b.name}" se chevauchent sans s'imbriquer`,
          nodeName: a.name,
          data: { stickies: [a.name, b.name] },
        });
      }
    }
  }

  return findings;
}
