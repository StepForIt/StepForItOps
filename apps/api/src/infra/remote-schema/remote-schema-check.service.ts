import { Injectable } from '@nestjs/common';
import {
  N8nInstanceConfig,
  N8nWorkflow,
  RemoteSchemaReport,
  buildRemoteSchemaReport,
  requiredRemoteSchema,
} from '@nwm/core';
import { ReadOptions, RemoteSchemaReaderService } from './remote-schema-reader.service';

/** Id du module qui porte l'écran et les findings : la promotion le consulte sans l'importer. */
export const REMOTE_SCHEMA_MODULE_ID = 'remote-schema';

/**
 * « Le distant a-t-il tout ce que ce workflow attend ? », de bout en bout :
 * colonnes attendues (pur), lecture des tables sur l'instance donnée, rapport.
 * Vit dans l'infra parce que deux modules s'en servent — l'écran du workflow
 * et le gate de promotion, qui le joue contre l'instance CIBLE.
 */
@Injectable()
export class RemoteSchemaCheckService {
  constructor(private readonly reader: RemoteSchemaReaderService) {}

  async check(
    config: N8nInstanceConfig,
    workflow: N8nWorkflow,
    options: ReadOptions = {},
  ): Promise<RemoteSchemaReport> {
    const requirements = requiredRemoteSchema(workflow);
    const outcomes = await this.reader.readAll(
      config,
      requirements.tables.map((table) => table.locator),
      options,
    );
    return buildRemoteSchemaReport(requirements, outcomes);
  }
}
