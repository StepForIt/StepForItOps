import { N8nWorkflow } from './workflow.types';
import { isStickyNote } from './workflow-graph';

/** Dimensions par défaut d'une sticky n8n quand parameters.width/height sont absents. */
export const STICKY_DEFAULT_WIDTH = 240;
export const STICKY_DEFAULT_HEIGHT = 160;
/** Empreinte visuelle approximative d'un nœud sur le canvas (sa position est son coin haut-gauche). */
export const NODE_APPROX_WIDTH = 200;
export const NODE_APPROX_HEIGHT = 120;
/** Marges ajoutées autour d'une zone créée ; le haut est plus grand pour laisser la place au titre. */
export const ZONE_PADDING_X = 60;
export const ZONE_PADDING_TOP = 90;
export const ZONE_PADDING_BOTTOM = 60;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sticky note n8n vue comme une zone géométrique du canvas. */
export interface StickyNote {
  name: string;
  content: string;
  /** Index couleur n8n (1..7) ; absent = jaune par défaut. */
  color?: number;
  rect: Rect;
}

export interface StickyZones {
  stickies: StickyNote[];
  /** sticky → nom de la plus petite sticky strictement englobante (null si top-level). */
  parentOf: Map<string, string | null>;
  /** sticky → stickies directement imbriquées. */
  childrenOf: Map<string, string[]>;
  /** sticky → nœuds (non-sticky) contenus DIRECTEMENT (attribués à la plus petite sticky). */
  nodesByZone: Map<string, string[]>;
  /** Nœuds (non-sticky, positionnés) hors de toute sticky. */
  uncoveredNodes: string[];
}

function toDimension(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseStickyNotes(workflow: N8nWorkflow): StickyNote[] {
  const stickies: StickyNote[] = [];
  for (const node of workflow.nodes) {
    if (!isStickyNote(node) || !node.position) continue;
    const params = node.parameters ?? {};
    const color = Number(params.color);
    stickies.push({
      name: node.name,
      content: typeof params.content === 'string' ? params.content : '',
      ...(Number.isFinite(color) && color > 0 ? { color } : {}),
      rect: {
        x: node.position[0],
        y: node.position[1],
        width: toDimension(params.width, STICKY_DEFAULT_WIDTH),
        height: toDimension(params.height, STICKY_DEFAULT_HEIGHT),
      },
    });
  }
  return stickies;
}

export function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}

export function rectContainsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Contenance complète, avec tolérance pour les bords alignés à la main. */
export function rectContainsRect(outer: Rect, inner: Rect, epsilon = 1): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

/**
 * Intersection non triviale (profondeur > minDepth sur les deux axes) sans qu'aucun
 * rectangle ne contienne l'autre — un simple frôlement de bords n'est pas un chevauchement.
 */
export function rectsPartiallyOverlap(a: Rect, b: Rect, minDepth = 10): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlapX <= minDepth || overlapY <= minDepth) return false;
  return !rectContainsRect(a, b) && !rectContainsRect(b, a);
}

const DEFAULT_CONTENT_PATTERN = /i'm a note|double click/i;

/** Contenu vide ou laissé au texte par défaut n8n (« I'm a note… Double click… »). */
export function isDefaultStickyContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length === 0 || DEFAULT_CONTENT_PATTERN.test(trimmed);
}

/** La plus petite sticky (par aire) satisfaisant le prédicat, ou undefined. */
function smallestSticky(
  candidates: StickyNote[],
  predicate: (s: StickyNote) => boolean,
): StickyNote | undefined {
  let best: StickyNote | undefined;
  for (const sticky of candidates) {
    if (!predicate(sticky)) continue;
    if (!best || rectArea(sticky.rect) < rectArea(best.rect)) best = sticky;
  }
  return best;
}

/**
 * Reconstruit les zones visuelles d'un workflow : hiérarchie des stickies (imbrication)
 * et appartenance des nœuds à leur zone. Choix conservateurs : containment par le point
 * `position` du nœud, attribution à la plus petite sticky englobante, nœuds sans
 * position jamais comptés comme non couverts.
 */
export function buildStickyZones(workflow: N8nWorkflow): StickyZones {
  const stickies = parseStickyNotes(workflow);
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>(stickies.map((s) => [s.name, []]));
  const nodesByZone = new Map<string, string[]>(stickies.map((s) => [s.name, []]));
  const uncoveredNodes: string[] = [];

  for (const sticky of stickies) {
    // Aire strictement supérieure : deux stickies de même rect ne sont pas parentes l'une de l'autre.
    const parent = smallestSticky(
      stickies,
      (candidate) =>
        candidate.name !== sticky.name &&
        rectArea(candidate.rect) > rectArea(sticky.rect) &&
        rectContainsRect(candidate.rect, sticky.rect),
    );
    parentOf.set(sticky.name, parent?.name ?? null);
    if (parent) childrenOf.get(parent.name)!.push(sticky.name);
  }

  for (const node of workflow.nodes) {
    if (isStickyNote(node) || !node.position) continue;
    const [x, y] = node.position;
    const zone = smallestSticky(stickies, (sticky) => rectContainsPoint(sticky.rect, x, y));
    if (zone) nodesByZone.get(zone.name)!.push(node.name);
    else uncoveredNodes.push(node.name);
  }

  return { stickies, parentOf, childrenOf, nodesByZone, uncoveredNodes };
}

/** Rectangle englobant une liste de positions de nœuds, empreinte nœud et marges comprises. */
export function computeZoneRect(nodePositions: Array<[number, number]>): Rect {
  const xs = nodePositions.map(([x]) => x);
  const ys = nodePositions.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX - ZONE_PADDING_X,
    y: minY - ZONE_PADDING_TOP,
    width: maxX - minX + NODE_APPROX_WIDTH + 2 * ZONE_PADDING_X,
    height: maxY - minY + NODE_APPROX_HEIGHT + ZONE_PADDING_TOP + ZONE_PADDING_BOTTOM,
  };
}
