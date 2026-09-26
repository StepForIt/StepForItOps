import * as acorn from 'acorn';
import { CheckFinding, locateIndex, msg } from '@nwm/core';
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
      message: msg('analysis.jsSyntaxError', { error: (error as Error).message }),
      nodeName: node.nodeName,
      data: {
        ...(line ? locateLine(code, line) : {}),
        suggestion: msg('analysis.jsSyntaxErrorFix'),
      },
    });
    return findings; // inutile d'aller plus loin
  }

  // 2. Heuristiques n8n

  if (!/\breturn\b/.test(code)) {
    findings.push({
      severity: 'warning',
      code: 'js-no-return',
      message: msg('analysis.jsNoReturn'),
      nodeName: node.nodeName,
      data: {
        suggestion:
          node.mode === 'runOnceForEachItem'
            ? msg('analysis.jsNoReturnFixEach', { snippet: '`return { json: … }`' })
            : msg('analysis.jsNoReturnFixAll', { snippet: '`return [{ json: … }]`' }),
      },
    });
  }

  if (node.mode === 'runOnceForAllItems' && /\$json\b/.test(code) && !/\$input\b|\bitems\b/.test(code)) {
    findings.push({
      severity: 'warning',
      code: 'js-json-in-all-items',
      message: msg('analysis.jsJsonInAllItems'),
      nodeName: node.nodeName,
      data: {
        ...at(/\$json\b/),
        suggestion: msg('analysis.jsJsonInAllItemsFix', {
          snippet: '`for (const item of $input.all()) { … item.json … }`',
        }),
      },
    });
  }

  if (node.mode === 'runOnceForEachItem' && /\$input\.all\(\)/.test(code)) {
    findings.push({
      severity: 'warning',
      code: 'js-all-in-each-item',
      message: msg('analysis.jsAllInEachItem'),
      nodeName: node.nodeName,
      data: {
        ...at(/\$input\.all\(\)/),
        suggestion: msg('analysis.jsAllInEachItemFix'),
      },
    });
  }

  if (/\brequire\s*\(/.test(code)) {
    findings.push({
      severity: 'info',
      code: 'js-require',
      message: msg('analysis.jsRequire'),
      nodeName: node.nodeName,
      data: {
        ...at(/\brequire\s*\(/),
        suggestion: msg('analysis.jsRequireFix'),
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
