import { describe, expect, it } from 'vitest';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';
import { releaseKey } from '../src/domain/n8n/workflow-release-key';

const base: N8nWorkflow = {
  name: 'Facturation (1.0.4) - PROD',
  nodes: [
    {
      id: '1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 1,
      position: [0, 0],
      parameters: { path: 'a' },
    },
  ],
  connections: {},
};

describe('releaseKey', () => {
  it('ignore le numéro que la promotion vient de reporter dans le nom', () => {
    expect(releaseKey({ ...base, name: 'Facturation (1.0.5) - PROD' })).toBe(releaseKey(base));
  });

  it('ignore le pinData, que la promotion ne transporte pas', () => {
    expect(releaseKey({ ...base, pinData: { Webhook: [{ json: {} }] } } as N8nWorkflow)).toBe(
      releaseKey(base),
    );
  });

  it('change dès qu’un paramètre bouge', () => {
    const edited = { ...base, nodes: [{ ...base.nodes[0], parameters: { path: 'b' } }] };
    expect(releaseKey(edited)).not.toBe(releaseKey(base));
  });

  it('change quand le workflow est renommé pour de vrai', () => {
    expect(releaseKey({ ...base, name: 'Facturation client (1.0.4) - PROD' })).not.toBe(releaseKey(base));
  });
});
