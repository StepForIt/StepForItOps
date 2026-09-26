import { Injectable, NotFoundException } from '@nestjs/common';
import { msg } from '@nwm/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PrismaListArgs } from '../../common/crud/paginate';

/**
 * Cibles d'export telles qu'exposées à l'UI : les secrets du `config`
 * (token GitHub, accessToken Drive) ne sont JAMAIS renvoyés — même principe
 * que la clé API des instances (`InstancesService`). L'UI sait seulement
 * qu'un secret existe (`hasToken`) ; un update dont le champ arrive vide
 * conserve le secret enregistré.
 */

/** Clés du `config` qui sont des secrets, quel que soit le kind. */
const SECRET_CONFIG_KEYS = ['token', 'accessToken'] as const;

export interface ExportTargetView {
  id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  hasToken: boolean;
}

export interface ExportTargetInput {
  kind: string;
  name: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

function asConfig(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function toView(row: {
  id: string;
  kind: string;
  name: string;
  config: Prisma.JsonValue;
  enabled: boolean;
  createdAt: Date;
}): ExportTargetView {
  const config = asConfig(row.config);
  const hasToken = SECRET_CONFIG_KEYS.some((key) => Boolean(config[key]));
  for (const key of SECRET_CONFIG_KEYS) delete config[key];
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config,
    enabled: row.enabled,
    createdAt: row.createdAt,
    hasToken,
  };
}

@Injectable()
export class ExportTargetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(args: PrismaListArgs = { orderBy: { name: 'asc' } }): Promise<ExportTargetView[]> {
    const rows = await this.prisma.exportTarget.findMany(args);
    return rows.map(toView);
  }

  async get(id: string): Promise<ExportTargetView> {
    const row = await this.prisma.exportTarget.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(msg('platform.exportTargetNotFound', { id }));
    return toView(row);
  }

  /** Usage serveur uniquement : secret du config d'une cible (pour tester l'accès). */
  async storedSecret(id: string): Promise<string | undefined> {
    const row = await this.prisma.exportTarget.findUnique({ where: { id }, select: { config: true } });
    if (!row) return undefined;
    const config = asConfig(row.config);
    for (const key of SECRET_CONFIG_KEYS) {
      const value = config[key];
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
  }

  async create(input: ExportTargetInput): Promise<ExportTargetView> {
    const row = await this.prisma.exportTarget.create({
      data: { ...input, config: cleanConfig(input.config) as Prisma.InputJsonObject },
    });
    return toView(row);
  }

  /** Un secret vide ou absent dans le config reçu conserve celui déjà enregistré. */
  async update(id: string, input: Partial<ExportTargetInput>): Promise<ExportTargetView> {
    let config: Prisma.InputJsonObject | undefined;
    if (input.config !== undefined) {
      const existing = await this.prisma.exportTarget.findUnique({ where: { id }, select: { config: true } });
      if (!existing) throw new NotFoundException(msg('platform.exportTargetNotFound', { id }));
      const stored = asConfig(existing.config);
      const next = cleanConfig(input.config);
      for (const key of SECRET_CONFIG_KEYS) {
        if (!next[key] && stored[key]) next[key] = stored[key];
      }
      config = next as Prisma.InputJsonObject;
    }
    const row = await this.prisma.exportTarget.update({
      where: { id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(config !== undefined ? { config } : {}),
      },
    });
    return toView(row);
  }

  async delete(id: string): Promise<ExportTargetView> {
    const row = await this.prisma.exportTarget.delete({ where: { id } });
    return toView(row);
  }
}

/** Retire les secrets vides ('' saisi puis effacé) pour ne pas écraser avec du vide. */
function cleanConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  for (const key of SECRET_CONFIG_KEYS) {
    if (typeof next[key] === 'string' && !(next[key] as string).trim()) delete next[key];
  }
  return next;
}
