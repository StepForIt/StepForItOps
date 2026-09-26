import { msg } from '../../i18n';
import { N8nConnections, N8nNode } from './workflow.types';

/**
 * Ce qu'un changement FAIT, dit en clair. Un diff JSON montre quels caractères
 * bougent ; il ne dit pas qu'on vient de retirer le samedi du planning. C'est cette
 * phrase-là qu'on lit avant de cliquer « Appliquer ».
 */
export interface ChangeExplanation {
  text: string;
  /** Chemin visé dans le JSON du nœud, pour retrouver la ligne dans le diff. */
  path?: string;
  /** `warning` quand l'effet déborde du nœud (exécution coupée, credential, câblage). */
  level: 'info' | 'warning';
}

/** Au-delà, on résume : une revue n'est pas une liste de courses. */
const MAX_EXPLANATIONS = 12;
const MAX_VALUE_LENGTH = 90;

/** Clés de jour du catalogue, dans l'ordre de cron (0 = dimanche). */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dayName(index: number): string | null {
  const day = DAY_KEYS[index % 7];
  return day ? msg('edit.cronDay', { day }) : null;
}

function quote(value: unknown): string {
  if (value === undefined) return msg('edit.valueEmpty');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') return msg('edit.valueEmpty');
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/** Liste de jours en toutes lettres : `1-5` → « du lundi au vendredi », `1,3` → « lundi et mercredi ». */
function describeWeekdays(field: string): string | null {
  if (field === '*' || field === '?') return msg('edit.cronEveryDay');
  const range = /^(\d)-(\d)$/.exec(field);
  if (range) {
    const start = dayName(Number(range[1]));
    const end = dayName(Number(range[2]));
    return start && end ? msg('edit.cronDayRange', { start, end }) : null;
  }
  if (/^\d(,\d)*$/.test(field)) {
    const days = field.split(',').map((d) => dayName(Number(d)));
    if (days.some((d) => !d)) return null;
    return days.length === 1
      ? msg('edit.cronOneDay', { day: days[0] })
      : msg('edit.cronDayList', { first: days.slice(0, -1).join(', '), last: days[days.length - 1] });
  }
  return null;
}

/**
 * Traduit une expression cron courante (« 0 10 * * 1-5 » → « du lundi au vendredi à 10:00 »).
 * Rend `null` dès qu'un champ sort de l'ordinaire : mieux vaut montrer l'expression brute
 * qu'en donner une lecture fausse.
 */
export function describeCron(expression: string): string | null {
  const parts = expression.trim().split(/\s+/);
  // n8n accepte la forme à 6 champs (secondes en tête) : on ne décrit que « à la seconde 0 ».
  if (parts.length === 6) {
    if (parts[0] !== '0') return null;
    parts.shift();
  }
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  if (month !== '*') return null;
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

  if (dayOfMonth !== '*' && dayOfMonth !== '?') {
    if (dayOfWeek !== '*' && dayOfWeek !== '?') return null;
    if (!/^\d+$/.test(dayOfMonth)) return null;
    return msg('edit.cronMonthly', { day: dayOfMonth, time });
  }
  const days = describeWeekdays(dayOfWeek);
  return days ? msg('edit.cronAt', { days, time }) : null;
}

/** Feuilles scalaires d'un objet, indexées par chemin (`rule.interval[0].expression`). */
function leaves(value: unknown, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leaves(item, `${prefix}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

/**
 * Nombre de paramètres qu'un nœud PERD dans le changement.
 *
 * C'est le seul chiffre qui distingue « on a retiré un champ » de « l'objet a été
 * réécrit de mémoire » : une IA qui veut supprimer une sous-clé renvoie souvent le
 * bloc entier, amputé de tout ce qu'elle ne sait pas recopier — le `schema` d'un
 * resourceMapper, par exemple, fait des centaines de feuilles que personne ne
 * relit dans un diff.
 */
export function lostLeafCount(before: unknown, after: unknown): number {
  const afterLeaves = leaves(after ?? {});
  let lost = 0;
  for (const path of leaves(before ?? {}).keys()) if (!afterLeaves.has(path)) lost += 1;
  return lost;
}

/** Au-delà, on ne parle plus d'une retouche : on le dit en orange, avant le reste. */
export const MASS_LEAF_LOSS = 20;

/** Dernier segment d'un chemin, sans son index : ce que l'utilisateur reconnaît dans n8n. */
function fieldName(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last.replace(/\[\d+\]$/, '');
}

/** Une valeur de cron se raconte, elle ne se recopie pas. */
function describeValueChange(path: string, before: unknown, after: unknown): string | null {
  const looksLikeCron =
    fieldName(path).toLowerCase().includes('cron') ||
    (path.endsWith('expression') && typeof after === 'string' && /^(\S+\s+){4,5}\S+$/.test(after));
  if (!looksLikeCron) return null;

  const from = typeof before === 'string' ? describeCron(before) : null;
  const to = typeof after === 'string' ? describeCron(after) : null;
  if (from && to) return msg('edit.triggerChange', { from, to });
  if (to) return msg('edit.triggerSet', { to, before: quote(before) });
  return null;
}

/** Changements feuille à feuille entre deux objets JSON (paramètres, réglages). */
export function explainLeafChanges(before: unknown, after: unknown): ChangeExplanation[] {
  const beforeLeaves = leaves(before ?? {});
  const afterLeaves = leaves(after ?? {});
  const paths = new Set([...beforeLeaves.keys(), ...afterLeaves.keys()]);
  const out: ChangeExplanation[] = [];

  for (const path of paths) {
    const previous = beforeLeaves.get(path);
    const next = afterLeaves.get(path);
    if (JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) continue;

    const told = describeValueChange(path, previous, next);
    if (told) {
      out.push({ text: told, path, level: 'info' });
    } else if (!beforeLeaves.has(path)) {
      out.push({
        text: msg('edit.paramAdded', { field: fieldName(path), value: quote(next) }),
        path,
        level: 'info',
      });
    } else if (!afterLeaves.has(path)) {
      out.push({
        text: msg('edit.paramRemoved', { field: fieldName(path), value: quote(previous) }),
        path,
        level: 'info',
      });
    } else {
      out.push({
        text: msg('edit.paramChanged', { field: fieldName(path), from: quote(previous), to: quote(next) }),
        path,
        level: 'info',
      });
    }
  }
  return out;
}

function credentialNames(node: N8nNode): string {
  const entries = Object.values(node.credentials ?? {}).map((c) => c.name ?? c.id ?? '?');
  return entries.length ? entries.join(', ') : msg('edit.noCredential');
}

function capped(out: ChangeExplanation[], what: 'fields' | 'links'): ChangeExplanation[] {
  if (out.length <= MAX_EXPLANATIONS) return out;
  const rest = out.length - MAX_EXPLANATIONS;
  return [...out.slice(0, MAX_EXPLANATIONS), { text: msg('edit.cappedMore', { rest, what }), level: 'info' }];
}

/**
 * Ce que devient un nœud, du point de vue de son travail. `before` absent = nœud ajouté,
 * `after` absent = nœud supprimé.
 */
export function explainNodeChange(before?: N8nNode, after?: N8nNode): ChangeExplanation[] {
  if (!before && !after) return [];
  if (!before && after) {
    return [
      { text: msg('edit.nodeAdded', { name: after.name, type: after.type.split('.').pop() }), level: 'info' },
    ];
  }
  if (before && !after) {
    return [{ text: msg('edit.nodeRemoved', { name: before.name }), level: 'warning' }];
  }

  const from = before as N8nNode;
  const to = after as N8nNode;
  const out: ChangeExplanation[] = [];

  if (from.name !== to.name) {
    out.push({
      text: msg('edit.nodeRenamed', { from: from.name, to: to.name }),
      level: 'warning',
    });
  }
  if ((from.disabled ?? false) !== (to.disabled ?? false)) {
    out.push({
      text: to.disabled ? msg('edit.nodeDisabled') : msg('edit.nodeEnabled'),
      level: 'warning',
    });
  }
  if (from.type !== to.type) {
    out.push({ text: msg('edit.typeChanged', { from: from.type, to: to.type }), level: 'warning' });
  }
  if (JSON.stringify(from.credentials ?? {}) !== JSON.stringify(to.credentials ?? {})) {
    out.push({
      text: msg('edit.credentialChanged', { from: credentialNames(from), to: credentialNames(to) }),
      level: 'warning',
    });
  }
  if (
    (from.onError ?? null) !== (to.onError ?? null) ||
    (from.retryOnFail ?? false) !== (to.retryOnFail ?? false)
  ) {
    out.push({ text: msg('edit.errorHandlingChanged'), level: 'warning' });
  }

  // Dit AVANT le détail, et en orange : le cap de `capped` reléguait la perte de
  // 800 champs derrière un « … et N autre(s) champ(s) modifié(s) » que personne ne lit.
  const lost = lostLeafCount(from.parameters ?? {}, to.parameters ?? {});
  if (lost >= MASS_LEAF_LOSS) {
    out.push({
      text: msg('edit.massLoss', { lost }),
      level: 'warning',
    });
  }

  out.push(...explainLeafChanges(from.parameters ?? {}, to.parameters ?? {}));

  // Un déplacement seul mérite d'être dit : sans cette ligne, un diff de `position`
  // laisse croire à un changement de comportement.
  if (!out.length && JSON.stringify(from.position ?? null) !== JSON.stringify(to.position ?? null)) {
    out.push({ text: msg('edit.moved'), level: 'info' });
  }

  return capped(out, 'fields');
}

interface Edge {
  from: string;
  to: string;
  outputType: string;
  outputIndex: number;
}

function edgeList(connections: N8nConnections | undefined): Edge[] {
  const edges: Edge[] = [];
  for (const [from, byType] of Object.entries(connections ?? {})) {
    for (const [outputType, outputs] of Object.entries(byType ?? {})) {
      (outputs ?? []).forEach((targets, outputIndex) => {
        for (const target of targets ?? []) {
          edges.push({ from, to: target.node, outputType, outputIndex });
        }
      });
    }
  }
  return edges;
}

const edgeKey = (edge: Edge) => `${edge.from} ${edge.outputType} ${edge.outputIndex} ${edge.to}`;

/** Numéro de sortie utile à lire : la première va de soi, la deuxième est la branche « faux ». */
function outputSuffix(edge: Edge): string {
  const parts: string[] = [];
  if (edge.outputType !== 'main') parts.push(edge.outputType);
  if (edge.outputIndex > 0) parts.push(msg('edit.outputNumber', { n: edge.outputIndex + 1 }));
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * Le câblage en clair : un diff du bloc `connections` est illisible, alors que
 * « X n'alimente plus Y » se comprend d'un coup d'œil.
 */
export function explainConnectionChanges(
  before: N8nConnections | undefined,
  after: N8nConnections | undefined,
): ChangeExplanation[] {
  const beforeEdges = new Map(edgeList(before).map((e) => [edgeKey(e), e]));
  const afterEdges = new Map(edgeList(after).map((e) => [edgeKey(e), e]));
  const out: ChangeExplanation[] = [];

  for (const [key, edge] of afterEdges) {
    if (!beforeEdges.has(key)) {
      out.push({
        text: msg('edit.edgeAdded', { from: edge.from, to: edge.to, suffix: outputSuffix(edge) }),
        level: 'warning',
      });
    }
  }
  for (const [key, edge] of beforeEdges) {
    if (!afterEdges.has(key)) {
      out.push({
        text: msg('edit.edgeRemoved', { from: edge.from, to: edge.to, suffix: outputSuffix(edge) }),
        level: 'warning',
      });
    }
  }

  return capped(out, 'links');
}
