import { Injectable } from '@nestjs/common';
import { findingMessageKey, msg } from '@nwm/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ConfigBundle, ImportReport, ImportStrategy, SectionReport } from './config-bundle.types';
import { WorkflowRefResolver } from './workflow-ref.resolver';

/**
 * Sections du bundle accrochées à des workflows (règles d'exclusion de findings,
 * groupes, liens manuels de la carte). Elles ne peuvent aboutir qu'une fois les
 * workflows synchronisés depuis n8n sur la base cible : chaque référence non
 * résolue est signalée plutôt que créée à moitié.
 */
@Injectable()
export class ConfigImportWorkflowScopedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: WorkflowRefResolver,
  ) {}

  async importAll(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
    act: (
      existing: boolean,
      strategy: ImportStrategy,
      section: SectionReport,
    ) => 'create' | 'update' | 'skip',
  ): Promise<void> {
    await this.importFindingIgnores(bundle, strategy, dryRun, report, act);
    await this.importWorkflowGroups(bundle, strategy, dryRun, report, act);
    await this.importWorkflowLinks(bundle, strategy, dryRun, report, act);
  }

  private async importFindingIgnores(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
    act: (
      existing: boolean,
      strategy: ImportStrategy,
      section: SectionReport,
    ) => 'create' | 'update' | 'skip',
  ): Promise<void> {
    const section = report.sections.findingIgnores;
    for (const entry of bundle.findingIgnores ?? []) {
      let workflowId: string | null = null;
      if (entry.workflowRef) {
        workflowId = await this.refs.workflowId(entry.workflowRef);
        if (!workflowId) {
          // Créer la règle sans workflow l'élargirait à toute la plateforme : on s'abstient.
          section.skipped++;
          report.warnings.push(
            WorkflowRefResolver.missing(
              msg('platform.importSubject', { kind: 'findingIgnore', name: `${entry.module}/${entry.code}` }),
              entry.workflowRef,
            ),
          );
          continue;
        }
      }

      // L'ancre de famille est optionnelle : introuvable ici, la règle retombe sur
      // sa familyKey (le service la ré-ancrera au premier appariement).
      const familyWorkflowId = entry.familyWorkflowRef
        ? await this.refs.workflowId(entry.familyWorkflowRef)
        : null;

      const existing = await this.prisma.findingIgnore.findFirst({
        where: {
          workflowId,
          familyKey: entry.familyKey ?? null,
          module: entry.module,
          code: entry.code,
          nodeName: entry.nodeName,
        },
      });
      const action = act(!!existing, strategy, section);
      if (action === 'skip' || dryRun) continue;

      if (action === 'create') {
        await this.prisma.findingIgnore.create({
          data: {
            workflowId,
            familyKey: entry.familyKey ?? null,
            familyWorkflowId,
            module: entry.module,
            code: entry.code,
            nodeName: entry.nodeName,
            nodeId: entry.nodeId ?? null,
            message: entry.message ?? null,
            messageKey: entry.message ? findingMessageKey(entry.message) : null,
            reason: entry.reason,
          },
        });
      } else if (existing) {
        await this.prisma.findingIgnore.update({
          where: { id: existing.id },
          data: {
            reason: entry.reason,
            ...(existing.familyWorkflowId ? {} : { familyWorkflowId }),
            ...(existing.nodeId ? {} : { nodeId: entry.nodeId ?? null }),
            ...(existing.message || !entry.message
              ? {}
              : { message: entry.message, messageKey: findingMessageKey(entry.message) }),
          },
        });
      }
    }
  }

  private async importWorkflowGroups(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
    act: (
      existing: boolean,
      strategy: ImportStrategy,
      section: SectionReport,
    ) => 'create' | 'update' | 'skip',
  ): Promise<void> {
    const section = report.sections.workflowGroups;
    for (const entry of bundle.workflowGroups ?? []) {
      const instanceId = await this.refs.instanceId(entry.instanceBaseUrl);
      if (!instanceId) {
        section.skipped++;
        report.warnings.push(
          msg('platform.importGroupInstanceMissing', {
            name: entry.name,
            instanceUrl: entry.instanceBaseUrl,
          }),
        );
        continue;
      }

      const memberIds: string[] = [];
      for (const externalId of entry.workflowN8nIds) {
        const ref = { instanceBaseUrl: entry.instanceBaseUrl, externalId };
        const id = await this.refs.workflowId(ref);
        if (id) memberIds.push(id);
        else {
          report.warnings.push(
            WorkflowRefResolver.missing(
              msg('platform.importSubject', { kind: 'group', name: entry.name }),
              ref,
            ),
          );
        }
      }

      const existing = await this.prisma.workflowGroup.findUnique({
        where: { instanceId_name: { instanceId, name: entry.name } },
      });
      const action = act(!!existing, strategy, section);
      if (action === 'skip' || dryRun) continue;

      // set : le groupe cible reflète exactement le bundle (membres retirés inclus),
      // hormis les workflows pas encore synchronisés — d'où l'avertissement ci-dessus.
      if (action === 'create') {
        await this.prisma.workflowGroup.create({
          data: { instanceId, name: entry.name, workflows: { connect: memberIds.map((id) => ({ id })) } },
        });
      } else if (existing) {
        await this.prisma.workflowGroup.update({
          where: { id: existing.id },
          data: { workflows: { set: memberIds.map((id) => ({ id })) } },
        });
      }
    }
  }

  private async importWorkflowLinks(
    bundle: ConfigBundle,
    strategy: ImportStrategy,
    dryRun: boolean,
    report: ImportReport,
    act: (
      existing: boolean,
      strategy: ImportStrategy,
      section: SectionReport,
    ) => 'create' | 'update' | 'skip',
  ): Promise<void> {
    const section = report.sections.workflowLinks;
    for (const entry of bundle.workflowLinks ?? []) {
      const fromId = await this.refs.workflowId(entry.from);
      const toId = await this.refs.workflowId(entry.to);
      if (!fromId || !toId) {
        section.skipped++;
        report.warnings.push(
          WorkflowRefResolver.missing(
            msg('platform.importSubject', {
              kind: 'link',
              name: entry.label || msg('platform.importNoLabel'),
            }),
            fromId ? entry.to : entry.from,
          ),
        );
        continue;
      }

      const existing = await this.prisma.workflowLink.findUnique({
        where: { fromWorkflowId_toWorkflowId: { fromWorkflowId: fromId, toWorkflowId: toId } },
      });
      const action = act(!!existing, strategy, section);
      if (action === 'skip' || dryRun) continue;

      if (action === 'create') {
        await this.prisma.workflowLink.create({
          data: { fromWorkflowId: fromId, toWorkflowId: toId, label: entry.label, note: entry.note },
        });
      } else if (existing) {
        await this.prisma.workflowLink.update({
          where: { id: existing.id },
          data: { label: entry.label, note: entry.note },
        });
      }
    }
  }
}
