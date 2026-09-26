import { CheckFinding, N8nWorkflow, isStickyNote, msg } from '@nwm/core';

/** Nom par défaut n8n : type du nœud éventuellement suffixé d'un chiffre. */
const DEFAULT_NAME_PATTERN =
  /^(HTTP Request|Set|Edit Fields|Code|Function|IF|Switch|Merge|Webhook|NoOp|No Operation.*|Wait|Split In Batches|Loop Over Items.*|Airtable|Notion|Google Sheets|Postgres)\s*\d*$/i;

export function findNamingIssues(workflow: N8nWorkflow): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const nodes = workflow.nodes.filter((n) => !isStickyNote(n));
  for (const node of nodes) {
    if (DEFAULT_NAME_PATTERN.test(node.name.trim())) {
      findings.push({
        severity: 'warning',
        code: 'default-name',
        message: msg('analysis.namingDefault', { name: node.name }),
        nodeName: node.name,
      });
    }
  }

  // Doublons de type+paramètres identiques (appels dupliqués probables).
  // Les NoOp sont exclus : utilisés volontairement comme jalons nommés
  // (Start unique derrière plusieurs triggers, points intermédiaires…).
  const signatures = new Map<string, string[]>();
  for (const node of nodes.filter((n) => !n.type.toLowerCase().includes('noop'))) {
    const signature = `${node.type}:${JSON.stringify(node.parameters ?? {})}`;
    if (!signatures.has(signature)) signatures.set(signature, []);
    signatures.get(signature)!.push(node.name);
  }
  for (const names of signatures.values()) {
    if (names.length > 1) {
      findings.push({
        severity: 'info',
        code: 'duplicate-nodes',
        message: msg('analysis.namingDuplicates', { names: names.join(', ') }),
        data: { names },
      });
    }
  }
  return findings;
}
