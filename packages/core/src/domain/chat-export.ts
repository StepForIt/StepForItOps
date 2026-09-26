/**
 * Conversation IA rendue en Markdown, pour sortir de la plateforme : coller le raisonnement
 * dans un ticket, archiver la justification d'une modification appliquée, la relire à froid.
 * Le diff complet n'y est pas — seul le résumé de la proposition et son sort (appliquée,
 * écartée, en attente), qui est ce qu'on cherche des mois plus tard.
 */

import { msg } from '../i18n';

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
  const who = message.role === 'assistant' ? 'Assistant' : msg('chat.exportYou');
  const lines = [`### ${who} — ${stamp(message.createdAt)}`, '', expandChatDetails(message.content).trim()];
  const attachments = message.attachments ?? 0;
  if (attachments > 0) {
    lines.push('', msg('chat.exportScreenshots', { count: attachments }));
  }
  const files = message.files ?? [];
  if (files.length > 0) {
    lines.push('', msg('chat.exportFiles', { count: files.length, names: files.join(', ') }));
  }
  if (message.proposal) {
    const status = msg('chat.exportProposalStatus', { status: message.proposal.status });
    lines.push('', msg('chat.exportProposal', { status, summary: message.proposal.summary }));
  }
  return lines.join('\n');
}

export function chatSessionToMarkdown(workflow: ChatExportWorkflow, session: ChatExportSession): string {
  const header = [
    `# ${session.title}`,
    '',
    `- ${msg('chat.exportWorkflowLine', { name: workflow.name })}${workflow.instanceName ? ` (${workflow.instanceName})` : ''}`,
    `- ${msg('chat.exportOpenedAt', { date: stamp(session.createdAt) })}`,
    `- ${msg('chat.exportMessageCount', { count: session.messages.length })}`,
  ].join('\n');
  const body = session.messages.map(messageBlock).join('\n\n');
  return `${[header, body].filter(Boolean).join('\n\n')}\n`;
}

/** Toutes les conversations d'un workflow dans un seul fichier, la plus récente en tête. */
export function chatSessionsToMarkdown(workflow: ChatExportWorkflow, sessions: ChatExportSession[]): string {
  const header = [
    `# ${msg('chat.exportAllTitle', { name: workflow.name })}`,
    '',
    `- ${msg('chat.exportConversationCount', { count: sessions.length })}`,
    ...(workflow.instanceName
      ? [`- ${msg('chat.exportInstanceLine', { name: workflow.instanceName })}`]
      : []),
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
