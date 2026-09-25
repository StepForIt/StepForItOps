import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlatformSettingsService } from '../../infra/settings/platform-settings.service';

export interface ChecklistStep {
  key: string;
  label: string;
  /** true = fait, false = à faire, null = étape manuelle non vérifiable automatiquement. */
  done: boolean | null;
  detail?: string;
  /** Explication « à quoi ça sert » affichée en tooltip derrière le (i). */
  help?: string;
  /** Action automatisable côté UI (le monitorId cible est fourni quand il existe). */
  action?: 'create-monitor' | 'enable-monitor' | 'provision-kuma' | 'run-check';
}

export interface InstanceChecklist {
  instanceId: string;
  instanceName: string;
  monitorId?: string;
  steps: ChecklistStep[];
}

/** Marqueur des anciens workflows n8n de monitoring d'erreurs (poll de l'API depuis n8n). */
const LEGACY_ERROR_CHECK_MARKER = 'executions?status=error';

/**
 * État de la migration monitoring d'une instance : checklist affichée sur la page
 * Instances (ce qui est fait / ce qu'il reste à faire), avec actions automatisables.
 */
@Injectable()
export class MonitoringChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async forInstance(instanceId: string): Promise<InstanceChecklist> {
    const instance = await this.prisma.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundException(`Instance ${instanceId} introuvable`);

    const monitor = await this.prisma.monitor.findFirst({
      where: { kind: 'error-watch', config: { path: ['instanceId'], equals: instanceId } },
    });
    const state = (monitor?.state ?? {}) as { lastSeenExecutionId?: string };
    const workflows = await this.prisma.workflow.findMany({
      where: { instanceId, ...(await this.settings.workflowFilter()) },
      select: { name: true, raw: true },
    });
    const legacyWorkflows = workflows
      .filter((w) => JSON.stringify(w.raw).includes(LEGACY_ERROR_CHECK_MARKER))
      .map((w) => w.name);

    const steps: ChecklistStep[] = [
      {
        key: 'monitor-exists',
        label: "Monitor « erreurs d'exécution » créé pour l'instance",
        done: monitor !== null,
        detail: monitor
          ? monitor.name
          : "Surveille les exécutions en erreur via l'API n8n, sans générer d'exécution.",
        help:
          "Le monitor « erreurs d'exécution » remplace le workflow n8n qui faisait ce travail. " +
          "Toutes les 2 minutes, la plateforme demande à l'API n8n la liste des exécutions en erreur " +
          'et ne signale que celles jamais vues (curseur). Avantage sur la version workflow : ça ne crée ' +
          'aucune exécution dans n8n, donc plus de bruit quand tu debug, et la clé API reste côté plateforme.',
        action: monitor ? undefined : 'create-monitor',
      },
      {
        key: 'monitor-enabled',
        label: 'Monitor activé (check automatique toutes les 2 min)',
        done: monitor?.enabled ?? false,
        detail: monitor ? undefined : "Créer d'abord le monitor.",
        help:
          'Tant que le monitor est désactivé, rien ne tourne automatiquement : tu peux seulement lancer ' +
          'des checks à la main. On le laisse volontairement off le temps de vérifier son comportement, ' +
          "puis on l'active pour que le cron le prenne en charge.",
        action: monitor && !monitor.enabled ? 'enable-monitor' : undefined,
      },
      {
        key: 'kuma-linked',
        label: 'Sonde push Uptime Kuma rattachée',
        done: Boolean(monitor?.kumaPushUrl),
        detail: monitor?.kumaPushUrl
          ? monitor.kumaPushUrl
          : 'Créer une sonde neuve ici, ou réutiliser la sonde existante du workflow n8n : « Importer depuis Kuma » (page Monitors) puis coller son URL push dans le monitor.',
        help:
          "C'est le canal d'alerte. Le check tourne ici, mais c'est Uptime Kuma qui sait notifier " +
          '(mail, Telegram…). Une sonde « push » est un moniteur passif : elle ne va rien chercher, ' +
          "elle attend qu'on l'appelle sur son URL — ce que la plateforme fait après chaque check, " +
          'avec up/down et le détail des workflows en erreur. Elle apporte 3 choses : les notifications, ' +
          "l'historique d'uptime, et un garde-fou — si la plateforme tombe ou si le monitor est coupé, " +
          'plus personne ne pousse et Kuma passe en down tout seul. Sans elle, le check tourne quand même ' +
          "mais tu ne le vois qu'en ouvrant la page Monitors.",
        action: monitor && !monitor.kumaPushUrl ? 'provision-kuma' : undefined,
      },
      {
        key: 'baseline',
        label: "Premier check effectué (baseline du curseur d'erreurs)",
        done: Boolean(state.lastSeenExecutionId),
        detail: monitor?.lastCheckAt
          ? `Dernier check : ${monitor.lastCheckAt.toISOString()} (${monitor.lastStatus ?? '?'})`
          : undefined,
        help:
          "Le monitor mémorise l'ID de la dernière exécution en erreur qu'il a vue, et ne signale " +
          "ensuite que ce qui est plus récent — donc une erreur n'alerte qu'une fois. Le tout premier " +
          "check sert uniquement à poser ce repère : il ne déclenche pas d'alerte sur ton historique " +
          "d'erreurs passées. Tant qu'il n'a pas eu lieu, le monitor ne sait pas d'où partir.",
        action: monitor && !state.lastSeenExecutionId ? 'run-check' : undefined,
      },
      {
        key: 'legacy-removed',
        label: "Ancien workflow n8n de monitoring d'erreurs supprimé",
        done: workflows.length === 0 ? null : legacyWorkflows.length === 0,
        detail:
          workflows.length === 0
            ? "Synchronise d'abord les workflows de l'instance pour vérifier."
            : legacyWorkflows.length > 0
              ? `À supprimer dans n8n (après rodage du monitor) : ${legacyWorkflows.join(', ')} — d'après la dernière synchro.`
              : "Aucun workflow ne polle l'API des exécutions en erreur (d'après la dernière synchro).",
        help:
          'Deux surveillances en parallèle = alertes en double. Une fois le monitor rodé (compte 1 à 2 jours ' +
          "à tourner en même temps pour comparer), l'ancien workflow n8n devient inutile : le supprimer " +
          "libère aussi les exécutions qu'il générait à chaque passage. La détection se base sur le JSON " +
          "des workflows tel que synchronisé en DB — clique « Synchroniser » sur l'instance pour rafraîchir.",
      },
      {
        key: 'api-key-rotated',
        label: 'Clé API n8n régénérée (étape manuelle)',
        done: null,
        detail:
          "L'ancien workflow contenait la clé API en clair (JSON + snapshots versioning). Après sa suppression : régénérer la clé dans n8n (Settings → API) et la mettre à jour ici (page Instances → Éditer).",
        help:
          "L'ancien workflow portait la clé API n8n en clair dans les paramètres d'un nœud. Tout ce qui a lu " +
          "ce JSON la connaît : le module versioning l'a recopiée dans les snapshots GitHub / Drive, et elle " +
          "reste dans l'historique même après suppression du workflow. La régénérer est le seul moyen de " +
          "l'invalider. Étape manuelle : la plateforme ne peut pas créer de clé API via l'API n8n.",
      },
    ];

    return { instanceId, instanceName: instance.name, monitorId: monitor?.id, steps };
  }
}
