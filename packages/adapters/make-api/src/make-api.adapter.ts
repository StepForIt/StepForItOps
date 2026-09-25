import {
  MAKE_CAPABILITIES,
  MakeApiError,
  MakeBlueprintResponse,
  MakeScenario,
  PlatformCapabilities,
  PlatformExecution,
  PlatformExecutionsPage,
  PlatformInstanceConfig,
  PlatformWorkflow,
  PlatformWorkflowSummary,
  WorkflowPlatformPort,
  readBlueprint,
  toExecutionStatus,
  toExecutionStatusFromLabel,
  toScenarioUpdate,
  toWorkflow,
  toWorkflowSummary,
} from '@nwm/core';
import { MakeHttp, paginate } from './make-http';

interface ScenariosResponse {
  scenarios: MakeScenario[];
}
interface ScenarioResponse {
  scenario: MakeScenario;
}
interface ScenarioLogsResponse {
  scenarioLogs: Array<{
    imtId?: string;
    id?: string;
    status?: number;
    timestamp?: string;
    duration?: number;
    operations?: number;
    transfer?: number;
  }>;
}

/** Make vu par le port commun. */
export class MakeApiAdapter implements WorkflowPlatformPort {
  readonly platform = 'make' as const;

  constructor(private readonly http: MakeHttp = new MakeHttp()) {}

  capabilities(): PlatformCapabilities {
    return MAKE_CAPABILITIES;
  }

  /**
   * Le listing ne rend PAS le contenu : `raw` reste vide, et c'est déclaré par
   * `listIncludesContent: false`. Le miroir s'en sert pour ne redemander le
   * blueprint que des scénarios dont `changedAt` a bougé — sous 30 appels par
   * minute, tout retélécharger coûterait plus cher que la resynchro entière.
   *
   * Les LABELS ne sont volontairement pas récoltés ici : Make ne les rend pas
   * avec le scénario, et il faudrait un appel par label
   * (`/scenario-labels/{id}/scenarios`) pour reconstituer l'association. Le
   * dossier, lui, est dans le listing et ne coûte rien. Un parc étiqueté par
   * labels demandera un appel de plus, à faire une fois pour tout le parc.
   */
  async listWorkflows(instance: PlatformInstanceConfig): Promise<PlatformWorkflowSummary[]> {
    const scope = scopeQuery(instance);
    const scenarios = await paginate((offset, limit) =>
      this.http
        .get<ScenariosResponse>(instance, `/scenarios?${scope}&pg[offset]=${offset}&pg[limit]=${limit}`)
        .then((r) => r.scenarios ?? []),
    );
    return scenarios.map((scenario) => toWorkflowSummary(scenario));
  }

  async getWorkflow(instance: PlatformInstanceConfig, externalId: string): Promise<PlatformWorkflow> {
    const { scenario } = await this.http.get<ScenarioResponse>(instance, `/scenarios/${externalId}`);
    const blueprint = await this.http.get<MakeBlueprintResponse>(
      instance,
      `/scenarios/${externalId}/blueprint`,
    );
    return toWorkflow(scenario, readBlueprint(blueprint));
  }

  /**
   * Sans `confirmed=true`, et c'est voulu : ce paramètre autorise Make à INSTALLER
   * dans l'organisation une app que le blueprint emploie pour la première fois.
   * Une vieille version peut ramener une app retirée depuis, et l'installer en
   * silence chez un client serait un effet que personne n'a relu. Make refuse
   * alors la mise à jour et le scénario reste tel quel.
   */
  async updateWorkflow(instance: PlatformInstanceConfig, externalId: string, raw: unknown): Promise<void> {
    await this.http.request(instance, 'PATCH', `/scenarios/${externalId}`, toScenarioUpdate(raw));
  }

  async setActive(instance: PlatformInstanceConfig, externalId: string, active: boolean): Promise<void> {
    await this.http.request(instance, 'POST', `/scenarios/${externalId}/${active ? 'start' : 'stop'}`);
  }

  async deleteWorkflow(instance: PlatformInstanceConfig, externalId: string): Promise<void> {
    await this.http.request(instance, 'DELETE', `/scenarios/${externalId}`);
  }

  /**
   * Make n'a pas de listing global : les logs sont PAR scénario. C'est déclaré
   * (`executionListing: 'per-workflow'`) et refusé explicitement ici — répondre
   * une liste vide ferait croire à un parc sans erreur.
   *
   * Ce que le listing donne, en revanche, il le donne d'un coup : durée,
   * opérations et transfert sont dans la ligne, là où n8n impose un appel par
   * exécution.
   */
  async listExecutions(
    instance: PlatformInstanceConfig,
    opts?: { workflowExternalId?: string; cursor?: string; limit?: number },
  ): Promise<PlatformExecutionsPage> {
    const scenarioId = opts?.workflowExternalId;
    if (!scenarioId) {
      throw new Error(
        'Make ne liste les exécutions que scénario par scénario : préciser `workflowExternalId`.',
      );
    }
    const limit = opts?.limit ?? 100;
    const page = await this.http.get<ScenarioLogsResponse>(
      instance,
      `/scenarios/${scenarioId}/logs?pg[limit]=${limit}`,
    );
    return {
      executions: (page.scenarioLogs ?? []).map((log) => ({
        externalId: log.imtId ?? log.id ?? '',
        workflowExternalId: scenarioId,
        status: toExecutionStatus(log.status),
        startedAt: log.timestamp,
        stoppedAt:
          log.timestamp && typeof log.duration === 'number'
            ? new Date(new Date(log.timestamp).getTime() + log.duration).toISOString()
            : undefined,
        ...(typeof log.duration === 'number' ? { durationMs: log.duration } : {}),
      })),
    };
  }

  /**
   * Le détail d'une exécution. C'est la seule route qui donne le MESSAGE d'une
   * erreur et le module fautif — le listing des logs ne rend qu'un statut
   * numérique. Elle ne rend en revanche jamais les bundles : chez Make, seules
   * les exécutions incomplètes en gardent (`/dlqs/:id/bundle`).
   */
  async getExecution(
    instance: PlatformInstanceConfig,
    opts: { workflowExternalId: string; executionExternalId: string },
  ): Promise<PlatformExecution | null> {
    try {
      const detail = await this.http.get<MakeExecutionDetail>(
        instance,
        `/scenarios/${opts.workflowExternalId}/executions/${opts.executionExternalId}`,
      );
      return {
        externalId: opts.executionExternalId,
        workflowExternalId: opts.workflowExternalId,
        status: toExecutionStatusFromLabel(detail.status),
        ...(detail.error
          ? {
              error: {
                message: detail.error.message ?? detail.error.name ?? 'Erreur sans message',
                ...(detail.error.causeModule?.name ? { nodeName: detail.error.causeModule.name } : {}),
              },
            }
          : {}),
      };
    } catch (error) {
      // Purgée ou hors périmètre : le détail ne viendra jamais. Le dire par
      // `null` évite que l'appelant réessaie à chaque passe.
      if (error instanceof MakeApiError && (error.status === 404 || error.status === 403)) return null;
      throw error;
    }
  }
}

interface MakeExecutionDetail {
  status?: string;
  error?: { name?: string; message?: string; causeModule?: { name?: string; appName?: string } };
}

/**
 * `GET /scenarios` exige `teamId` ou `organizationId` — sans l'un des deux il
 * répond 400. Le dire ici, en clair, évite que ce refus remonte comme une panne
 * d'API alors qu'il ne manque qu'un réglage d'instance.
 */
function scopeQuery(instance: PlatformInstanceConfig): string {
  if (instance.teamId) return `teamId=${encodeURIComponent(instance.teamId)}`;
  if (instance.orgId) return `organizationId=${encodeURIComponent(instance.orgId)}`;
  throw new Error("Instance Make sans périmètre : renseigner l'id de team ou d'organisation.");
}

export { MakeApiError };
