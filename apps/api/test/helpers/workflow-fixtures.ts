import { PrismaClient } from '@prisma/client';
import { N8nWorkflow, hashWorkflow } from '@nwm/core';
import { WorkflowWithEnv } from '../../src/modules/workflows/workflows.service';

/**
 * De quoi poser un parc minimal en base : une instance, des workflows, et la
 * forme enrichie que `WorkflowsService` rend à ses appelants.
 *
 * Les services testés ici ne lisent qu'une poignée de champs de `WorkflowWithEnv`
 * (empreinte, archivage, nom, instance) — le reste est rempli d'une valeur
 * neutre plutôt qu'omis : un objet à moitié bâti fait échouer le test sur ce
 * qui manque, pas sur ce qu'on vérifie.
 */
export function n8nWorkflow(id: string, name: string, extra: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    id,
    name,
    nodes: [{ name: 'Déclencheur', type: 'n8n-nodes-base.manualTrigger', parameters: {}, position: [0, 0] }],
    connections: {},
    active: false,
    ...extra,
  } as N8nWorkflow;
}

export async function seedInstance(prisma: PrismaClient, name = 'Atelier'): Promise<string> {
  const instance = await prisma.instance.create({
    data: { name, baseUrl: 'http://127.0.0.1:0', apiKey: 'k' },
  });
  return instance.id;
}

export async function seedWorkflow(
  prisma: PrismaClient,
  instanceId: string,
  raw: N8nWorkflow,
  extra: { tags?: string[] } = {},
): Promise<string> {
  const row = await prisma.workflow.create({
    data: {
      instanceId,
      externalId: String(raw.id),
      name: raw.name,
      active: raw.active ?? false,
      tags: extra.tags ?? [],
      hash: hashWorkflow(raw),
      raw: raw as unknown as object,
    },
  });
  return row.id;
}

/** La forme enrichie, telle que `getFreshRaw` la rend. */
export function withEnv(
  row: { id: string; instanceId: string; externalId: string; name: string; hash: string },
  extra: Partial<WorkflowWithEnv> = {},
): WorkflowWithEnv {
  return {
    ...row,
    tags: [],
    active: false,
    env: null,
    archived: false,
    missingInN8n: false,
    platform: 'n8n',
    ...extra,
  } as unknown as WorkflowWithEnv;
}
