import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Un nom lisible découvert, prêt à être mis en cache. */
export interface DiscoveredLabel {
  key: string;
  provider: string;
  label: string;
}

/**
 * Cache des noms lisibles de ressources externes.
 *
 * Écrit par `resource-discovery` (qui sait interroger les providers), lu par
 * `dep-graph` (qui affiche les tables). Le passage par une table partagée évite
 * qu'un module métier en importe un autre : le cache survit d'ailleurs à la
 * désactivation de la découverte.
 */
@Injectable()
export class ResourceLabelsService {
  constructor(private readonly prisma: PrismaService) {}

  /** key → label, pour toutes les ressources dont on connaît le vrai nom. */
  async all(): Promise<Map<string, string>> {
    const rows = await this.prisma.resourceLabel.findMany();
    return new Map(rows.map((row) => [row.key, row.label]));
  }

  /** Remplace les noms connus par ceux qu'on vient de découvrir. */
  async upsertMany(labels: DiscoveredLabel[]): Promise<number> {
    for (const { key, provider, label } of labels) {
      await this.prisma.resourceLabel.upsert({
        where: { key },
        create: { key, provider, label },
        update: { provider, label },
      });
    }
    return labels.length;
  }
}
