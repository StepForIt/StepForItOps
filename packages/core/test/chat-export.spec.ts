import { describe, expect, it } from 'vitest';
import {
  ChatExportSession,
  chatExportFilename,
  expandChatDetails,
  chatSessionToMarkdown,
  chatSessionsToMarkdown,
} from '../src/domain/chat-export';

const workflow = { name: 'Relance devis', instanceName: 'prod' };

const session: ChatExportSession = {
  title: 'Pourquoi le mail part deux fois ?',
  createdAt: new Date('2026-08-30T09:41:12Z'),
  messages: [
    {
      role: 'user',
      content: 'Pourquoi le mail part deux fois ?',
      createdAt: new Date('2026-08-30T09:41:12Z'),
    },
    {
      role: 'assistant',
      content: 'Le nœud **Envoyer** est câblé sur les deux sorties du IF.',
      createdAt: new Date('2026-08-30T09:41:40Z'),
      proposal: { summary: 'Débrancher la sortie false', status: 'applied' },
    },
  ],
};

describe('chatSessionToMarkdown', () => {
  const markdown = chatSessionToMarkdown(workflow, session);

  it('porte le workflow, son instance et le fil des messages', () => {
    expect(markdown).toContain('# Pourquoi le mail part deux fois ?');
    expect(markdown).toContain('**Relance devis** (prod)');
    expect(markdown).toContain('### Vous — 2026-08-30 09:41 UTC');
    expect(markdown).toContain('### Assistant — 2026-08-30 09:41 UTC');
  });

  it('dit ce qu’est devenue la modification proposée', () => {
    expect(markdown).toContain('**Modification proposée** (appliquée) : Débrancher la sortie false');
  });

  it('n’invente pas d’instance quand elle est inconnue', () => {
    expect(chatSessionToMarkdown({ name: 'Relance devis' }, session)).toContain('**Relance devis**\n');
  });
});

describe('chatSessionsToMarkdown', () => {
  it('rétrograde les titres de conversation sous le titre du document', () => {
    const markdown = chatSessionsToMarkdown(workflow, [session, session]);
    expect(markdown).toContain('# Conversations IA — Relance devis');
    expect(markdown).toContain('## Pourquoi le mail part deux fois ?');
    expect(markdown).not.toContain('\n# Pourquoi');
    expect(markdown).toContain('2 conversations');
  });
});

describe('chatExportFilename', () => {
  it('translittère et ne garde que ce qui passe partout', () => {
    expect(chatExportFilename('Relance devis — été 2026')).toBe('relance-devis-ete-2026.md');
  });

  it('ne rend jamais un nom vide', () => {
    expect(chatExportFilename('———')).toBe('conversation.md');
  });
});

describe('expandChatDetails', () => {
  it('déplie les replis en gardant leur résumé comme titre', () => {
    const markdown = expandChatDetails(
      ['Je propose ceci.', ':::détail Ce que j’ai lu', '- le nœud Shopify', ':::', 'Valide le diff.'].join(
        '\n',
      ),
    );
    expect(markdown).toContain('**Ce que j’ai lu**');
    expect(markdown).toContain('- le nœud Shopify');
    expect(markdown).not.toContain(':::');
  });

  it('laisse intact un message sans repli', () => {
    expect(expandChatDetails('Une ligne\n\nUne autre')).toBe('Une ligne\n\nUne autre');
  });
});
