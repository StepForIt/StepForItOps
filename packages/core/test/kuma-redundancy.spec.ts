import { describe, expect, it } from 'vitest';
import {
  RedundancyContext,
  RedundancyInstance,
  RedundancyProbe,
  findRedundantProbes,
} from '../src/domain/n8n/kuma-redundancy';

const acme: RedundancyInstance = {
  id: 'i1',
  name: 'N8N acme',
  baseUrl: 'https://n8n-acme.example.com/',
  hasErrorWatch: true,
};
const fabrique: RedundancyInstance = {
  id: 'i2',
  name: 'La fabrique a bidules',
  baseUrl: 'https://fabrique.example.com/',
  hasErrorWatch: true,
};

function context(probes: RedundancyProbe[], overrides: Partial<RedundancyContext> = {}): RedundancyContext {
  return {
    probes,
    instances: [acme, fabrique],
    ownedExternalIds: [],
    linkedEnabledExternalIds: [],
    ...overrides,
  };
}

const healthProbe: RedundancyProbe = {
  externalId: 73,
  name: '[Interne] WF - Demo Flow - Health',
  type: 'keyword',
  active: true,
  intervalSeconds: 120,
  url: 'https://n8n-acme.example.com/webhook/health-demo-flow',
};

describe('kuma-redundancy', () => {
  it('signale une sonde keyword qui tape un webhook d’une instance déjà couverte, et chiffre le coût', () => {
    const [found] = findRedundantProbes(context([healthProbe]));
    expect(found.rule).toBe('health-webhook');
    expect(found.instanceName).toBe('N8N acme');
    expect(found.executionsPerDay).toBe(720);
    expect(found.reason).toContain('720 exécutions/jour');
  });

  it('ignore une sonde HTTP qui ne vise pas un webhook n8n', () => {
    const probe: RedundancyProbe = {
      ...healthProbe,
      url: 'https://n8n-acme.example.com/api/v1/workflows',
    };
    expect(findRedundantProbes(context([probe]))).toEqual([]);
  });

  it('ignore un webhook porté par un hôte inconnu de la plateforme', () => {
    const probe: RedundancyProbe = {
      ...healthProbe,
      url: 'https://ailleurs.example.com/webhook/health-other-flow',
    };
    expect(findRedundantProbes(context([probe]))).toEqual([]);
  });

  it('ignore un webhook d’une instance sans error-watch : rien ne le remplace', () => {
    const probes = findRedundantProbes(
      context([healthProbe], { instances: [{ ...acme, hasErrorWatch: false }] }),
    );
    expect(probes).toEqual([]);
  });

  it('rapproche une sonde « Errors Check » de son instance malgré accents et libellé abrégé', () => {
    const probes: RedundancyProbe[] = [
      { externalId: 78, name: '[ACME] Errors Check', type: 'push', active: true },
      { externalId: 80, name: '[Fabrique à Bidules] Errors Check', type: 'push', active: true },
    ];
    const found = findRedundantProbes(context(probes));
    expect(found.map((p) => [p.externalId, p.rule, p.instanceName])).toEqual([
      [78, 'duplicate-error-watch', 'N8N acme'],
      [80, 'duplicate-error-watch', 'La fabrique a bidules'],
    ]);
  });

  it('laisse tranquille une sonde « Errors Check » d’un client hors plateforme', () => {
    const probe: RedundancyProbe = {
      externalId: 79,
      name: '[Clientex] Errors Check',
      type: 'push',
      active: true,
    };
    expect(findRedundantProbes(context([probe]))).toEqual([]);
  });

  it('ne touche jamais aux sondes créées par la plateforme', () => {
    const own: RedundancyProbe = {
      externalId: 82,
      name: '[n8n-ops] N8N acme — erreurs d’exécution',
      type: 'push',
      active: true,
    };
    expect(findRedundantProbes(context([own], { ownedExternalIds: [82] }))).toEqual([]);
  });

  it('signale une sonde en pause dont le monitor local est resté activé', () => {
    const probe: RedundancyProbe = {
      externalId: 76,
      name: '[Automation] Errors Check',
      type: 'push',
      active: false,
    };
    const [found] = findRedundantProbes(context([probe], { linkedEnabledExternalIds: [76] }));
    expect(found.rule).toBe('paused');
  });

  it('ignore une sonde en pause qui n’est rattachée à aucun monitor de la plateforme', () => {
    const probe: RedundancyProbe = {
      externalId: 30,
      name: '[Interne] Outil maison',
      type: 'http',
      active: false,
    };
    expect(findRedundantProbes(context([probe]))).toEqual([]);
  });

  it('classe la pause avant la redondance : une sonde déjà arrêtée n’est pas « à désactiver »', () => {
    const probe: RedundancyProbe = { ...healthProbe, active: false };
    const [found] = findRedundantProbes(context([probe], { linkedEnabledExternalIds: [73] }));
    expect(found.rule).toBe('paused');
  });
});
