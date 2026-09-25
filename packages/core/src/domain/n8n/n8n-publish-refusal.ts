/**
 * n8n refuse d'enregistrer un workflow dont des nœuds sont incomplets de SON point
 * de vue (credential non résolue, paramètre requis vide) : il répond 400 avec un
 * texte multiligne listant chaque nœud fautif. Sans traduction, ce refus remonte en
 * 500 « Internal server error » — celui qui accepte un diff IA ne voit alors ni ce
 * qui bloque, ni sur quels nœuds, alors que rien n'a été écrit.
 */

/** Un nœud refusé et les griefs que n8n lui fait. */
export interface PublishNodeIssue {
  node: string;
  problems: string[];
}

export interface PublishRefusal {
  nodes: PublishNodeIssue[];
  /** Nombre de nœuds annoncé par n8n (peut dépasser les nœuds détaillés si le corps est tronqué). */
  declared: number | null;
}

const REFUSAL = /Cannot publish workflow/i;
const DECLARED = /(\d+)\s+nodes?\s+have\s+configuration\s+issues/i;
const NODE_BLOCK = /Node\s+"([^"]+)":((?:\s*\n\s*-[^\n]*)*)/g;
const MISSING_CREDENTIAL = /^Missing required credential:\s*(.+)$/i;

/**
 * Le corps d'erreur nous arrive tel que n8n l'a écrit — donc du JSON source, où les
 * sauts de ligne et les guillemets sont encore échappés, et parfois tronqué en
 * chemin. On le déséchappe au lieu de le parser : un JSON coupé ne se parse pas,
 * alors que les blocs déjà lus, eux, restent exploitables.
 */
function unescape(body: string): string {
  return body.replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

/** Refus de publication reconnu, sinon `undefined` (erreur n8n ordinaire). */
export function parsePublishRefusal(message: string): PublishRefusal | undefined {
  if (!REFUSAL.test(message)) return undefined;
  const text = unescape(message);
  const declared = DECLARED.exec(text)?.[1];
  const nodes: PublishNodeIssue[] = [];

  NODE_BLOCK.lastIndex = 0;
  for (let match = NODE_BLOCK.exec(text); match; match = NODE_BLOCK.exec(text)) {
    const problems = match[2]
      .split('\n')
      .map((line) => line.trim().replace(/^-\s*/, ''))
      .filter((line) => line.length > 0);
    nodes.push({ node: match[1], problems });
  }
  return { nodes, declared: declared ? Number(declared) : null };
}

/** Grief n8n rendu en français ; inconnu, il est repris tel quel. */
function describeProblem(problem: string): string {
  const credential = MISSING_CREDENTIAL.exec(problem)?.[1];
  return credential ? `credential « ${credential.trim()} » non résolue` : problem;
}

/** Message destiné à l'utilisateur : ce que n8n reproche, nœud par nœud. */
export function describePublishRefusal(refusal: PublishRefusal): string {
  const detailed = refusal.nodes
    .map((issue) => `« ${issue.node} » : ${issue.problems.map(describeProblem).join(', ')}`)
    .join(' ; ');
  const undetailed = refusal.declared !== null ? refusal.declared - refusal.nodes.length : 0;
  const rest = undetailed > 0 ? ` (+ ${undetailed} autre${undetailed > 1 ? 's' : ''} nœud(s))` : '';
  const count = refusal.declared ?? refusal.nodes.length;

  return (
    `n8n refuse d’enregistrer ce workflow : ${count} nœud${count > 1 ? 's' : ''} ` +
    `qu’il juge incomplet${count > 1 ? 's' : ''} — ${detailed}${rest}. ` +
    `Rien n’a été modifié dans n8n : corrige ces nœuds dans n8n (réassigne les credentials), puis resynchronise.`
  );
}
