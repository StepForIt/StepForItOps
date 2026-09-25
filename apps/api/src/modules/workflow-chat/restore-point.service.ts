import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';

/** Où revenir si l'application tourne mal, tel qu'on le propose à l'écran. */
export interface RestorePoint {
  versionId: string;
  createdAt: Date;
}

/**
 * L'état d'avant l'écriture, et comment y revenir.
 *
 * Le filet manquait au moment qui compte : une modification s'applique, le
 * workflow devient inutilisable, et il faut aller chercher la bonne ligne dans la
 * page Versions — quand on pense à ce qu'elle existe. Le point de retour est donc
 * calculé AVANT le PUT et rendu avec le résultat.
 *
 * Lecture directe de `WorkflowVersion`, jamais du service de `versioning` : c'est
 * un module métier désactivable, qu'on n'importe pas. La restauration elle-même
 * reste chez lui — l'UI appelle sa route.
 */
@Injectable()
export class RestorePointService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ModuleRegistryService,
  ) {}

  /**
   * La version qui porte exactement l'état courant. Appariée sur le HASH et non
   * sur la date : « la plus récente » désignerait une version antérieure dès que
   * le workflow a bougé dans n8n sans que la plateforme l'ait revu, et on
   * proposerait de revenir à un état qui n'a jamais été celui d'avant.
   *
   * `null` quand il n'y en a pas — versioning désactivé, ou workflow jamais
   * versionné. On le dit alors, plutôt que de laisser croire à un filet.
   */
  async find(workflowId: string, hash: string): Promise<RestorePoint | null> {
    if (!(await this.registry.isEnabled('versioning'))) return null;
    const version = await this.prisma.workflowVersion.findFirst({
      where: { workflowId, hash },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });
    return version ? { versionId: version.id, createdAt: version.createdAt } : null;
  }
}
