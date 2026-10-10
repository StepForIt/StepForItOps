import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CredentialCheckState } from '@prisma/client';
import {
  CredentialCheckFailedEvent,
  CredentialCheckLevel,
  CredentialCheckSchedule,
  CredentialVerdict,
  EVENTS,
  N8nWorkflow,
  classifyCredentialProbe,
  credentialAlertDecision,
  credentialCheckDue,
  credentialCheckFor,
  credentialProbeRequest,
  credentialSightings,
  hasQuotaCheck,
  msg,
} from '@nwm/core';
import { EventBusService } from '../../infra/events/event-bus.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';
import { N8nProbeService } from '../../infra/n8n-probe/n8n-probe.service';
import { buildHttpProbeWorkflow, httpProbePayload } from '../../infra/n8n-probe/probe-workflow.builder';
import { describeFailure, unwrapItem } from '../../infra/n8n-probe/probe-response';
import { InstancesService } from '../instances/instances.service';

export interface CheckableCredential {
  credentialId: string;
  type: string;
  name?: string;
  provider: string;
  /** Nombre de nœuds qui s'en servent : de quoi juger de l'importance d'une panne. */
  usedBy: number;
  /** Vrai quand un niveau « crédit » existe en plus du test d'accès. */
  quotaCheck: boolean;
  /** Dernier passage connu, test automatique ou manuel. Absent tant que rien n'a tourné. */
  last?: LastCheck;
}

export interface LastCheck {
  verdict: CredentialVerdict;
  level: CredentialCheckLevel;
  detail?: string;
  checkedAt: string;
}

export interface CredentialCheckResult {
  credentialId: string;
  type: string;
  provider: string;
  level: CredentialCheckLevel;
  verdict: CredentialVerdict;
  /** Statut HTTP du fournisseur, quand il a répondu. */
  status?: number;
  /** Ce que dit le fournisseur, tel quel. */
  detail?: string;
  checkedAt: string;
}

/**
 * Teste les credentials des fournisseurs IA d'une instance, par un workflow n8n
 * temporaire authentifié par la credential elle-même : la plateforme ne détient
 * aucun de ces secrets. La liste vient des workflows snapshotés — l'API n8n ne
 * liste pas les credentials — et le test ne vise QUE ce qu'elle y a vu : un id
 * quelconque posé par l'appelant ne devient jamais une sonde.
 */
@Injectable()
export class CredentialCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly instances: InstancesService,
    private readonly probe: N8nProbeService,
    private readonly eventBus: EventBusService,
  ) {}

  async list(instanceId: string): Promise<CheckableCredential[]> {
    return (await this.load(instanceId)).map(({ credential, state }) => ({
      ...credential,
      ...(state
        ? {
            last: {
              verdict: state.verdict as CredentialVerdict,
              level: state.level as CredentialCheckLevel,
              ...(state.detail ? { detail: state.detail } : {}),
              checkedAt: state.checkedAt.toISOString(),
            },
          }
        : {}),
    }));
  }

  /** Les tests dus à cet instant : le cron les joue un par un. */
  async due(
    instanceId: string,
    schedule: CredentialCheckSchedule,
    now = new Date(),
  ): Promise<Array<{ credentialId: string; level: CredentialCheckLevel }>> {
    const due: Array<{ credentialId: string; level: CredentialCheckLevel }> = [];
    for (const { credential, state } of await this.load(instanceId)) {
      const level = credentialCheckDue(credentialCheckFor(credential.type)!, state ?? {}, schedule, now);
      if (level) due.push({ credentialId: credential.credentialId, level });
    }
    return due;
  }

  private async load(
    instanceId: string,
  ): Promise<Array<{ credential: CheckableCredential; state: CredentialCheckState | null }>> {
    const found = new Map<string, CheckableCredential>();
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId, ...(await this.settings.workflowFilter()) },
      select: { raw: true },
    });
    for (const workflow of workflows) {
      for (const { type, id, name } of credentialSightings(workflow.raw as unknown as N8nWorkflow)) {
        const spec = credentialCheckFor(type);
        if (!spec) continue;
        const entry = found.get(id) ?? {
          credentialId: id,
          type,
          name,
          provider: spec.provider,
          usedBy: 0,
          quotaCheck: hasQuotaCheck(spec),
        };
        entry.usedBy += 1;
        found.set(id, entry);
      }
    }
    const states = new Map(
      (await this.prisma.credentialCheckState.findMany({ where: { instanceId } })).map((state) => [
        state.credentialId,
        state,
      ]),
    );
    return [...found.values()]
      .sort((a, b) => b.usedBy - a.usedBy)
      .map((credential) => ({ credential, state: states.get(credential.credentialId) ?? null }));
  }

  async check(
    instanceId: string,
    credentialId: string,
    level: CredentialCheckLevel,
  ): Promise<CredentialCheckResult> {
    if (level !== 'auth' && level !== 'quota')
      throw new BadRequestException(msg('platform.credentialCheckLevel'));
    const credential = (await this.load(instanceId)).find(
      (item) => item.credential.credentialId === credentialId,
    )?.credential;
    if (!credential) throw new NotFoundException(msg('platform.credentialCheckUnknown'));
    const spec = credentialCheckFor(credential.type)!;
    const request = credentialProbeRequest(spec, level);

    const config = await this.instances.getConfig(instanceId);
    const webhookPath = this.probe.newWebhookPath();
    const workflow = buildHttpProbeWorkflow({
      webhookPath,
      credentialType: credential.type,
      credential: { id: credential.credentialId, name: credential.name },
      label: `${spec.provider}/credential-check`,
    });

    const answer = await this.probe.run(config, workflow, webhookPath, (call) =>
      call(httpProbePayload(request)),
    );
    const { status, detail } = readAnswer(answer);
    const result: CredentialCheckResult = {
      credentialId,
      type: credential.type,
      provider: spec.provider,
      level,
      verdict: classifyCredentialProbe({ status, detail }),
      ...(status !== undefined ? { status } : {}),
      ...(detail ? { detail } : {}),
      checkedAt: new Date().toISOString(),
    };
    await this.record(instanceId, credential, result);
    return result;
  }

  /**
   * Garde le passage et décide s'il faut alerter. Test automatique ou à la main, le chemin est
   * le même : une panne vue par un humain ne doit pas être redite par le cron du lendemain.
   * Le rythme n'avance pas sur un verdict qui ne dit rien de la credential (fournisseur
   * injoignable, débit limité) : le prochain passage réessaie au lieu d'attendre une semaine.
   */
  private async record(
    instanceId: string,
    credential: CheckableCredential,
    result: CredentialCheckResult,
  ): Promise<void> {
    const where = { instanceId_credentialId: { instanceId, credentialId: credential.credentialId } };
    const previous = await this.prisma.credentialCheckState.findUnique({ where });
    const checkedAt = new Date(result.checkedAt);
    const informative = result.verdict !== 'unreachable' && result.verdict !== 'rate-limited';

    const decision = credentialAlertDecision(
      (previous?.alertedVerdict as CredentialVerdict | null) ?? null,
      result.verdict,
      result.level,
    );
    const alertedVerdict =
      decision === 'alert'
        ? result.verdict
        : decision === 'clear'
          ? null
          : (previous?.alertedVerdict ?? null);

    const data = {
      type: credential.type,
      name: credential.name ?? null,
      provider: credential.provider,
      verdict: result.verdict,
      level: result.level,
      detail: result.detail ?? null,
      checkedAt,
      alertedVerdict,
      lastAccessAt: informative ? checkedAt : (previous?.lastAccessAt ?? null),
      lastCreditAt: informative && result.level === 'quota' ? checkedAt : (previous?.lastCreditAt ?? null),
    };
    await this.prisma.credentialCheckState.upsert({
      where,
      create: { instanceId, credentialId: credential.credentialId, ...data },
      update: data,
    });

    if (decision === 'alert' && (result.verdict === 'rejected' || result.verdict === 'no-credit')) {
      const instance = await this.prisma.instance.findUnique({
        where: { id: instanceId },
        select: { name: true },
      });
      const event: CredentialCheckFailedEvent = {
        instanceId,
        instanceName: instance?.name ?? instanceId,
        credentialId: credential.credentialId,
        credentialName: credential.name ?? null,
        provider: credential.provider,
        verdict: result.verdict,
        detail: result.detail ?? null,
        occurredAt: result.checkedAt,
      };
      this.eventBus.emit(EVENTS.credentialCheckFailed, event);
    }
  }
}

/**
 * Ce que la sonde a rapporté. Le nœud HTTP répond en `fullResponse` : un refus du
 * fournisseur arrive comme un statut, un échec avant réponse (DNS, TLS, credential
 * disparue) comme un item d'erreur. On ne lit le message que d'un échec : celui d'un
 * succès n'apprend rien et pèserait dans la réponse.
 */
function readAnswer(answer: unknown): { status?: number; detail?: string } {
  const item = unwrapItem(answer);
  const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
  const status = typeof record.statusCode === 'number' ? record.statusCode : undefined;
  if (status === undefined) return { detail: describeFailure(record.error ?? item) };
  if (status >= 200 && status < 300) return { status };
  return { status, detail: providerMessage(record.body) };
}

/**
 * OpenAI, Anthropic et Mistral rangent leur message sous `error.message` : l'extracteur
 * partagé ne lit que le premier niveau et rendrait le JSON brut, illisible à l'écran.
 */
function providerMessage(body: unknown): string {
  const error =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>).error : undefined;
  const nested =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>).message : undefined;
  return typeof nested === 'string' && nested ? nested : describeFailure(body);
}
