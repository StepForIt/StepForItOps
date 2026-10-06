import { describe, expect, it } from 'vitest';
import { EVENT_LOG_VALUE_MAX_BYTES, eventLogPayload } from '../src/domain/event-log-entry';

describe('eventLogPayload', () => {
  it('garde tel quel ce qui identifie un événement', () => {
    const payload = { instanceId: 'i1', scope: 'instance', count: 3, active: true };
    expect(eventLogPayload(payload)).toEqual(payload);
  });

  it('remplace le contenu volumineux par sa seule taille', () => {
    const raw = {
      nodes: Array.from({ length: 200 }, (_, i) => ({ name: `Node ${i}`, parameters: { url: 'https://x' } })),
    };
    const out = eventLogPayload({ workflowId: 'w1', externalId: '42', raw }) as Record<string, unknown>;
    expect(out.workflowId).toBe('w1');
    expect(out.externalId).toBe('42');
    expect(out.raw).toEqual({ omittedBytes: JSON.stringify(raw).length });
  });

  it('compte en octets et non en caractères', () => {
    const accents = 'é'.repeat(EVENT_LOG_VALUE_MAX_BYTES / 2 + 10);
    expect(eventLogPayload({ note: accents })).toEqual({ note: { omittedBytes: accents.length * 2 + 2 } });
  });

  it('accepte un payload absent ou scalaire', () => {
    expect(eventLogPayload(undefined)).toBeNull();
    expect(eventLogPayload(null)).toBeNull();
    expect(eventLogPayload('x')).toBe('x');
  });

  it('écarte les clés undefined, que Prisma refuserait dans du JSON', () => {
    expect(eventLogPayload({ a: 1, b: undefined })).toEqual({ a: 1 });
  });
});
