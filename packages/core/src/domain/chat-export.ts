/**
 * Conversation IA rendue en Markdown, pour sortir de la plateforme : coller le raisonnement
 * dans un ticket, archiver la justification d'une modification appliquée, la relire à froid.
 * Le diff complet n'y est pas — seul le résumé de la proposition et son sort (appliquée,
 * écartée, en attente), qui est ce qu'on cherche des mois plus tard.
 */

export interface ChatExportProposal {
  summary: string;
  status: string;
}

export interface ChatExportMessage {
  role: string;
  content: string;
  createdAt: Date;
  proposal?: ChatExportProposal | null;
  /** Nombre de captures jointes. Les images ne partent pas dans le Markdown, mais
   * leur absence doit se voir : sans cette mention, une question qui portait sur
   * une capture devient incompréhensible une fois exportée. */
  attachments?: number;
  /** Noms des fichiers joints. Le contenu reste dehors — un export de 200 ko de
   * CSV n'est plus une conversation —, mais le nom dit sur QUOI portait la
   * question, ce qu'un simple compteur ne dirait pas. */
  files?: string[];
}

export interface ChatExportSession {
  title: string;
  createdAt: Date;
  messages: ChatExportMessage[];
}

export interface ChatExportWorkflow {
  name: string;
  instanceName?: string;
}

const PROPOSAL_STATUS: Record<string, string> = {
  pending: 'en attente',
  applied: 'appliquée',
  discarded: 'écartée',
};

/** Horodatage stable, indépendant du fuseau du serveur qui exporte. */
function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/**
 * Les replis (`:::détail <résumé>` … `:::`) sont dépliés : ils n'existent que pour l'écran,
 * et un fichier relu des mois plus tard doit tout montrer sans marqueur à décoder.
 */
export function expandChatDetails(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const open = /^\s*:::\s*(?:détail|detail|details)?\s*(.+?)\s*$/.exec(line);
      if (open) return `**${open[1]}**`;
      return /^\s*:::\s*$/.test(line) ? '' : line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function messageBlock(message: ChatExportMessage): string {
  const who = message.role === 'assistant' ? 'Assistant' : 'Vous';
  const lines = [`### ${who} — ${stamp(message.createdAt)}`, '', expandChatDetails(message.content).trim()];
  const attachments = message.attachments ?? 0;
  if (attachments > 0) {
    lines.push(
      '',
      `_${attachments} capture${attachments > 1 ? 's' : ''} d'écran jointe${attachments > 1 ? 's' : ''} (non exportée${attachments > 1 ? 's' : ''})._`,
    );
  }
  const files = message.files ?? [];
  if (files.length > 0) {
    lines.push(
      '',
      `_Fichier${files.length > 1 ? 's' : ''} joint${files.length > 1 ? 's' : ''} (contenu non exporté) : ${files.join(', ')}._`,
    );
  }
  if (message.proposal) {
    const status = PROPOSAL_STATUS[message.proposal.status] ?? message.proposal.status;
    lines.push('', `> **Modification proposée** (${status}) : ${message.proposal.summary}`);
  }
  return lines.join('\n');
}

export function chatSessionToMarkdown(workflow: ChatExportWorkflow, session: ChatExportSession): string {
  const header = [
    `# ${session.title}`,
    '',
    `- Workflow : **${workflow.name}**${workflow.instanceName ? ` (${workflow.instanceName})` : ''}`,
    `- Conversation ouverte le ${stamp(session.createdAt)}`,
    `- ${session.messages.length} message${session.messages.length > 1 ? 's' : ''}`,
  ].join('\n');
  const body = session.messages.map(messageBlock).join('\n\n');
  return `${[header, body].filter(Boolean).join('\n\n')}\n`;
}

/** Toutes les conversations d'un workflow dans un seul fichier, la plus récente en tête. */
export function chatSessionsToMarkdown(workflow: ChatExportWorkflow, sessions: ChatExportSession[]): string {
  const header = [
    `# Conversations IA — ${workflow.name}`,
    '',
    `- ${sessions.length} conversation${sessions.length > 1 ? 's' : ''}`,
    ...(workflow.instanceName ? [`- Instance : ${workflow.instanceName}`] : []),
  ].join('\n');
  const body = sessions
    .map((session) => chatSessionToMarkdown(workflow, session).trim().replace(/^# /, '## '))
    .join('\n\n---\n\n');
  return `${[header, body].filter(Boolean).join('\n\n')}\n`;
}

/** Nom de fichier lisible et sans surprise pour le système de fichiers. */
export function chatExportFilename(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${slug || 'conversation'}.md`;
}
