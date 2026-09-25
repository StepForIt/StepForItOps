import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowRef } from './config-bundle.types';

/**
 * Traduit les références portables (URL d'instance + id n8n) du bundle en ids DB
 * locaux. Un import est fait de dizaines de références qui retombent sur les mêmes
 * workflows : le cache évite autant d'allers-retours SQL.
 */
@Injectable()
export class WorkflowRefResolver {
  constructor(private readonly prisma: PrismaService) {}

  private readonly instances = new Map<string, string | null>();
  private readonly workflows = new Map<string, string | null>();

  /** À appeler entre deux imports : les ids créés par l'import précédent doivent être relus. */
  reset(): void {
    this.instances.clear();
    this.workflows.clear();
  }

  async instanceId(baseUrl: string): Promise<string | null> {
    const cached = this.instances.get(baseUrl);
    if (cached !== undefined) return cached;
    const instance = await this.prisma.instance.findFirst({ where: { baseUrl } });
    const id = instance?.id ?? null;
    this.instances.set(baseUrl, id);
    return id;
  }

  async workflowId(ref: WorkflowRef): Promise<string | null> {
    const key = `${ref.instanceBaseUrl}|${ref.externalId}`;
    const cached = this.workflows.get(key);
    if (cached !== undefined) return cached;

    const instanceId = await this.instanceId(ref.instanceBaseUrl);
    const workflow = instanceId
      ? await this.prisma.workflow.findUnique({
          where: { instanceId_externalId: { instanceId, externalId: ref.externalId } },
        })
      : null;
    const id = workflow?.id ?? null;
    this.workflows.set(key, id);
    return id;
  }

  /** Message d'avertissement homogène quand une référence ne retombe sur rien. */
  static missing(what: string, ref: WorkflowRef): string {
    return `${what} : workflow introuvable (${ref.instanceBaseUrl} / ${ref.externalId}) — synchronisez les workflows depuis n8n puis ré-importez le même fichier`;
  }
}
