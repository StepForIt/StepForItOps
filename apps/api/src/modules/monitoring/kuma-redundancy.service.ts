import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  MONITOR_ADMIN_PORT,
  MonitorAdminPort,
  RedundancyInstance,
  RedundantProbe,
  findRedundantProbes,
} from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { callKuma } from './kuma-errors';

/** Étiquette posée dans Uptime Kuma sur les sondes que la plateforme rend inutiles. */
export const REDUNDANT_TAG_NAME = 'n8n-ops:à désactiver';
const REDUNDANT_TAG_COLOR = '#DC2626';

export interface RedundancyReview {
  /** Sondes candidates, à revoir avant tout marquage. */
  candidates: RedundantProbe[];
  /** Sondes déjà étiquetées lors d'un passage précédent. */
  alreadyTagged: number[];
  tagName: string;
}

export interface RedundancyTagResult {
  tagName: string;
  tagged: Array<{ externalId: number; name: string }>;
  skipped: Array<{ externalId: number; reason: string }>;
}

/**
 * Repérage des sondes Uptime Kuma que la plateforme a rendues redondantes, et marquage
 * par étiquette. On n'écrit JAMAIS l'état des sondes : Kuma reste maître de ce qu'il exécute,
 * l'étiquette ne fait que signaler quoi désactiver à la main. Le classement lui-même est
 * dans le domaine (`findRedundantProbes`), ce service ne fait que rassembler le contexte.
 */
@Injectable()
export class KumaRedundancyService {
  private readonly logger = new Logger(KumaRedundancyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MONITOR_ADMIN_PORT) private readonly kumaAdmin: MonitorAdminPort,
  ) {}

  /** Liste les sondes candidates, pour revue. Aucune écriture. */
  async review(): Promise<RedundancyReview> {
    if (!(await this.kumaAdmin.isConfigured())) {
      throw new BadRequestException(
        'Uptime Kuma non configuré : renseigner les réglages Kuma (page Monitors) ou KUMA_URL/KUMA_USERNAME/KUMA_PASSWORD dans le .env',
      );
    }
    const [probes, monitors, instances] = await Promise.all([
      callKuma('lecture des monitors', () => this.kumaAdmin.listProbes()),
      this.prisma.monitor.findMany({ select: { kind: true, enabled: true, config: true } }),
      this.prisma.instance.findMany({ select: { id: true, name: true, baseUrl: true } }),
    ]);

    const watchedInstanceIds = new Set(
      monitors
        .filter((monitor) => monitor.kind === 'error-watch' && monitor.enabled)
        .map((monitor) => (monitor.config as { instanceId?: string } | null)?.instanceId)
        .filter((id): id is string => id !== undefined),
    );
    const context: RedundancyInstance[] = instances.map((instance) => ({
      ...instance,
      hasErrorWatch: watchedInstanceIds.has(instance.id),
    }));

    const ownedExternalIds: number[] = [];
    const linkedEnabledExternalIds: number[] = [];
    for (const monitor of monitors) {
      const config = (monitor.config ?? {}) as { kumaMonitorId?: number; importedFromKuma?: boolean };
      if (config.kumaMonitorId === undefined) continue;
      if (config.importedFromKuma) {
        if (monitor.enabled) linkedEnabledExternalIds.push(config.kumaMonitorId);
      } else {
        ownedExternalIds.push(config.kumaMonitorId);
      }
    }

    const candidates = findRedundantProbes({
      probes,
      instances: context,
      ownedExternalIds,
      linkedEnabledExternalIds,
    });
    const alreadyTagged = probes
      .filter((probe) => probe.tags?.some((tag) => tag.name === REDUNDANT_TAG_NAME))
      .map((probe) => probe.externalId);

    return { candidates, alreadyTagged, tagName: REDUNDANT_TAG_NAME };
  }

  /**
   * Pose l'étiquette sur les sondes validées à la revue. Les identifiants qui ne sont pas
   * (ou plus) candidats sont refusés : le marquage ne doit jamais déborder de la liste revue.
   */
  async tagCandidates(externalIds: number[]): Promise<RedundancyTagResult> {
    if (!externalIds?.length) {
      throw new BadRequestException('Aucune sonde sélectionnée');
    }
    const { candidates } = await this.review();
    const byId = new Map(candidates.map((candidate) => [candidate.externalId, candidate]));

    const result: RedundancyTagResult = { tagName: REDUNDANT_TAG_NAME, tagged: [], skipped: [] };
    for (const externalId of externalIds) {
      const candidate = byId.get(externalId);
      if (candidate) result.tagged.push({ externalId, name: candidate.name });
      else result.skipped.push({ externalId, reason: 'sonde absente de la liste des candidates' });
    }
    if (result.tagged.length === 0) return result;

    const tag = await callKuma('création de l’étiquette', () =>
      this.kumaAdmin.ensureTag(REDUNDANT_TAG_NAME, REDUNDANT_TAG_COLOR),
    );
    await callKuma('marquage des sondes', () =>
      this.kumaAdmin.tagProbes(
        tag.id,
        result.tagged.map((probe) => probe.externalId),
      ),
    );
    this.logger.log(
      `Étiquette "${REDUNDANT_TAG_NAME}" posée sur ${result.tagged.length} sonde(s) : ${result.tagged
        .map((probe) => probe.name)
        .join(', ')}`,
    );
    return result;
  }
}
