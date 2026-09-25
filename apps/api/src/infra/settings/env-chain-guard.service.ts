import { BadRequestException, Injectable } from '@nestjs/common';
import { detectWorkflowEnv, envIds, envLabel, isDownstreamEnv, upstreamEnv } from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * Le mode `block` de la chaîne d'envs, appliqué aux écritures qui ne sont PAS des
 * promotions : édition IA, restauration d'une version, renommage sûr.
 *
 * Déclarer une chaîne bloquante et ne la faire respecter qu'à la promotion ne
 * garantirait rien — il resterait une porte ouverte sur la prod, celle par
 * laquelle passent justement les corrections faites dans l'urgence. Le premier
 * env de la chaîne est celui où l'on travaille ; les suivants ne reçoivent que
 * ce qu'on y promeut.
 *
 * Sans contournement par `force` : c'est le sens du mode, et il est optionnel
 * (`warn` par défaut). Un env sans amont — la racine, ou un env indéterminable —
 * n'est régi par rien : on ne refuse pas une écriture qu'on ne sait pas situer.
 */
@Injectable()
export class EnvChainGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async assertDirectWriteAllowed(workflowId: string): Promise<void> {
    const { envs, envChainMode } = await this.settings.get();
    if (envChainMode !== 'block') return;
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { name: true, tags: true },
    });
    if (!workflow) return;
    const env = detectWorkflowEnv(workflow.name, workflow.tags, envIds(envs));
    if (!isDownstreamEnv(envs, env)) return;
    const upstream = upstreamEnv(envs, env);
    throw new BadRequestException(
      `« ${workflow.name} » est en ${envLabel(envs, env)}, et la chaîne d'environnements est en mode bloquant : ` +
        `un env aval ne se modifie qu'en y promouvant. Fais le changement en ${envLabel(envs, upstream)}, puis promeus.`,
    );
  }
}
