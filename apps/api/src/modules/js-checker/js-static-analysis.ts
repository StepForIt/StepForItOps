import * as acorn from 'acorn';
import { CheckFinding, locateIndex } from '@nwm/core';
import { CodeNode } from './code-node-extractor';

/**
 * Analyse statique d'un nœud Code : parse + heuristiques n8n.
 *
 * Chaque finding porte sa position (`data.line` / `data.snippet`) et son correctif
 * (`data.suggestion`) : sans eux, traiter la remarque impose de rouvrir n8n et de
 * relire le nœud entier pour retrouver la ligne visée.
 *
 * Pas de règle sur `console.log` : la sortie n'est visible que dans l'exécution
 * n8n, derrière un compte admin — elle ne change rien à ce que produit le workflow.
 */
export function analyzeCodeNode(node: CodeNode): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const code = node.code;

  /** Position du premier match d'un motif, pour ancrer le finding dans le code. */
  const at = (pattern: RegExp) => {
    const match = pattern.exec(code);
    return match ? locateIndex(code, match.index) : undefined;
  };

  // 1. Syntaxe (le code n8n autorise await top-level → on wrappe en fonction async)
  try {
    acorn.parse(`(async () => {\n${code}\n})()`, { ecmaVersion: 'latest' });
  } catch (error) {
    // acorn compte la ligne du code wrappé : une de plus que celle du nœud.
    const raw = (error as { loc?: { line: number } }).loc?.line;
    const line = raw ? Math.max(1, raw - 1) : undefined;
    findings.push({
      severity: 'error',
      code: 'js-syntax-error',
      message: `Erreur de syntaxe : ${(error as Error).message}`,
      nodeName: node.nodeName,
      data: {
        ...(line ? locateLine(code, line) : {}),
        suggestion: 'Le nœud ne peut pas s’exécuter : corrige la syntaxe avant tout le reste.',
      },
    });
    return findings; // inutile d'aller plus loin
  }

  // 2. Heuristiques n8n

  if (!/\breturn\b/.test(code)) {
    findings.push({
      severity: 'warning',
      code: 'js-no-return',
      message: 'Aucun return : le nœud Code doit retourner des items',
      nodeName: node.nodeName,
      data: {
        suggestion:
          node.mode === 'runOnceForEachItem'
            ? 'Termine par `return { json: … }` (un item).'
            : 'Termine par `return [{ json: … }]` (un tableau d’items).',
      },
    });
  }

  if (node.mode === 'runOnceForAllItems' && /\$json\b/.test(code) && !/\$input\b|\bitems\b/.test(code)) {
    findings.push({
      severity: 'warning',
      code: 'js-json-in-all-items',
      message:
        '$json utilisé en mode "Run Once for All Items" : seul le premier item sera lu ($input.all() attendu ?)',
      nodeName: node.nodeName,
      data: {
        ...at(/\$json\b/),
        suggestion:
          'Boucle sur les items : `for (const item of $input.all()) { … item.json … }` — ou repasse le nœud en "Run Once for Each Item" si un seul item est attendu.',
      },
    });
  }

  if (node.mode === 'runOnceForEachItem' && /\$input\.all\(\)/.test(code)) {
    findings.push({
      severity: 'warning',
      code: 'js-all-in-each-item',
      message: '$input.all() en mode "Run Once for Each Item" est indisponible',
      nodeName: node.nodeName,
      data: {
        ...at(/\$input\.all\(\)/),
        suggestion:
          'En mode "each item", utilise `$json` (l’item courant) — ou repasse le nœud en "Run Once for All Items" si tu as besoin de tous les items.',
      },
    });
  }

  if (/\brequire\s*\(/.test(code)) {
    findings.push({
      severity: 'info',
      code: 'js-require',
      message:
        "require() : dépend de NODE_FUNCTION_ALLOW_EXTERNAL/BUILTIN sur l'instance — peut échouer en prod",
      nodeName: node.nodeName,
      data: {
        ...at(/\brequire\s*\(/),
        suggestion:
          'Vérifie que le module est autorisé sur l’instance cible, ou remplace-le par un nœud dédié (HTTP Request, Crypto…).',
      },
    });
  }

  return findings;
}

/** Contexte autour d'une ligne connue (cas acorn, qui donne la ligne et non l'index). */
function locateLine(code: string, line: number) {
  const lines = code.split('\n');
  const index = lines.slice(0, line - 1).join('\n').length;
  return locateIndex(code, index + 1);
}
