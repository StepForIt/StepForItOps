/**
 * Checks de fiabilité d'un workflow (purs, sans IO) : ce qui cassera « un jour »
 * plutôt que ce qui est déjà cassé. Complément des checks structurels du module
 * verifier — mêmes findings, même circuit FindingIgnore.
 *
 * Chaque finding embarque un correctif suggéré (`data.suggestion`) : la règle ne
 * vaut que si elle dit quoi faire.
 */

import { N8nWorkflow } from './workflow.types';
import { isStickyNote } from './workflow-graph';
import { activeParameters } from './inert-params';
import {
  MIN_SECRET_LENGTH,
  SECRET_PARAM_NAMES,
  SECRET_VALUE_PATTERNS,
  isExpression,
  isPlaceholder,
  mask,
} from '../secret-patterns';

export interface ReliabilityFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeName?: string;
  data?: Record<string, unknown>;
}

const HTTP_NODE = 'n8n-nodes-base.httpRequest';

interface SecretHit {
  path: string;
  excerpt: string;
}

/**
 * Cherche des secrets dans un arbre de paramètres. Les paires n8n
 * `{ name, value }` (headers, query, body des nœuds HTTP) sont reconnues : le
 * `name` y joue le rôle de clé.
 */
function findSecrets(value: unknown, path = '$'): SecretHit[] {
  const hits: SecretHit[] = [];

  const checkString = (text: string, at: string, paramName?: string) => {
    if (isExpression(text) || isPlaceholder(text)) return;
    for (const pattern of SECRET_VALUE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        hits.push({ path: at, excerpt: mask(match[0]) });
        return;
      }
    }
    if (paramName && SECRET_PARAM_NAMES.test(paramName)) {
      // « Bearer abc… » : c'est la partie après le schéma qui doit être longue.
      const bare = text.replace(/^(bearer|basic|token)\s+/i, '');
      if (bare.length >= MIN_SECRET_LENGTH && !/\s/.test(bare)) {
        hits.push({ path: at, excerpt: `${paramName} : ${mask(bare)}` });
      }
    }
  };

  const walk = (node: unknown, at: string, keyName?: string) => {
    if (typeof node === 'string') {
      checkString(node, at, keyName);
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`, keyName));
    } else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      // Paire n8n { name, value } : le name est la clé de la valeur.
      if (typeof record.name === 'string' && typeof record.value === 'string') {
        checkString(record.value, `${at}.value`, record.name);
        return;
      }
      for (const [key, child] of Object.entries(record)) {
        walk(child, `${at}.${key}`, key);
      }
    }
  };

  walk(value, path);
  return hits;
}

/** Checks de fiabilité : retry manquant, erreur avalée, secret en clair, timeout absent. */
export function runReliabilityChecks(workflow: N8nWorkflow): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];

  for (const node of workflow.nodes) {
    if (isStickyNote(node) || node.disabled) continue;
    const parameters = activeParameters(node);

    // 1. Nœud HTTP sans retry : la première erreur passagère (rate limit,
    // coupure réseau) fait échouer toute l'exécution.
    if (node.type === HTTP_NODE && !node.retryOnFail) {
      findings.push({
        severity: 'warning',
        code: 'http-no-retry',
        message: `"${node.name}" appelle une API sans « Retry on Fail »`,
        nodeName: node.name,
        data: {
          suggestion:
            'Activer « Retry on Fail » dans les Settings du nœud (avec un délai entre essais) ' +
            'pour absorber les erreurs passagères — sauf si l’appel crée une ressource ' +
            'et que le rejouer ferait un doublon.',
        },
      });
    }

    // 2. Erreur avalée : l'erreur descend dans le flux comme un résultat normal,
    // personne ne la voit — ni le monitoring, ni les exécutions en erreur.
    const swallowed = node.onError === 'continueRegularOutput' || node.continueOnFail === true;
    if (swallowed) {
      findings.push({
        severity: 'warning',
        code: 'error-swallowed',
        message: `"${node.name}" continue silencieusement en cas d'erreur (l'échec devient invisible)`,
        nodeName: node.name,
        data: {
          suggestion:
            'Préférer « Continue (using error output) » avec la branche d’erreur branchée ' +
            'sur un traitement, ou laisser l’exécution échouer pour que le monitoring la voie.',
        },
      });
    }

    // 3. Secret en clair dans les paramètres : il part dans chaque export,
    // chaque version, chaque diff — au lieu de vivre dans un credential n8n.
    for (const hit of findSecrets(parameters)) {
      findings.push({
        severity: 'error',
        code: 'hardcoded-secret',
        message: `"${node.name}" contient un secret en clair (${hit.excerpt})`,
        nodeName: node.name,
        data: {
          path: hit.path,
          suggestion:
            'Déplacer le secret dans un credential n8n (Header Auth, Bearer…) : ' +
            'en paramètre, il est copié dans chaque export et chaque version du workflow.',
        },
      });
    }

    // 4. Nœud HTTP sans timeout : une API muette bloque l'exécution jusqu'au
    // timeout global. Info seulement — gênant surtout sur les workflows cadencés.
    if (node.type === HTTP_NODE) {
      const options = parameters.options as Record<string, unknown> | undefined;
      const timeout = options?.timeout;
      if (timeout === undefined || timeout === null || timeout === '') {
        findings.push({
          severity: 'info',
          code: 'http-no-timeout',
          message: `"${node.name}" appelle une API sans timeout`,
          nodeName: node.name,
          data: {
            suggestion:
              'Renseigner Options → Timeout sur le nœud : une API qui ne répond pas ' +
              'bloquerait l’exécution entière.',
          },
        });
      }
    }
  }

  return findings;
}
