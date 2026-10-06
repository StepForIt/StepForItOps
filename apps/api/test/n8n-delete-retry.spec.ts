import { describe, expect, it } from 'vitest';
import { N8nApiError } from '@nwm/core';
import { deleteAfterUnpublish, isPendingUnpublish } from '@nwm/adapter-n8n-api';

/**
 * Les workflows temporaires (`[NWM discovery]`, sondes) restaient dans le n8n du
 * client : n8n 2.x refuse de supprimer un workflow publié, puis répond « still
 * being unpublished » quelques secondes après la dépublication.
 */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('deleteAfterUnpublish', () => {
  it('dépublie, puis rejoue la suppression tant que n8n répond 409', async () => {
    const calls: string[] = [];
    let refusals = 3;
    await deleteAfterUnpublish(
      async () => void calls.push('deactivate'),
      async () => {
        calls.push('delete');
        if (refusals-- > 0) throw new N8nApiError('n8n API DELETE → 409: still being unpublished', 409);
      },
      clock(),
    );
    expect(calls).toEqual(['deactivate', 'delete', 'delete', 'delete', 'delete']);
  });

  it('supprime quand même un workflow déjà inactif (dépublication refusée)', async () => {
    let deleted = false;
    await deleteAfterUnpublish(
      async () => {
        throw new N8nApiError('already inactive', 400);
      },
      async () => void (deleted = true),
      clock(),
    );
    expect(deleted).toBe(true);
  });

  it('abandonne passé le délai et remonte le dernier refus', async () => {
    const c = clock();
    let tries = 0;
    await expect(
      deleteAfterUnpublish(
        async () => undefined,
        async () => {
          tries++;
          throw new N8nApiError('still being unpublished', 409);
        },
        { ...c, timeoutMs: 3_000, intervalMs: 1_000 },
      ),
    ).rejects.toThrow('still being unpublished');
    expect(tries).toBe(4);
  });

  it("ne rejoue pas un refus qui n'a rien à voir (404, 401)", async () => {
    let tries = 0;
    await expect(
      deleteAfterUnpublish(
        async () => undefined,
        async () => {
          tries++;
          throw new N8nApiError('not found', 404);
        },
        clock(),
      ),
    ).rejects.toThrow('not found');
    expect(tries).toBe(1);
  });

  it('reconnaît le refus « publié » en 400 comme en 409', () => {
    expect(isPendingUnpublish(new N8nApiError('Workflow is published, unpublish first', 400))).toBe(true);
    expect(isPendingUnpublish(new N8nApiError('bad request', 400))).toBe(false);
    expect(isPendingUnpublish(new Error('409'))).toBe(false);
  });
});
