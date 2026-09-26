import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  N8nApiPort,
  N8N_API_PORT,
  N8nInstanceConfig,
  PlatformCapabilities,
  PlatformId,
  PlatformInstanceConfig,
  WorkflowPlatformPort,
  WorkflowPlatformPorts,
  WORKFLOW_PLATFORM_PORTS,
  msg,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PrismaListArgs } from '../../common/crud/paginate';

export interface InstanceInput {
  name: string;
  baseUrl: string;
  /** Vide ou absent lors d'un update : conserve la clé existante. */
  apiKey: string;
  /** Client de rattachement (vues agrégées) ; null = aucun. */
  clientId?: string | null;
  /**
   * Compte n8n, facultatif. Il n'ouvre RIEN de plus dans l'API publique : il sert
   * à lire `/types/*.json`, que n8n protège par le cookie de session, et donc à
   * décrire les nœuds de CETTE instance plutôt que ceux d'un n8n voisin.
   */
  n8nEmail?: string | null;
  /** Vide ou absent lors d'un update : conserve le mot de passe existant. */
  n8nPassword?: string;
  /**
   * `n8n` (défaut) ou `make`. Déclaré et jamais deviné : c'est cette valeur qui
   * décide avec quel code on lit le contenu des workflows de cette instance.
   */
  platform?: PlatformId;
  /** Make : la zone qui sert l'API (« eu1.make.com »…). */
  zone?: string | null;
  /** Make : le périmètre listé. Une des deux suffit, la team étant la plus précise. */
  externalOrgId?: string | null;
  externalTeamId?: string | null;
}

/** Instance telle qu'exposée à l'UI : la clé API n'est jamais renvoyée. */
export interface InstanceView {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  clientId: string | null;
  /** L'email est montré (il identifie le compte) ; le mot de passe ne l'est jamais. */
  n8nEmail: string | null;
  hasN8nLogin: boolean;
  /** Ce que cette instance sert. */
  platform: PlatformId;
  zone: string | null;
  externalOrgId: string | null;
  externalTeamId: string | null;
  createdAt: Date;
}

/** Projection Prisma commune à list/get : garantit l'absence d'apiKey dans les réponses. */
const VIEW_SELECT = {
  id: true,
  name: true,
  baseUrl: true,
  createdAt: true,
  apiKey: true,
  clientId: true,
  n8nEmail: true,
  n8nPassword: true,
  platform: true,
  zone: true,
  externalOrgId: true,
  externalTeamId: true,
} as const;

function toView(row: {
  id: string;
  name: string;
  baseUrl: string;
  createdAt: Date;
  apiKey: string;
  clientId: string | null;
  n8nEmail: string | null;
  n8nPassword: string | null;
  platform: string;
  zone: string | null;
  externalOrgId: string | null;
  externalTeamId: string | null;
}): InstanceView {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    hasApiKey: Boolean(row.apiKey),
    clientId: row.clientId,
    n8nEmail: row.n8nEmail,
    hasN8nLogin: Boolean(row.n8nEmail && row.n8nPassword),
    platform: row.platform as PlatformId,
    zone: row.zone,
    externalOrgId: row.externalOrgId,
    externalTeamId: row.externalTeamId,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class InstancesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(N8N_API_PORT) private readonly n8n: N8nApiPort,
    @Inject(WORKFLOW_PLATFORM_PORTS) private readonly platforms: WorkflowPlatformPorts,
  ) {}

  /**
   * Ce que la plateforme de cette instance sait faire. Un module s'en sert pour
   * dire « je ne sais pas faire ça ici » au lieu de rendre un écran vide.
   *
   * Une instance déclarée sur une plateforme qu'aucun adapter ne sert échoue
   * FORT : la seule autre issue serait de répondre les capacités de n8n pour un
   * compte Make, c'est-à-dire de promettre ce qu'on ne peut pas tenir.
   */
  async capabilities(id: string): Promise<{ platform: PlatformId } & PlatformCapabilities> {
    const row = await this.prisma.instance.findUnique({ where: { id }, select: { platform: true } });
    if (!row) throw new NotFoundException(msg('platform.instanceNotFoundAnon'));
    const port = this.platforms[row.platform as PlatformId];
    if (!port) throw new BadRequestException(msg('platform.platformUnsupported', { platform: row.platform }));
    return { platform: port.platform, ...port.capabilities() };
  }

  async list(args: PrismaListArgs = { orderBy: { name: 'asc' } }): Promise<InstanceView[]> {
    const rows = await this.prisma.instance.findMany({ ...args, select: VIEW_SELECT });
    return rows.map(toView);
  }

  async get(id: string): Promise<InstanceView> {
    const row = await this.prisma.instance.findUnique({ where: { id }, select: VIEW_SELECT });
    if (!row) throw new NotFoundException(msg('platform.instanceNotFound', { id }));
    return toView(row);
  }

  /** Usage serveur uniquement : renvoie la clé API en clair pour appeler n8n. */
  /**
   * De quoi joindre l'instance, quelle que soit sa plateforme, ET la plateforme
   * elle-même : les deux se lisent d'un seul coup parce qu'ils ne se dissocient
   * jamais — une configuration sans savoir à qui elle sert ne veut rien dire.
   */
  async getPlatformConfig(
    id: string,
  ): Promise<{ platform: PlatformId; port: WorkflowPlatformPort; config: PlatformInstanceConfig }> {
    const instance = await this.prisma.instance.findUnique({
      where: { id },
      select: {
        baseUrl: true,
        apiKey: true,
        platform: true,
        zone: true,
        externalOrgId: true,
        externalTeamId: true,
      },
    });
    if (!instance) throw new NotFoundException(msg('platform.instanceNotFound', { id }));
    const platform = instance.platform as PlatformId;
    const port = this.platforms[platform];
    if (!port)
      throw new BadRequestException(msg('platform.platformUnsupported', { platform: instance.platform }));
    return {
      platform,
      port,
      config: {
        baseUrl: instance.baseUrl,
        apiKey: instance.apiKey,
        zone: instance.zone ?? undefined,
        orgId: instance.externalOrgId ?? undefined,
        teamId: instance.externalTeamId ?? undefined,
      },
    };
  }

  async getConfig(id: string): Promise<N8nInstanceConfig> {
    const instance = await this.prisma.instance.findUnique({
      where: { id },
      select: { baseUrl: true, apiKey: true, n8nEmail: true, n8nPassword: true },
    });
    if (!instance) throw new NotFoundException(msg('platform.instanceNotFound', { id }));
    return {
      baseUrl: instance.baseUrl,
      apiKey: instance.apiKey,
      ...(instance.n8nEmail && instance.n8nPassword
        ? { login: { email: instance.n8nEmail, password: instance.n8nPassword } }
        : {}),
    };
  }

  async create(input: InstanceInput): Promise<InstanceView> {
    const apiKey = input.apiKey?.trim();
    if (!apiKey) throw new BadRequestException(msg('platform.apiKeyRequired'));
    const row = await this.prisma.instance.create({
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        apiKey,
        clientId: input.clientId ?? null,
        n8nEmail: input.n8nEmail?.trim() || null,
        n8nPassword: input.n8nPassword?.trim() || null,
        platform: input.platform ?? 'n8n',
        zone: input.zone?.trim() || null,
        externalOrgId: input.externalOrgId?.trim() || null,
        externalTeamId: input.externalTeamId?.trim() || null,
      },
      select: VIEW_SELECT,
    });
    return toView(row);
  }

  /** Une clé API vide ou absente conserve celle déjà enregistrée. */
  async update(id: string, input: Partial<InstanceInput>): Promise<InstanceView> {
    const apiKey = input.apiKey?.trim();
    const row = await this.prisma.instance.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        // Email vidé ⇒ le compte est retiré, mot de passe compris : laisser un
        // secret orphelin derrière un champ que l'UI n'affiche plus serait pire
        // que de le supprimer.
        ...(input.n8nEmail !== undefined
          ? input.n8nEmail?.trim()
            ? { n8nEmail: input.n8nEmail.trim() }
            : { n8nEmail: null, n8nPassword: null }
          : {}),
        ...(input.n8nPassword?.trim() ? { n8nPassword: input.n8nPassword.trim() } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
        ...(input.zone !== undefined ? { zone: input.zone?.trim() || null } : {}),
        ...(input.externalOrgId !== undefined ? { externalOrgId: input.externalOrgId?.trim() || null } : {}),
        ...(input.externalTeamId !== undefined
          ? { externalTeamId: input.externalTeamId?.trim() || null }
          : {}),
      },
      select: VIEW_SELECT,
    });
    return toView(row);
  }

  async delete(id: string): Promise<InstanceView> {
    const row = await this.prisma.instance.delete({ where: { id }, select: VIEW_SELECT });
    return toView(row);
  }

  /** Teste la connexion d'une instance enregistrée. */
  async testConnection(id: string): Promise<{ ok: boolean; workflowCount?: number; error?: string }> {
    const { platform, config } = await this.getPlatformConfig(id);
    return this.testConfig({ ...config, platform });
  }

  /**
   * Teste des identifiants AVANT sauvegarde (formulaire).
   * Sans clé API dans le body, reprend celle stockée pour l'instance ciblée (formulaire d'édition).
   */
  /**
   * Éprouve une configuration AVANT de l'enregistrer. Le test passe par le port
   * de la plateforme choisie, pas par n8n en dur : sur Make, l'erreur qu'on veut
   * lire est précisément celle qui distingue une mauvaise zone d'un droit
   * manquant, et un test qui n'irait pas jusque-là ne servirait à rien.
   */
  async testConfig(
    config: {
      baseUrl: string;
      apiKey?: string;
      platform?: PlatformId;
      zone?: string;
      orgId?: string;
      teamId?: string;
    },
    instanceId?: string,
  ): Promise<{ ok: boolean; workflowCount?: number; error?: string }> {
    let apiKey = config.apiKey?.trim();
    if (!apiKey && instanceId) apiKey = (await this.getConfig(instanceId)).apiKey;
    if (!apiKey) throw new BadRequestException(msg('platform.apiKeyRequiredForTest'));

    const platform = config.platform ?? 'n8n';
    const port = this.platforms[platform];
    if (!port) return { ok: false, error: msg('platform.platformUnsupported', { platform }) };

    try {
      const workflows = await port.listWorkflows({
        baseUrl: config.baseUrl,
        apiKey,
        zone: config.zone,
        orgId: config.orgId,
        teamId: config.teamId,
      });
      return { ok: true, workflowCount: workflows.length };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
