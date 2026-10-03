import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { N8nApiPort, WorkflowPlatformPorts } from '@nwm/core';
import { InstancesService } from '../src/modules/instances/instances.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { resetDb, testPrisma } from './helpers/db';

/**
 * « Ne plus me demander pour cette instance » : un choix qui vit SUR l'instance,
 * daté et signé, et non dans un navigateur — il doit tenir après reconnexion,
 * depuis un autre poste, et se lever depuis la fiche.
 */

const prisma = testPrisma() as unknown as PrismaService;
const instances = () => new InstancesService(prisma, {} as N8nApiPort, {} as WorkflowPlatformPorts);
const base = { name: 'Prod', baseUrl: 'http://n8n', apiKey: 'n8n_api_key' };

describe('InstancesService — accès complet, « ne plus demander »', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await testPrisma().$disconnect();
  });

  it("ne demande rien par défaut : l'instance naît sans dismiss", async () => {
    const created = await instances().create(base);
    expect(created.fullAccessDismissedAt).toBeNull();
    expect(created.fullAccessDismissedBy).toBeNull();
  });

  it("pose le dismiss à la création, daté et signé de l'auteur", async () => {
    const before = Date.now();
    const created = await instances().create({ ...base, fullAccessDismiss: true }, 'mathieu@stepforit.fr');

    expect(created.fullAccessDismissedBy).toBe('mathieu@stepforit.fr');
    expect(created.fullAccessDismissedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // Relu depuis la base, pas seulement rendu : c'est ce qui tient après reconnexion.
    expect(await instances().get(created.id)).toMatchObject({
      fullAccessDismissedBy: 'mathieu@stepforit.fr',
      fullAccessDismissedAt: created.fullAccessDismissedAt,
    });
  });

  it('pose puis lève le dismiss sur une instance existante, sans toucher au reste', async () => {
    const svc = instances();
    const created = await svc.create({ ...base, n8nEmail: 'owner@n8n' });

    const dismissed = await svc.update(created.id, { fullAccessDismiss: true }, 'lea@stepforit.fr');
    expect(dismissed.fullAccessDismissedBy).toBe('lea@stepforit.fr');
    expect(dismissed.fullAccessDismissedAt).toBeInstanceOf(Date);
    expect(dismissed.n8nEmail).toBe('owner@n8n');

    const asked = await svc.update(created.id, { fullAccessDismiss: false });
    expect(asked.fullAccessDismissedAt).toBeNull();
    expect(asked.fullAccessDismissedBy).toBeNull();
    expect(asked.n8nEmail).toBe('owner@n8n');
  });

  it('un update qui ne parle pas du dismiss le laisse tel quel', async () => {
    const svc = instances();
    const created = await svc.create({ ...base, fullAccessDismiss: true }, 'mathieu@stepforit.fr');
    const renamed = await svc.update(created.id, { name: 'Prod 2' });
    expect(renamed.fullAccessDismissedBy).toBe('mathieu@stepforit.fr');
    expect(renamed.fullAccessDismissedAt).toEqual(created.fullAccessDismissedAt);
  });

  it('sans auteur connu, le dismiss est daté mais non signé', async () => {
    const created = await instances().create({ ...base, fullAccessDismiss: true });
    expect(created.fullAccessDismissedAt).toBeInstanceOf(Date);
    expect(created.fullAccessDismissedBy).toBeNull();
  });

  it('les identifiants saisis avec la modale sont enregistrés, le mot de passe jamais rendu', async () => {
    const created = await instances().create({ ...base, n8nEmail: 'owner@n8n', n8nPassword: 'très-secret' });
    expect(created.hasN8nLogin).toBe(true);
    expect(JSON.stringify(created)).not.toContain('très-secret');
  });
});
