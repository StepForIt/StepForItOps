import { describe, expect, it } from 'vitest';
import { ANSWER_GRACE_MS, unansweredRequest } from '../src/domain/chat-turn-state';

const NOW = new Date('2026-08-30T22:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const message = (id: string, role: string, createdAt: Date) => ({ id, role, createdAt });

describe('unansweredRequest', () => {
  it('ne dit rien d’une conversation vide', () => {
    expect(unansweredRequest([], NOW)).toBeNull();
  });

  it('ne dit rien quand la conversation finit par une réponse', () => {
    const messages = [
      message('u1', 'user', ago(2 * ANSWER_GRACE_MS)),
      message('a1', 'assistant', ago(2 * ANSWER_GRACE_MS)),
    ];
    expect(unansweredRequest(messages, NOW)).toBeNull();
  });

  it('laisse au tour le temps de tourner', () => {
    const messages = [message('u1', 'user', ago(ANSWER_GRACE_MS - 1000))];
    expect(unansweredRequest(messages, NOW)).toBeNull();
  });

  it('signale la demande passée le délai de grâce', () => {
    const envoye = ago(ANSWER_GRACE_MS + 1000);
    expect(unansweredRequest([message('u1', 'user', envoye)], NOW)).toEqual({
      messageId: 'u1',
      createdAt: envoye,
    });
  });

  it('signale le cas réel : une demande de la veille, jamais suivie', () => {
    const messages = [
      message('u1', 'user', ago(90 * 60_000)),
      message('a1', 'assistant', ago(89 * 60_000)),
      message('u2', 'user', ago(24 * 3600_000)),
    ];
    expect(unansweredRequest(messages, NOW)?.messageId).toBe('u2');
  });
});
