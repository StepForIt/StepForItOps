import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ModuleRegistryService } from '../src/infra/modules-registry/module-registry.service';
import { PlatformSettingsService } from '../src/infra/settings/platform-settings.service';
import { FullBackupExportService } from '../src/modules/config-transfer/backup/full-backup-export.service';
import { FullBackupRestoreService } from '../src/modules/config-transfer/backup/full-backup-restore.service';
import { schemaBackupPlan } from '../src/modules/config-transfer/backup/prisma-backup-access';
import { unsealFile } from '../src/infra/secrets/export-file-cipher';
import { resetDb, testPrisma } from './helpers/db';

/**
 * Sauvegarde complète puis restauration : ce que l'export de configuration
 * laissait derrière lui — historique des versions, exclusions de findings,
 * leçons de l'assistant, pièces jointes du chat — revient À L'IDENTIQUE, ids
 * compris, et ce qui a été créé entre-temps disparaît (c'est un remplacement).
 */

const prisma = testPrisma() as unknown as PrismaService;

const registry = { reload: async () => undefined } as unknown as ModuleRegistryService;
const settings = { get: async () => ({}) } as unknown as PlatformSettingsService;

const EXPORT_KEY = 'cheval-agrafe-batterie';

/** Le fichier tel qu'il est téléchargé : gzip, scellé par la clé d'export. */
async function backupBytes(): Promise<Buffer> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (c: Buffer) => chunks.push(c));
  await new FullBackupExportService(prisma).write(out, EXPORT_KEY);
  return Buffer.concat(chunks);
}

/** Le même, descellé : le gzip d'avant la clé d'export (ancien fichier) ou à retoucher. */
async function plainBytes(sealed: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nwm-backup-test-'));
  await writeFile(join(dir, 'sealed'), sealed);
  await unsealFile(join(dir, 'sealed'), EXPORT_KEY, join(dir, 'plain'));
  return readFile(join(dir, 'plain'));
}

const restorer = () => new FullBackupRestoreService(prisma, registry, settings);

async function seed() {
  const instance = await prisma.instance.create({
    data: { name: 'Prod', baseUrl: 'https://n8n.example.test', apiKey: 'secret-key' },
  });
  const workflow = await prisma.workflow.create({
    data: { instanceId: instance.id, externalId: 'w1', name: 'Facturation', hash: 'h1', raw: { nodes: [] } },
  });
  await prisma.workflowVersion.create({
    data: { workflowId: workflow.id, hash: 'h0', raw: { nodes: [{ name: 'old' }] }, semver: '1.2.0' },
  });
  await prisma.findingIgnore.create({
    data: {
      workflowId: workflow.id,
      module: 'verifier',
      code: 'http-no-retry',
      nodeName: 'HTTP',
      reason: 'voulu',
    },
  });
  await prisma.assistantLesson.create({
    data: { content: 'Toujours poser un timeout', origin: 'human-answer', nodeTypes: ['httpRequest'] },
  });
  await prisma.workflowGroup.create({
    data: { instanceId: instance.id, name: 'Compta', workflows: { connect: [{ id: workflow.id }] } },
  });
  const session = await prisma.workflowChatSession.create({ data: { workflowId: workflow.id, title: 'S' } });
  const message = await prisma.workflowChatMessage.create({
    data: { sessionId: session.id, role: 'user', content: 'regarde' },
  });
  await prisma.workflowChatAttachment.create({
    data: { messageId: message.id, mediaType: 'image/png', size: 3, data: Buffer.from([1, 2, 255]) },
  });
  return { instance, workflow, message };
}

describe('full backup', () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.assistantLesson.deleteMany();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.assistantLesson.deleteMany();
  });

  it('orders every table after the ones it references, and knows the n-n join tables', () => {
    const order = schemaBackupPlan().tables.map((t) => t.model);
    expect(order.indexOf('Instance')).toBeLessThan(order.indexOf('Workflow'));
    expect(order.indexOf('Workflow')).toBeLessThan(order.indexOf('WorkflowVersion'));
    expect(order.indexOf('WorkflowChatMessage')).toBeLessThan(order.indexOf('WorkflowChatAttachment'));
    expect(schemaBackupPlan().joins).toContain('_WorkflowToWorkflowGroup');
  });

  it('restores history, exclusions, lessons, groups and attachments exactly, replacing what came after', async () => {
    const { workflow, message } = await seed();
    const file = await backupBytes();

    // Après la sauvegarde : une perte, et un ajout qui doit disparaître.
    await prisma.workflowVersion.deleteMany();
    await prisma.findingIgnore.deleteMany();
    await prisma.assistantLesson.deleteMany();
    await prisma.instance.create({ data: { name: 'Nouvelle', baseUrl: 'https://other.test', apiKey: 'k' } });

    const svc = restorer();
    const preview = await svc.stage(Readable.from(file), EXPORT_KEY);
    expect(preview.tables.find((t) => t.table === 'WorkflowVersion')).toMatchObject({
      inFile: 1,
      current: 0,
    });
    expect(preview.tables.find((t) => t.table === 'Instance')).toMatchObject({ inFile: 1, current: 2 });

    const result = await svc.apply(preview.uploadId, true);
    expect(result.restoredRows).toBe(preview.totalRows);

    expect(await prisma.instance.findMany({ select: { name: true, apiKey: true } })).toEqual([
      { name: 'Prod', apiKey: 'secret-key' },
    ]);
    const version = await prisma.workflowVersion.findFirstOrThrow();
    expect(version).toMatchObject({
      workflowId: workflow.id,
      semver: '1.2.0',
      raw: { nodes: [{ name: 'old' }] },
    });
    expect(await prisma.findingIgnore.count({ where: { workflowId: workflow.id } })).toBe(1);
    expect((await prisma.assistantLesson.findFirstOrThrow()).nodeTypes).toEqual(['httpRequest']);
    const group = await prisma.workflowGroup.findFirstOrThrow({ include: { workflows: true } });
    expect(group.workflows.map((w) => w.id)).toEqual([workflow.id]);
    const attachment = await prisma.workflowChatAttachment.findFirstOrThrow();
    expect(attachment.messageId).toBe(message.id);
    expect([...attachment.data]).toEqual([1, 2, 255]);
    const restoredMessage = await prisma.workflowChatMessage.findFirstOrThrow();
    expect(restoredMessage.toolTrace).toBeNull();
  });

  it('refuses a truncated file and writes nothing', async () => {
    await seed();
    const lines = gunzipSync(await plainBytes(await backupBytes()))
      .toString('utf8')
      .trimEnd()
      .split('\n');
    const truncated = gzipSync(lines.slice(0, -2).join('\n') + '\n');
    await expect(restorer().stage(Readable.from(truncated))).rejects.toThrow(/tronqu|Truncated/);
    expect(await prisma.instance.count()).toBe(1);
  });

  it('refuses a file that is not a backup', async () => {
    const notBackup = gzipSync(JSON.stringify({ kind: 'nwm-config', version: 1 }) + '\n');
    await expect(restorer().stage(Readable.from(notBackup))).rejects.toThrow(/sauvegarde|backup/);
  });

  it('applies nothing without explicit confirmation', async () => {
    await seed();
    const svc = restorer();
    const staged = await svc.stage(Readable.from(await backupBytes()), EXPORT_KEY);
    await expect(svc.apply(staged.uploadId, false)).rejects.toThrow();
    expect(await prisma.instance.count()).toBe(1);
  });

  it('seals the file with the export key: no secret is readable, and the key is required to restore', async () => {
    await seed();
    const file = await backupBytes();

    expect(file.includes(Buffer.from('secret-key'))).toBe(false);
    expect(() => gunzipSync(file)).toThrow();
    await expect(restorer().stage(Readable.from(file))).rejects.toThrow(/clé d'export|export key/i);
    await expect(restorer().stage(Readable.from(file), 'une-autre-cle-longue')).rejects.toThrow(
      /clé d'export|export key/i,
    );
  });

  it('refuses to write a backup without an export key', async () => {
    await expect(new FullBackupExportService(prisma).write(new PassThrough())).rejects.toThrow(
      /clé d'export|export key/i,
    );
  });

  it('still restores a backup taken before the export key, without any key', async () => {
    await seed();
    const legacy = await plainBytes(await backupBytes());
    await prisma.instance.create({ data: { name: 'Nouvelle', baseUrl: 'https://other.test', apiKey: 'k' } });

    const svc = restorer();
    const preview = await svc.stage(Readable.from(legacy));
    await svc.apply(preview.uploadId, true);

    expect(await prisma.instance.findMany({ select: { name: true, apiKey: true } })).toEqual([
      { name: 'Prod', apiKey: 'secret-key' },
    ]);
  });
});
