/**
 * Détection des paramètres restés à leur valeur d'exemple : `YOUR_API_KEY`,
 * `<votre-domaine>`, `example.com`, `changeme`. C'est le pendant de
 * `reliability-checks.ts`, qui écarte volontairement ces valeurs de la chasse
 * aux secrets — un placeholder n'est pas un secret qui fuit, c'est un nœud qui
 * n'a jamais été configuré, et personne ne le signalait.
 *
 * Le nœud a l'air branché, n8n ne dit rien, et l'erreur n'arrive qu'à la
 * première exécution réelle.
 */

import { N8nWorkflow } from './workflow.types';
import { isStickyNote } from './workflow-graph';
import { activeParameters } from './inert-params';

export interface PlaceholderFinding {
  severity: 'warning';
  code: 'param-placeholder';
  message: string;
  nodeName: string;
  data: { path: string; excerpt: string; suggestion: string };
}

/**
 * Formes reconnues sans ambiguïté. Chaque motif doit rester assez étroit pour
 * qu'une vraie valeur ne le déclenche pas : le bruit ici pousse à ignorer la
 * règle entière.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\byour[_-]\w+/i, //           YOUR_API_KEY, your-domain
  /\byour (?:api|token|key|secret|email|domain|url|id|name|value)\b/i,
  /<(?:your|my|insert|enter|add|api|token|key|id|url|email|placeholder)[^>]{0,40}>/i,
  /\bxxx+\b/i,
  /\bchange[_ -]?me\b/i,
  /\breplace[_ -]?me\b/i,
  /\bto[_ -]?replace\b/i,
  /(?:^|[^\w])[aà] remplacer\b/i,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /\bexample\.(?:com|org|net)\b/i,
  /\b\w+@(?:example|test|domain)\.\w+/i,
];

/**
 * Cette valeur a-t-elle la forme d'un exemple jamais remplacé ?
 *
 * Exportée parce que la même question se pose ailleurs que dans l'analyse : quand
 * l'humain corrige une valeur écrite par l'assistant, savoir si l'assistant avait
 * posé un gabarit ou une vraie valeur décide si la correction s'apprend
 * (cf. `correction-lesson.ts`). La liste de motifs doit rester unique — deux
 * définitions de « une valeur d'exemple » divergent en un mois.
 *
 * À ne pas confondre avec le `looksLikePlaceholder` de `finding-noise.ts`, qui
 * répond à une autre question : celui-là reconnaît les gabarits de FORME
 * (`[productId]`, `<id>`, `%TOKEN%`) dans un extrait de code cité par l'IA.
 */
export function looksLikeExampleValue(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Paramètres laissés au module qui sait les lire. Le code d'un nœud Code part
 * chez `js-checker`, avec sa ligne et son extrait — un `TODO` y est une
 * remarque de code, pas un nœud mal configuré.
 */
const IGNORED_KEYS = new Set(['jsCode', 'pythonCode', 'code']);

/** Ce que la valeur montre du problème, sans recopier un paramètre entier. */
function excerpt(value: string, match: string): string {
  if (value.length <= 60) return value;
  const at = value.indexOf(match);
  const start = Math.max(0, at - 20);
  return `…${value.slice(start, at + match.length + 20)}…`;
}

interface Hit {
  path: string;
  excerpt: string;
}

function findPlaceholders(value: unknown, path = '$'): Hit[] {
  const hits: Hit[] = [];

  const walk = (node: unknown, at: string, key?: string): void => {
    if (key && IGNORED_KEYS.has(key)) return;
    if (typeof node === 'string') {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        const match = node.match(pattern);
        if (match) {
          hits.push({ path: at, excerpt: excerpt(node, match[0]) });
          return;
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`, key));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, `${at}.${childKey}`, childKey);
      }
    }
  };

  walk(value, path);
  return hits;
}

/** Nombre de placeholders signalés par nœud : au-delà, c'est le nœud entier qui est à faire. */
const MAX_PER_NODE = 3;

export function runPlaceholderChecks(workflow: N8nWorkflow): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];

  for (const node of workflow.nodes ?? []) {
    if (isStickyNote(node) || node.disabled) continue;
    const hits = findPlaceholders(activeParameters(node)).slice(0, MAX_PER_NODE);
    for (const hit of hits) {
      findings.push({
        severity: 'warning',
        code: 'param-placeholder',
        message: `"${node.name}" garde une valeur d'exemple (${hit.excerpt})`,
        nodeName: node.name,
        data: {
          path: hit.path,
          excerpt: hit.excerpt,
          suggestion:
            `Renseigner ${hit.path.replace(/^\$\./, '')} avec la vraie valeur : ` +
            'le nœud a l’air configuré, mais l’appel partira sur une valeur d’exemple ' +
            'et n’échouera qu’à la première exécution réelle.',
        },
      });
    }
  }

  return findings;
}
