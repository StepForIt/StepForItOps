import { Injectable } from '@nestjs/common';
import { ExampleWorkflow, N8nWorkflow } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ARCHIVED_WORKFLOW_WHERE } from '../../infra/settings/archived-workflows.where';
import { BENCH_WORKFLOW_WHERE } from '../../infra/settings/bench-workflows.where';
import { MISSING_WORKFLOW_WHERE } from '../../infra/settings/missing-workflows.where';
import { TESTER_WORKFLOW_WHERE } from '../../infra/settings/tester-workflows.where';

/**
 * Le parc entier, TOUTES instances confondues, comme base d'exemples pour
 * l'assistant.
 *
 * Distinct d'`InstanceCorpusService`, qui répond de l'instance du workflow en
 * cours et sert de NORME (formes de paramètres, credentials — deux choses qui
 * ne franchissent pas la frontière d'une instance : un id de credential ne vaut
 * que chez lui). Ici on cherche un MODÈLE de montage, et un montage voyage :
 * la convention posée en dev sur une instance vaut pour la prod d'une autre.
 */
const TTL_MS = 60_000;

/**
 * Workflows chargés, les plus récemment touchés d'abord. Le parc entier tient
 * rarement en mémoire sans qu'on le regrette : un raw pèse des dizaines de Ko,
 * et au-delà de quelques centaines de workflows on paie une lecture complète
 * pour des exemples que le classement par fraîcheur n'aurait jamais servis.
 */
const MAX_WORKFLOWS = 400;

@Injectable()
export class ExampleCorpusService {
  private cache: { at: number; workflows: ExampleWorkflow[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async workflows(): Promise<ExampleWorkflow[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.workflows;

    const rows = await this.prisma.workflow.findMany({
      // Archivés et supprimés dans n8n sont écartés SANS regarder le réglage
      // d'affichage : montrer un montage qu'on a rangé, ou qui n'existe plus,
      // c'est proposer de reproduire ce qu'on a justement cessé de faire.
      // Bancs, bouchons et copies de test le sont pour la même raison qu'ailleurs.
      where: {
        AND: [
          { NOT: ARCHIVED_WORKFLOW_WHERE },
          { NOT: MISSING_WORKFLOW_WHERE },
          { NOT: BENCH_WORKFLOW_WHERE },
          { NOT: TESTER_WORKFLOW_WHERE },
        ],
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        raw: true,
        instance: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_WORKFLOWS,
    });

    const workflows = rows.map((row) => ({
      id: row.id,
      name: row.name,
      instance: row.instance.name,
      updatedAt: row.updatedAt,
      raw: row.raw as unknown as N8nWorkflow,
    }));
    this.cache = { at: Date.now(), workflows };
    return workflows;
  }

  /**
   * Un workflow du parc par son nom. Exact d'abord, puis « contient » : le
   * modèle recopie le nom qu'un exemple lui a rendu, mais l'utilisateur, lui,
   * le dicte de mémoire (« regarde dans Facturation »).
   */
  async byName(name: string): Promise<ExampleWorkflow | null> {
    const needle = name.trim().toLowerCase();
    if (!needle) return null;
    const all = await this.workflows();
    return (
      all.find((workflow) => workflow.name.toLowerCase() === needle) ??
      all.find((workflow) => workflow.name.toLowerCase().includes(needle)) ??
      null
    );
  }
}
