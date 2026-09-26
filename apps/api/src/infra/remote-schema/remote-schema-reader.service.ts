import { Injectable, Logger } from '@nestjs/common';
import {
  N8nInstanceConfig,
  RemoteTableLocator,
  RemoteTableSchema,
  TableReadOutcome,
  parsePostgresColumns,
  parseSheetHeader,
  parseSheetTitle,
  schemaReadFor,
  sheetHeaderRequest,
  msg,
} from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { N8nProbeService, ProbeCall } from '../n8n-probe/n8n-probe.service';
import {
  buildHttpProbeWorkflow,
  buildPostgresProbeWorkflow,
  httpProbePayload,
} from '../n8n-probe/probe-workflow.builder';
import { ProbeCallError, readHttpProbeResponse, readRowsProbeResponse } from '../n8n-probe/probe-response';

/** Une lecture relue dans la minute n'est pas refaite : le preview de promotion se rejoue à chaque option cochée. */
const CACHE_TTL_MS = 60_000;

export interface ReadOptions {
  keepOnError?: boolean;
}

/**
 * Lit les colonnes réelles de tables distantes, par un workflow n8n temporaire
 * authentifié par la credential du nœud. Une sonde par credential, quel que
 * soit le nombre de tables : c'est la credential qui décide de ce qu'on a le
 * droit de lire, et chaque sonde coûte quatre appels à l'API n8n.
 */
@Injectable()
export class RemoteSchemaReaderService {
  private readonly logger = new Logger(RemoteSchemaReaderService.name);
  private readonly cache = new Map<string, { at: number; outcome: TableReadOutcome }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly probe: N8nProbeService,
  ) {}

  async readAll(
    config: N8nInstanceConfig,
    locators: RemoteTableLocator[],
    options: ReadOptions = {},
  ): Promise<Map<string, TableReadOutcome>> {
    const outcomes = new Map<string, TableReadOutcome>();
    const groups = new Map<string, RemoteTableLocator[]>();

    for (const locator of locators) {
      if (!locator.credential) {
        outcomes.set(locator.key, { status: 'unverified', reason: msg('analysis.remoteNoCredential') });
        continue;
      }
      const cached = this.cache.get(this.cacheKey(config, locator));
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        outcomes.set(locator.key, cached.outcome);
        continue;
      }
      const group = `${locator.provider}|${locator.credential.type}|${locator.credential.id}`;
      groups.set(group, [...(groups.get(group) ?? []), locator]);
    }

    for (const group of groups.values()) {
      const read = await this.readGroup(config, group, options);
      for (const [key, outcome] of read) {
        outcomes.set(key, outcome);
        const locator = group.find((candidate) => candidate.key === key);
        if (locator) this.cache.set(this.cacheKey(config, locator), { at: Date.now(), outcome });
      }
    }
    return outcomes;
  }

  private cacheKey(config: N8nInstanceConfig, locator: RemoteTableLocator): string {
    return `${config.baseUrl}|${locator.credential?.id ?? ''}|${locator.key}`;
  }

  /** Toutes les tables d'une même credential, par une seule sonde. */
  private async readGroup(
    config: N8nInstanceConfig,
    locators: RemoteTableLocator[],
    options: ReadOptions,
  ): Promise<Map<string, TableReadOutcome>> {
    const outcomes = new Map<string, TableReadOutcome>();
    const [first] = locators;
    const credential = first.credential!;
    const host = first.provider === 'nocodb' ? await this.nocoDbHost(credential.id) : undefined;

    const readable = locators.filter((locator) => {
      const read = schemaReadFor(locator, { host });
      if (read.kind !== 'unsupported') return true;
      outcomes.set(locator.key, { status: 'unverified', reason: read.reason });
      return false;
    });
    if (readable.length === 0) return outcomes;

    const webhookPath = this.probe.newWebhookPath();
    const probeOptions = {
      webhookPath,
      credentialType: credential.type,
      credential,
      label: `${first.provider}/schema`,
    };
    const workflow =
      first.provider === 'postgres'
        ? buildPostgresProbeWorkflow(probeOptions)
        : buildHttpProbeWorkflow(probeOptions);

    try {
      await this.probe.run(
        config,
        workflow,
        webhookPath,
        async (call) => {
          // Un même corps sert plusieurs tables (Airtable rend toute la base en un appel).
          const bodies = new Map<string, Promise<unknown>>();
          const fetchOnce: ProbeCall = (payload) => {
            const key = JSON.stringify(payload);
            if (!bodies.has(key)) bodies.set(key, call(payload));
            return bodies.get(key)!;
          };
          for (const locator of readable) {
            outcomes.set(locator.key, await this.readOne(fetchOnce, locator, host));
          }
          // La sonde est conservée pour debug si TOUT a échoué : un échec isolé est une table, pas la sonde.
          const failed = readable.every((locator) => outcomes.get(locator.key)?.status === 'unverified');
          if (failed && options.keepOnError) throw new Error(msg('analysis.remoteAllReadsFailed'));
        },
        options,
      );
    } catch (error) {
      const reason = msg('analysis.remoteProbeFailed', { error: (error as Error).message });
      this.logger.warn(
        `Schema read ${first.provider} (${credential.id}): n8n probe failed: ${(error as Error).message}`,
      );
      for (const locator of readable)
        if (!outcomes.has(locator.key)) outcomes.set(locator.key, { status: 'unverified', reason });
    }
    return outcomes;
  }

  private async readOne(
    call: ProbeCall,
    locator: RemoteTableLocator,
    host?: string,
  ): Promise<TableReadOutcome> {
    const read = schemaReadFor(locator, { host });
    try {
      switch (read.kind) {
        case 'unsupported':
          return { status: 'unverified', reason: read.reason };
        case 'http':
          return { status: 'read', schema: read.parse(await this.http(call, read.request)) };
        case 'sql': {
          const body = await call({ schema: read.schema, table: read.table });
          return {
            status: 'read',
            schema: parsePostgresColumns(
              readRowsProbeResponse(body, msg('analysis.remoteColumnsOf', { table: locator.key })),
            ),
          };
        }
        case 'sheet-title': {
          const title = parseSheetTitle(await this.http(call, read.request), read.gid);
          if (!title) return { status: 'read', schema: { found: false } satisfies RemoteTableSchema };
          return {
            status: 'read',
            schema: parseSheetHeader(await this.http(call, sheetHeaderRequest(read.document, title))),
          };
        }
      }
    } catch (error) {
      if (error instanceof ProbeCallError && error.httpStatus === 404)
        return { status: 'read', schema: { found: false } };
      return { status: 'unverified', reason: (error as Error).message };
    }
  }

  private async http(call: ProbeCall, request: Parameters<typeof httpProbePayload>[0]): Promise<unknown> {
    return readHttpProbeResponse(await call(httpProbePayload(request)), request);
  }

  /** NocoDB auto-hébergé range l'URL de son API dans la credential, que l'API n8n ne rend pas. */
  private async nocoDbHost(credentialId: string): Promise<string | undefined> {
    const endpoint = await this.prisma.providerEndpoint.findUnique({
      where: { provider_credentialId: { provider: 'nocodb', credentialId } },
    });
    if (!endpoint) return undefined;
    const host = endpoint.host.trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(host) ? host : `https://${host}`;
  }
}
