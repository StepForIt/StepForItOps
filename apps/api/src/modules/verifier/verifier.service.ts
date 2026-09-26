import { Injectable } from '@nestjs/common';
import {
  EVENTS,
  N8nWorkflow,
  VerificationCompletedEvent,
  isGroupFullyDisabled,
  CheckFinding,
  runMakeChecks,
  runWorkflowChecks,
  markAutoFixable,
  MakeBlueprint,
  PlatformId,
} from '@nwm/core';
import { Finding } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventBusService } from '../../infra/events/event-bus.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { FindingIgnoreService } from '../workflows/finding-ignore.service';
import { CheckProfilesService } from '../../infra/check-profiles/check-profiles.service';
import { NodeCatalogService } from '../../infra/node-catalog/node-catalog.service';
import { PlatformLocale } from '../../infra/i18n/platform-locale';
import { AiLogicReviewService } from './ai-logic-review.service';

@Injectable()
export class VerifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly workflows: WorkflowsService,
    private readonly ignores: FindingIgnoreService,
    private readonly profiles: CheckProfilesService,
    private readonly nodeCatalog: NodeCatalogService,
    private readonly aiReview: AiLogicReviewService,
    private readonly platformLocale: PlatformLocale,
  ) {}

  /**
   * `disabledChecks` : sélection composée dans l'écran de lancement et pas encore
   * enregistrée. Absente, c'est le profil du workflow qui s'applique. Un contrôle
   * décoché n'est pas filtré à l'affichage mais jamais joué : la revue IA n'est
   * même pas appelée si tout ce qu'elle produit est décoché.
   */
  verify(workflowId: string, withAi: boolean, disabledChecks?: string[]): Promise<Finding[]> {
    // Les findings sont stockés pour tous : dans la langue de la plateforme, pas celle du lanceur.
    return this.platformLocale.run(() => this.runChecks(workflowId, withAi, disabledChecks));
  }

  private async runChecks(
    workflowId: string,
    withAi: boolean,
    disabledChecks?: string[],
  ): Promise<Finding[]> {
    const { workflow: meta, raw } = await this.workflows.getRawAny(workflowId);
    const disabled = await this.profiles.effective(workflowId, disabledChecks);
    const off = new Set(disabled);

    const instance = await this.prisma.instance.findUnique({
      where: { id: meta.instanceId },
      select: { platform: true },
    });
    const platform = (instance?.platform ?? 'n8n') as PlatformId;

    // Chaque plateforme a ses fautes, et elles ne portent pas les mêmes noms :
    // chez Make le graphe est imbriqué et les renvois sont des ids, si bien
    // qu'une « ref cassée » se cherche autrement. Les findings, eux, sont les
    // mêmes objets — sinon il aurait fallu doubler la page, les exclusions et
    // la porte de l'assistant.
    if (platform === 'make') {
      return this.persist(
        workflowId,
        runMakeChecks(raw as MakeBlueprint).filter((finding) => !off.has(finding.code)),
      );
    }

    const workflow = raw as N8nWorkflow;

    // Structure (refs cassées, orphelins), fiabilité (retry, erreurs avalées,
    // secrets en clair, timeouts) et valeurs d'exemple jamais remplacées : la
    // même liste que celle dont l'assistant se sert pour se relire.
    const found = runWorkflowChecks(workflow).filter((finding) => !off.has(finding.code));

    // Conformité au schéma des nœuds. À part de `runWorkflowChecks`, qui est pur
    // et sans IO : ce contrôle-ci a besoin du catalogue en base. L'instance prime
    // sur le catalogue mutualisé — elle décrit le n8n qui exécutera vraiment ce
    // workflow. Un type absent des deux ne produit rien : c'est un trou du
    // catalogue, pas une faute du workflow.
    if (!isGroupFullyDisabled(disabled, 'node-schema')) {
      const schemaFindings = await this.nodeCatalog.check(workflow, meta.instanceId);
      found.push(...schemaFindings.filter((finding) => !off.has(finding.code)));
    }
    if (withAi && !isGroupFullyDisabled(disabled, 'ai-logic')) {
      // Les règles d'exclusion sont données à la revue : sinon elle redécouvre à
      // chaque passe ce qu'on lui a déjà dit d'accepter.
      const ignored = await this.ignores.hintsFor(workflowId, 'verifier');
      found.push(...(await this.aiReview.review(workflow, ignored)).filter((f) => !off.has(f.code)));
    }
    return this.persist(workflowId, markAutoFixable(workflow, found));
  }

  /**
   * Le sort commun de tout ce qui a été trouvé, quelle que soit la plateforme :
   * on écarte ce qui est déclaré normal, on remplace les findings précédents de
   * ce module, on date la passe et on prévient. Partagé exprès — deux chemins de
   * persistance divergeraient au premier changement, et c'est ici que se
   * décident les compteurs affichés partout.
   */
  private async persist(workflowId: string, found: CheckFinding[]): Promise<Finding[]> {
    // Les findings déclarés « normaux » ne sont jamais persistés
    const { kept: findings } = await this.ignores.filterIgnored(workflowId, 'verifier', found);

    // Remplace les findings précédents de ce module pour ce workflow
    await this.prisma.finding.deleteMany({ where: { workflowId, module: 'verifier' } });
    await this.prisma.finding.createMany({
      data: findings.map((f) => ({
        workflowId,
        module: 'verifier',
        severity: f.severity,
        code: f.code,
        message: f.message,
        nodeName: f.nodeName,
        data: f.data as object | undefined,
      })),
    });

    const stored = await this.prisma.finding.findMany({
      where: { workflowId, module: 'verifier' },
      orderBy: { createdAt: 'desc' },
    });
    await this.prisma.analysisRun.create({
      data: { workflowId, module: 'verifier', findingsCount: stored.length },
    });
    const event: VerificationCompletedEvent = {
      workflowId,
      findingsCount: stored.length,
      errors: stored.filter((f) => f.severity === 'error').length,
      warnings: stored.filter((f) => f.severity === 'warning').length,
    };
    this.eventBus.emit(EVENTS.verificationCompleted, event);
    return stored;
  }
}
