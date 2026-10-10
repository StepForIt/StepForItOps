import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { CredentialCheckService } from './credential-check.service';
import { CredentialCheckSettingsService } from './credential-check-settings.service';
import { CREDENTIAL_CHECK_MANIFEST } from './manifest';

export interface CredentialWatchResult {
  checked: number;
  failed: number;
}

/**
 * Le test automatique. Le cron passe CHAQUE HEURE mais ne joue que ce qui est dû : les
 * fréquences se règlent en heures dans Paramètres, et un cron quotidien figé aurait rendu
 * « toutes les 6 h » impossible. Une passe sans rien de dû ne coûte qu'une lecture en base.
 *
 * Un test à la fois, par instance : chacun crée puis supprime un workflow chez le client.
 */
@Injectable()
export class CredentialWatchService {
  private readonly logger = new Logger(CredentialWatchService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly checks: CredentialCheckService,
    private readonly settings: CredentialCheckSettingsService,
    private readonly registry: ModuleRegistryService,
  ) {}

  @Cron('17 * * * *')
  async tick(): Promise<void> {
    if (!(await this.registry.isEnabled(CREDENTIAL_CHECK_MANIFEST.id))) return;
    try {
      await this.run();
    } catch (error) {
      this.logger.warn(`Credential check pass failed: ${(error as Error).message}`);
    }
  }

  async run(now = new Date()): Promise<CredentialWatchResult> {
    const result: CredentialWatchResult = { checked: 0, failed: 0 };
    const settings = await this.settings.get();
    // Une passe lente ne doit pas être doublée par la suivante : deux sondes sur la même credential.
    if (!settings.enabled || this.running) return result;
    this.running = true;
    try {
      const schedule = this.settings.schedule(settings);
      const instances = await this.prisma.instance.findMany({
        where: { platform: 'n8n' },
        select: { id: true },
      });
      await this.prisma.credentialCheckState.deleteMany({
        where: {
          instanceId: {
            notIn: (await this.prisma.instance.findMany({ select: { id: true } })).map((i) => i.id),
          },
        },
      });
      for (const { id: instanceId } of instances) {
        for (const { credentialId, level } of await this.checks.due(instanceId, schedule, now)) {
          try {
            await this.checks.check(instanceId, credentialId, level);
            result.checked += 1;
          } catch (error) {
            // Instance injoignable ou refusée : les credentials suivantes échoueraient de même,
            // et chaque tentative est un workflow créé chez le client. On réessaie à la prochaine heure.
            result.failed += 1;
            this.logger.warn(`Credential check skipped on ${instanceId}: ${(error as Error).message}`);
            break;
          }
        }
      }
    } finally {
      this.running = false;
    }
    return result;
  }
}
