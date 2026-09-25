/**
 * Ce qu'un contrôle a trouvé, quelle que soit la plateforme.
 *
 * Neutre par nature : une sévérité, un code, un message et le nœud visé, ce sont
 * les quatre choses dont la plateforme a besoin pour afficher, grouper, ignorer
 * et bloquer — et aucune ne dépend de n8n. Les contrôles Make produisent
 * exactement la même chose, sans quoi il aurait fallu doubler la page des
 * findings, les règles d'exclusion et la porte de l'assistant.
 */
export interface CheckFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  /** Le nœud (n8n) ou le module (Make) visé, tel qu'un humain le lit à l'écran. */
  nodeName?: string;
  data?: Record<string, unknown>;
}
