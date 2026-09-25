import { Injectable } from '@nestjs/common';
import { N8nWorkflow, releaseKey } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Où en est un exemplaire vis-à-vis de sa dernière mise en service :
 * - `unreleased` : aucune promotion ne l'a jamais versionné, il n'y a rien à reprendre ;
 * - `clean` : son contenu est exactement celui qui a été publié sous ce numéro ;
 * - `dirty` : il a été modifié depuis, et ce qu'on s'apprête à promouvoir est neuf.
 */
export interface ReleaseState {
  state: 'unreleased' | 'clean' | 'dirty';
  /** Numéro de la dernière release, quand il y en a une. */
  version: string | null;
}

/**
 * La question que le numéro de version pose vraiment : « ce qui part a-t-il déjà
 * été publié ? ». Le diff avec la cible ne sait pas y répondre — il ne parle que
 * de la cible, quand c'est la LIGNÉE de la source qui décide.
 *
 * La réponse est en base sans rien y ajouter : le dernier snapshot qui porte un
 * `semver` EST le contenu mis en service, la promotion l'ayant estampillé au
 * moment de le publier (`stampVersion`).
 */
@Injectable()
export class ReleaseStateService {
  constructor(private readonly prisma: PrismaService) {}

  async of(workflowId: string, current: N8nWorkflow): Promise<ReleaseState> {
    const released = await this.prisma.workflowVersion.findFirst({
      where: { workflowId, semver: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { raw: true, semver: true },
    });
    if (!released) return { state: 'unreleased', version: null };
    const same = releaseKey(released.raw as unknown as N8nWorkflow) === releaseKey(current);
    return { state: same ? 'clean' : 'dirty', version: released.semver };
  }
}
