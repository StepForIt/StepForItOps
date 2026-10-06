import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGetList } from './api';

/** Réponse fetch minimale : apiGetList ne lit que ok/status/json/headers.get. */
function fakeResponse(rows: unknown[], totalHeader: string | null) {
  return {
    ok: true,
    status: 200,
    json: async () => rows,
    text: async () => JSON.stringify(rows),
    headers: { get: (key: string) => (key.toLowerCase() === 'x-total-count' ? totalHeader : null) },
  };
}

describe('apiGetList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rend les lignes ET le total lu dans le header x-total-count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse([{ id: 'a' }, { id: 'b' }], '742')),
    );
    const { data, total } = await apiGetList<{ id: string }>('/findings');
    expect(data).toHaveLength(2);
    expect(total).toBe(742);
  });

  it('retombe sur la taille du lot quand le header est absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse([{ id: 'a' }], null)),
    );
    const { total } = await apiGetList('/whatever');
    expect(total).toBe(1);
  });
});
