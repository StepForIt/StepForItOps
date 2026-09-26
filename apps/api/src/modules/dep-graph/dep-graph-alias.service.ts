import { BadRequestException, Injectable } from '@nestjs/common';
import { msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Noms posés à la main : rendre lisible ce que n8n ne stocke qu'en ids, et
 * rattacher ce que rien ne rattache (un `http:<host>` renommé « NocoDB · API
 * directe » devient trouvable sous « noco », indéductible du JSON).
 * L'alias n'est pas recalculé, donc jamais perdu.
 */
@Injectable()
export class DepGraphAliasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pose l'alias, ou le retire si le label est vide (le nom calculé reprend la main). */
  async rename(key: string, label: string): Promise<{ key: string; label: string }> {
    if (!key) throw new BadRequestException(msg('platform.keyMissing'));

    const trimmed = label?.trim() ?? '';
    if (trimmed.length === 0) {
      await this.prisma.depNodeAlias.deleteMany({ where: { key } });
      return { key, label: '' };
    }

    await this.prisma.depNodeAlias.upsert({
      where: { key },
      create: { key, label: trimmed },
      update: { label: trimmed },
    });
    return { key, label: trimmed };
  }
}
