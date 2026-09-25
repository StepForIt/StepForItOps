import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { MONITOR_ADMIN_PORT, MonitorAdminPort } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { KUMA_SETTINGS_ID } from '../../infra/adapters/kuma-credentials.provider';

export interface KumaSettingsInput {
  url?: string;
  username?: string;
  /** Vide ou absent lors d'un update : conserve le mot de passe existant. */
  password?: string;
}

export interface KumaSettingsView {
  url: string | null;
  username: string | null;
  hasPassword: boolean;
  /** Origine des credentials effectifs : réglages DB, variables d'env, ou rien. */
  source: 'db' | 'env' | 'none';
}

/** Réglages Uptime Kuma stockés en DB (le mot de passe n'est jamais renvoyé). */
@Injectable()
export class MonitoringSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MONITOR_ADMIN_PORT) private readonly kumaAdmin: MonitorAdminPort,
  ) {}

  async get(): Promise<KumaSettingsView> {
    const settings = await this.prisma.monitoringSettings.findUnique({ where: { id: KUMA_SETTINGS_ID } });
    const dbComplete = Boolean(settings?.kumaUrl && settings.kumaUsername && settings.kumaPassword);
    // Le port résout DB puis env : si la DB est incomplète mais qu'il est configuré, c'est l'env.
    const source = dbComplete ? 'db' : (await this.kumaAdmin.isConfigured()) ? 'env' : 'none';
    return {
      url: settings?.kumaUrl ?? null,
      username: settings?.kumaUsername ?? null,
      hasPassword: Boolean(settings?.kumaPassword),
      source,
    };
  }

  async save(input: KumaSettingsInput): Promise<KumaSettingsView> {
    const url = input.url?.trim();
    const username = input.username?.trim();
    const password = input.password?.trim() || undefined;
    if (!url || !username) throw new BadRequestException('URL et utilisateur Kuma requis');

    const existing = await this.prisma.monitoringSettings.findUnique({ where: { id: KUMA_SETTINGS_ID } });
    if (!password && !existing?.kumaPassword) throw new BadRequestException('Mot de passe Kuma requis');

    await this.prisma.monitoringSettings.upsert({
      where: { id: KUMA_SETTINGS_ID },
      create: { id: KUMA_SETTINGS_ID, kumaUrl: url, kumaUsername: username, kumaPassword: password ?? '' },
      update: { kumaUrl: url, kumaUsername: username, ...(password ? { kumaPassword: password } : {}) },
    });
    return this.get();
  }

  /** Supprime les réglages DB : retour au fallback variables d'env. */
  async clear(): Promise<KumaSettingsView> {
    await this.prisma.monitoringSettings.deleteMany({ where: { id: KUMA_SETTINGS_ID } });
    return this.get();
  }

  /**
   * Teste connexion + login. Avec un body (formulaire), teste ces valeurs avant sauvegarde
   * (mot de passe absent : reprend celui stocké) ; sans body, teste les credentials effectifs.
   */
  async test(input?: KumaSettingsInput): Promise<{ ok: true }> {
    try {
      const url = input?.url?.trim();
      const username = input?.username?.trim();
      if (url && username) {
        const password =
          input?.password?.trim() ||
          (await this.prisma.monitoringSettings.findUnique({ where: { id: KUMA_SETTINGS_ID } }))
            ?.kumaPassword;
        if (!password) throw new BadRequestException('Mot de passe Kuma requis pour tester');
        await this.kumaAdmin.testConnection({ url, username, password });
      } else {
        await this.kumaAdmin.testConnection();
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Connexion Uptime Kuma KO : ${(error as Error).message}`);
    }
    return { ok: true };
  }
}
