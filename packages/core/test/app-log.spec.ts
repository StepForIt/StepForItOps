import { describe, expect, it } from 'vitest';
import { AppLogEntry, filterAppLogs, formatAppLogText } from '../src/domain/app-log';

let seq = 0;
const line = (partial: Partial<AppLogEntry> = {}): AppLogEntry => ({
  seq: (seq += 1),
  at: '2026-09-01T09:00:00.000Z',
  level: 'log',
  context: 'HTTP',
  message: 'GET /workflows → 200',
  ...partial,
});

describe('filterAppLogs', () => {
  it('rend tout sans requête', () => {
    const entries = [line(), line()];
    expect(filterAppLogs(entries)).toEqual(entries);
  });

  it('retient les niveaux demandés', () => {
    const entries = [line({ level: 'log' }), line({ level: 'error' }), line({ level: 'warn' })];
    expect(filterAppLogs(entries, { levels: ['error', 'warn'] }).map((e) => e.level)).toEqual([
      'error',
      'warn',
    ]);
  });

  it('cherche dans le message, le contexte et la pile', () => {
    const entries = [
      line({ message: 'rien à voir' }),
      line({ message: 'sync terminée' }),
      line({ context: 'SyncCron', message: 'ok' }),
      line({ message: 'boum', stack: 'Error: boum\n    at sync (x.ts:1:1)' }),
    ];
    expect(filterAppLogs(entries, { search: 'SYNC' })).toHaveLength(3);
  });

  it('ne rend que ce qui suit le curseur', () => {
    const entries = [line(), line(), line()];
    const cursor = entries[0].seq;
    expect(filterAppLogs(entries, { sinceSeq: cursor }).map((e) => e.seq)).toEqual([
      entries[1].seq,
      entries[2].seq,
    ]);
  });

  it('tronque par la FIN, une fois filtré', () => {
    const entries = [
      line({ level: 'error', message: 'vieille' }),
      line({ level: 'log' }),
      line({ level: 'error', message: 'récente' }),
    ];
    // Tronquer avant de filtrer aurait rendu « vieille » : la fenêtre resterait
    // figée sur le passé pendant que le journal défile.
    expect(filterAppLogs(entries, { levels: ['error'], limit: 1 }).map((e) => e.message)).toEqual([
      'récente',
    ]);
  });
});

describe('formatAppLogText', () => {
  it('rend une ligne par entrée, pile comprise', () => {
    const text = formatAppLogText([
      line({ level: 'error', context: 'HttpException', message: 'boum', stack: 'Error: boum' }),
    ]);
    expect(text).toBe('2026-09-01T09:00:00.000Z   ERROR [HttpException] boum\nError: boum');
  });
});
