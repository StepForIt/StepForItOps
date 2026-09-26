'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useOne } from '@refinedev/core';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  FloatButton,
  Input,
  InputNumber,
  Popover,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleTwoTone,
  SettingOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  ExportOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { apiGet, apiPatch, apiPost } from '../../../../lib/api';
import { useInstanceScope } from '../../../../lib/instance-scope';
import { Markdown } from '../../../../components/markdown';
import { MermaidView } from '../../../../components/mermaid-view';
import { RenameSuggestionsModal } from '../../../../components/rename-suggestions-modal';
import { ExecutionSamplesPanel } from '../../../../components/execution-samples-panel';
import { RemoteSchemaModal } from '../../../../components/remote-schema-modal';
import { useEnabledModules } from '../../../../lib/enabled-modules';
import { WorkflowJsonModal } from '../../../../components/workflow-json-modal';
import { PromoteModal } from './promote-modal';
import { PublishRunBanner, PublishRunView } from './publish-run';
import { EnvAssistantModal } from './env-assistant-modal';
import { MockTestModal } from './mock-test-modal';
import { TestCasesCard } from './test-cases-card';
import { EnvLinks } from './env-links';
import { GroupLinks } from './group-links';
import { GroupDuplicateModal } from '../../../../components/group-duplicate-modal';
import { WorkflowActionId, WorkflowRow } from '../../workflow-row';
import { useIsMobile } from '../../../../components/mobile/use-is-mobile';
import { useSwipeOpen } from '../../../../components/mobile/use-swipe-open';
import { ActionBar } from '../../../../components/action-bar';
import { WorkflowLockTag, useLockAction } from '../../../../components/workflow-lock';
import {
  WorkflowGraph,
  WorkflowNodes,
  countNodes,
  useWorkflowStructure,
} from '../../../../components/workflow-structure';
import { FindingsList } from '../../../../components/findings-list';
import {
  CheckSelectionModal,
  useCheckCatalog,
  useResolvedChecks,
} from '../../../../components/check-selection-modal';
import { useWorkflowChat } from '../../../../components/workflow-chat-drawer';
import { useEnvColor } from '../../../../lib/envs';
import { BRAND } from '../../../../lib/brand/colors';

interface Finding {
  id: string;
  module: string;
  severity: string;
  code: string;
  message: string;
  nodeName?: string;
  /** Détail libre de la règle : correctif proposé et position dans le code du nœud. */
  data?: {
    suggestion?: string;
    line?: number;
    snippet?: string;
    snippetStart?: number;
    autoFix?: boolean;
  } | null;
}

/** Étapes de « Vérifier », dans l'ordre où elles sont jouées. */
const VERIFY_STEPS: Array<{ key: 'structure' | 'js' | 'naming' | 'champs'; path: (id: string) => string }> = [
  { key: 'structure', path: (id) => `/verifier/run/${id}?ai=1` },
  { key: 'js', path: (id) => `/js-checker/run/${id}?ai=1` },
  { key: 'naming', path: (id) => `/optimizer/analyze/${id}` },
  { key: 'champs', path: (id) => `/field-checker/run/${id}` },
];

/** Exemple du champ de payload : des accolades, donc passé en variable au message ICU. */
const PAYLOAD_EXAMPLE = '{"orderId": 42}';

type StepStatus = 'pending' | 'running' | 'done' | 'skipped';

const stepIcon: Record<StepStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined style={{ color: BRAND.slateLight }} />,
  running: <LoadingOutlined />,
  done: <CheckCircleTwoTone twoToneColor={BRAND.success} />,
  skipped: <MinusCircleOutlined style={{ color: BRAND.slateLight }} />,
};

interface CurrentEnv {
  env: string | null;
  mixed: boolean;
  counts: Record<string, number>;
}

/** Le temps gagné retenu pour le ROI et l'estimation qui le remplit par défaut. */
interface TimeSavedView {
  minutes: number | null;
  estimated: boolean;
  estimate: { minutes: number; why: string | null; source: string | null } | null;
}

/** Coût IA du workflow (miroir de workflowSummary côté module ai-cost). */
interface AiCost {
  days: number;
  costUsd: number;
  calls: number;
  executions: number;
  unpricedCalls: number;
}

export default function WorkflowShow() {
  const t = useTranslations('workflowShow.page');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const mobile = useIsMobile();
  const envColor = useEnvColor();
  const params = useParams<{ id: string }>();
  const workflowId = params.id;
  // Le schéma et l'inventaire ne se chargent qu'à l'ouverture de leur onglet : la
  // fiche s'affiche sans attendre un schéma qu'on ne regarde pas à chaque visite.
  // `?tab=` ouvre directement un onglet : c'est ce que vise un lien vers l'ancienne
  // page de vue, et ce qu'on partage quand on veut montrer un schéma.
  const requestedTab = useSearchParams().get('tab');
  const [tab, setTab] = React.useState(requestedTab ?? 'graph');
  const structure = useWorkflowStructure(workflowId, tab === 'graph' || tab === 'nodes');
  // La doc se lit en ouvrant son onglet : « Voir doc » était un bouton pour
  // aller chercher ce que l'onglet montre déjà.
  const docTabOpened = React.useRef(false);
  React.useEffect(() => {
    if (tab !== 'doc' || docTabOpened.current) return;
    docTabOpened.current = true;
    void loadDoc();
    // `loadDoc` se refait à chaque rendu ; c'est l'ouverture de l'onglet qui compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const { data, isLoading, refetch } = useOne({ resource: 'workflows', id: workflowId });
  const workflow = data?.data as WorkflowRow | undefined;
  /**
   * Un bouton n'est proposé que si la plateforme du workflow le permet. Le calcul
   * vient de l'API (`workflow.actions`) : le web ne connaît pas les plateformes,
   * et deux tables de vérité divergeraient au premier module porté. Tant que la
   * fiche charge, on suppose disponible — sinon la barre clignote au chargement.
   */
  const can = (action: WorkflowActionId): boolean => workflow?.actions?.[action]?.available !== false;
  const unavailable = Object.entries(workflow?.actions ?? {})
    .filter(([, state]) => !state.available)
    .map(([, state]) => state.why)
    .filter((why): why is string => Boolean(why));

  const [findings, setFindings] = useState<Finding[]>([]);
  const [doc, setDoc] = useState<{ mermaid: string; summary?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  /** Env visé par l'assistant quand on l'ouvre depuis un onglet encore vide. */
  const [copyToEnv, setCopyToEnv] = useState<string | null>(null);
  const [mockModalOpen, setMockModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [testPayload, setTestPayload] = useState('{}');
  const [currentEnv, setCurrentEnv] = useState<CurrentEnv | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string | undefined>();
  const [severityFilter, setSeverityFilter] = useState<string | undefined>();
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const { enabled: enabledModules } = useEnabledModules();
  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [publishRun, setPublishRun] = useState<PublishRunView | null>(null);
  // Duplication du groupe auquel appartient ce workflow : le geste part d'ici, là
  // où l'on se pose la question de l'env, et non d'une page qu'il faut connaître.
  const [groupDuplicateId, setGroupDuplicateId] = useState<string | null>(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [minutesSaved, setMinutesSaved] = useState<number | null>(null);
  /** L'estimation qui sert tant que personne n'a saisi son chiffre (cf. `time-saved.ts`). */
  const [timeSavedEstimate, setTimeSavedEstimate] = useState<TimeSavedView['estimate']>(null);
  const [estimating, setEstimating] = useState(false);
  /** Avancement de « Vérifier » : une analyse dure des dizaines de secondes, sans cela l'écran est muet. */
  const [verifyProgress, setVerifyProgress] = useState<Record<string, StepStatus> | null>(null);
  const [checksModalOpen, setChecksModalOpen] = useState(false);
  const checkCatalog = useCheckCatalog();
  const { resolved: checks, reload: reloadChecks } = useResolvedChecks(workflowId);
  const lockAction = useLockAction(workflowId);
  const { instanceName } = useInstanceScope();
  const chat = useWorkflowChat();

  useEffect(() => {
    setMinutesSaved(
      (workflow as { minutesSavedPerExecution?: number | null } | undefined)?.minutesSavedPerExecution ??
        null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.name]);

  useEffect(() => {
    apiGet<TimeSavedView>(`/workflows/${workflowId}/time-saved`)
      .then((view) => setTimeSavedEstimate(view.estimate))
      .catch(() => setTimeSavedEstimate(null));
  }, [workflowId]);

  const saveMinutesSaved = async () => {
    try {
      await apiPatch(`/workflows/${workflowId}/time-saved`, { minutes: minutesSaved });
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  /** Réestime CE workflow — affiné par l'IA quand elle est configurée, la règle sinon. */
  const reestimate = async () => {
    setEstimating(true);
    try {
      const view = await apiPost<TimeSavedView>(`/workflows/${workflowId}/time-saved/estimate`);
      setTimeSavedEstimate(view.estimate);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setEstimating(false);
    }
  };

  const [aiCost, setAiCost] = useState<AiCost | null>(null);
  useEffect(() => {
    apiGet<AiCost | null>(`/ai-cost/workflow/${workflowId}?days=30`)
      .then(setAiCost)
      .catch(() => setAiCost(null)); // module désactivé
  }, [workflowId]);

  const loadCurrentEnv = React.useCallback(() => {
    apiGet<CurrentEnv>(`/env-switcher/current-env/${workflowId}`)
      .then(setCurrentEnv)
      .catch(() => setCurrentEnv(null)); // module désactivé ou pas de mapping
  }, [workflowId]);

  useEffect(loadCurrentEnv, [loadCurrentEnv]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Lance TOUTES les vérifications (un module désactivé est simplement sauté).
   * `selection` : contrôles décochés dans la modale et pas encore enregistrés —
   * absente, l'API applique le profil du workflow. Les quatre étapes sont jouées
   * même quand tous leurs contrôles sont décochés : c'est ce passage qui efface
   * les findings d'un contrôle qu'on vient de retirer. Le coût, lui, est évité
   * côté API (ni appel IA ni échantillonnage d'exécutions).
   */
  const verifyAll = (selection?: string[]) =>
    run('verify', async () => {
      // `undefined` tant que rien n'est chargé ni choisi : le corps est alors omis
      // et c'est l'API qui résout le profil — un `[]` envoyé à sa place vaudrait
      // « tous les contrôles » et écraserait la configuration enregistrée.
      const disabled = selection ?? checks?.disabled;
      const skipped: string[] = [];
      setVerifyProgress(Object.fromEntries(VERIFY_STEPS.map((s) => [s.key, 'pending' as StepStatus])));
      for (const step of VERIFY_STEPS) {
        setVerifyProgress((p) => ({ ...p, [step.key]: 'running' }));
        try {
          await apiPost(step.path(workflowId), disabled ? { disabled } : undefined);
          setVerifyProgress((p) => ({ ...p, [step.key]: 'done' }));
        } catch {
          skipped.push(step.key);
          setVerifyProgress((p) => ({ ...p, [step.key]: 'skipped' }));
        }
      }
      const all = await apiGet<Finding[]>(`/findings?workflowId=${workflowId}&_start=0&_end=500`);
      setFindings(all);
      message.success(
        skipped.length
          ? t('verifyDoneSkipped', { count: all.length, modules: skipped.join(', ') })
          : t('verifyDone', { count: all.length }),
      );
    });

  /**
   * Recharge la liste depuis la base (après « Ignorer », et au chargement de la page :
   * les findings d'une analyse passée s'affichent sans avoir à tout rejouer).
   */
  const reloadFindings = React.useCallback(
    () =>
      apiGet<Finding[]>(`/findings?workflowId=${workflowId}&_start=0&_end=500`)
        .then(setFindings)
        .catch((error) => message.error((error as Error).message)),
    [workflowId],
  );

  useEffect(() => {
    reloadFindings();
  }, [reloadFindings]);

  /** Après renommage : relance l'analyse naming et recharge les findings. */
  const afterRenames = () =>
    run('verify', async () => {
      // L'échec était avalé : les findings se rechargeaient tels quels et l'on
      // croyait que le renommage n'avait rien changé, alors que l'analyse
      // n'avait simplement pas été relancée.
      await apiPost(`/optimizer/analyze/${workflowId}`).catch((error: unknown) =>
        message.error(t('analysisNotRerun', { error: (error as Error).message })),
      );
      const all = await apiGet<Finding[]>(`/findings?workflowId=${workflowId}&_start=0&_end=500`);
      setFindings(all);
    });

  const generateDoc = () =>
    run('doc', async () => {
      const result = await apiPost<{ mermaid: string; summary?: string }>(
        `/doc-schema/generate/${workflowId}?ai=1`,
      );
      setDoc(result);
      message.success(t('docGenerated'));
    });

  const loadDoc = () =>
    run('doc-load', async () => {
      const result = await apiGet<{ mermaid: string; summary?: string } | null>(`/doc-schema/${workflowId}`);
      if (result) setDoc(result);
      else message.info(t('noDocYet'));
    });

  const openAssistant = React.useCallback(
    () =>
      chat.open({
        workflowId,
        workflowName: workflow?.name,
        onWorkflowChanged: () => {
          refetch();
          reloadFindings();
        },
      }),
    // `reloadFindings` et `refetch` sont stables pour ce qui nous concerne ici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, workflowId, workflow?.name],
  );

  // Sur mobile, l'assistant s'ouvre aussi d'un glissé vers la gauche : le tiroir
  // vient de ce bord, le geste le tire.
  useSwipeOpen(openAssistant, mobile && can('assistant'));

  /** Repull depuis n8n : la copie locale ne bouge sinon qu'au cron horaire. */
  const resync = () =>
    run('resync', async () => {
      const result = await apiPost<{ name: string; changed: boolean; missing: boolean }>(
        `/workflows/${workflowId}/resync`,
      );
      await refetch();
      if (result.missing) message.warning(t('resyncMissing'));
      else message.success(result.changed ? t('resyncUpdated') : t('upToDate'));
    });

  /**
   * Publie le workflow. Geste à part et jamais automatique — publier, c'est mettre
   * en production. Mais c'est aussi le seul moyen de rouvrir un workflow que n8n
   * renvoie vers « Nouveau workflow » faute de version publiée.
   */
  const publishWorkflow = () =>
    run('publish', async () => {
      const result = await apiPost<{ alreadyPublished: boolean }>(`/workflows/${workflowId}/publish`);
      await refetch();
      message.success(result.alreadyPublished ? t('alreadyPublished') : t('published'));
    });

  const testWebhook = () =>
    run('test', async () => {
      const payload = JSON.parse(testPayload || '{}');
      const result = await apiPost<{ status: string }>(`/tester/webhook/${workflowId}`, payload);
      message.success(t('testDone', { status: result.status }));
    });

  return (
    <div style={{ padding: 8 }}>
      <Card
        loading={isLoading}
        // Sans quoi un nom long garde sa ligne et pousse la page hors de l'écran.
        styles={{ title: { whiteSpace: 'normal' } }}
        // Recharger la fiche depuis n8n est le geste d'un rafraîchissement de
        // navigateur : une icône au coin, pas une entrée de menu.
        extra={
          <Space size={4}>
            {can('assistant') && (
              <Tooltip title={t('assistantTooltip')}>
                <Button
                  type="text"
                  icon={<RobotOutlined />}
                  aria-label={t('assistant')}
                  onClick={openAssistant}
                />
              </Tooltip>
            )}
            <Tooltip title={t('reload')}>
              <Button
                type="text"
                icon={<ReloadOutlined />}
                loading={busy === 'resync'}
                aria-label={t('reload')}
                onClick={resync}
              />
            </Tooltip>
          </Space>
        }
        title={
          <Space wrap>
            {workflow?.name}
            {workflow?.instanceId && <Tag color="blue">{instanceName(workflow.instanceId)}</Tag>}
            {workflow?.active ? <Tag color="green">{t('active')}</Tag> : <Tag>{t('inactive')}</Tag>}
            <WorkflowLockTag workflowId={workflowId} />
            {/* Posée par la promotion, jamais par une édition : c'est la mise en
                production qui fait la version, pas le fait d'avoir touché au workflow. */}
            {(workflow as { version?: string | null } | undefined)?.version && (
              <Tooltip title={t('versionTooltip')}>
                <Tag color="purple">
                  {t('version', { version: (workflow as { version?: string }).version ?? '' })}
                </Tag>
              </Tooltip>
            )}
            {currentEnv?.env && (
              <Tag color={currentEnv.mixed ? 'volcano' : envColor(currentEnv.env)}>
                {currentEnv.mixed
                  ? t('pluggedMixed', { env: currentEnv.env })
                  : t('plugged', { env: currentEnv.env })}
              </Tag>
            )}
          </Space>
        }
      >
        <Descriptions size="small" column={mobile ? 1 : 2}>
          {aiCost && aiCost.calls > 0 && (
            <Descriptions.Item label={t('aiCostLabel', { days: aiCost.days })}>
              <Link href="/llm-costs">
                <Tooltip
                  title={
                    aiCost.unpricedCalls > 0
                      ? t('aiCostTooltipUnpriced', {
                          calls: aiCost.calls,
                          executions: aiCost.executions,
                          unpriced: aiCost.unpricedCalls,
                        })
                      : t('aiCostTooltip', { calls: aiCost.calls, executions: aiCost.executions })
                  }
                >
                  <span>
                    {aiCost.unpricedCalls > 0 ? '≥ ' : ''}
                    {aiCost.costUsd.toLocaleString(locale, {
                      minimumFractionDigits: aiCost.costUsd >= 1 ? 2 : 4,
                      maximumFractionDigits: aiCost.costUsd >= 1 ? 2 : 4,
                    })}{' '}
                    $
                  </span>
                </Tooltip>
              </Link>
            </Descriptions.Item>
          )}
        </Descriptions>
        {/* Un RÉGLAGE, pas une mesure : affiché en petit, édité au clic. En champ
            ouvert dans la fiche, il se lisait comme un temps réellement mesuré. */}
        <Popover
          trigger="click"
          title={t('timeSaved.title')}
          content={
            <Space direction="vertical" size={8} style={{ maxWidth: 260 }}>
              <InputNumber
                autoFocus
                min={0}
                step={0.5}
                placeholder={
                  timeSavedEstimate ? t('timeSaved.placeholder', { minutes: timeSavedEstimate.minutes }) : '—'
                }
                value={minutesSaved}
                onChange={(value) => setMinutesSaved(value)}
                onBlur={saveMinutesSaved}
                addonAfter={t('timeSaved.addon')}
                style={{ width: '100%' }}
              />
              <Space size={4}>
                <Button size="small" type="link" loading={estimating} onClick={reestimate}>
                  {t('timeSaved.reestimate')}
                </Button>
                {timeSavedEstimate?.why && (
                  <Tooltip title={timeSavedEstimate.why}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('timeSaved.why')}
                    </Typography.Text>
                  </Tooltip>
                )}
              </Space>
            </Space>
          }
        >
          <Typography.Link style={{ fontSize: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('timeSaved.label')}{' '}
            </Typography.Text>
            {minutesSaved != null
              ? t('timeSaved.value', { minutes: minutesSaved })
              : timeSavedEstimate
                ? t('timeSaved.estimatedValue', { minutes: timeSavedEstimate.minutes })
                : t('timeSaved.toFill')}
          </Typography.Link>
        </Popover>
        <PublishRunBanner workflowId={workflowId} pushed={publishRun} />
        {workflow && (
          <EnvLinks
            workflow={workflow}
            onCopyTo={(envId) => {
              setCopyToEnv(envId);
              setEnvModalOpen(true);
            }}
          />
        )}
        {workflow && <GroupLinks workflow={workflow} />}
        {/* Quatre actions sous la main, le reste dans « ⋯ » : alignées, les treize
            ne hiérarchisaient plus rien — sur téléphone comme sur grand écran. */}
        <div style={{ marginTop: 16 }}>
          <ActionBar
            collapse="always"
            primary={
              <>
                <Button type="primary" loading={busy === 'verify'} onClick={() => verifyAll()}>
                  {t('actions.verify')}
                </Button>
                {workflow?.n8nUrl && (
                  <Button
                    icon={<ExportOutlined />}
                    href={workflow.n8nUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {tCommon('openInN8n')}
                  </Button>
                )}
              </>
            }
            actions={[
              // Proposé seulement quand il y a quelque chose à publier. Un workflow sans
              // version publiée n'est pas perdu : l'éditeur n8n ouvre la version publiée,
              // et sans elle il renvoie vers « Nouveau workflow ».
              ...(can('publish') && workflow?.published === false
                ? [
                    {
                      key: 'publish',
                      label: t('actions.publish'),
                      hint: t('actions.publishHint'),
                      danger: true,
                      loading: busy === 'publish',
                      onClick: publishWorkflow,
                    },
                  ]
                : []),
              {
                key: 'checks',
                label:
                  checkCatalog && checks && checks.disabled.length > 0
                    ? t('actions.checksCount', {
                        enabled: checkCatalog.checks.length - checks.disabled.length,
                        total: checkCatalog.checks.length,
                      })
                    : t('actions.checks'),
                icon: <SettingOutlined />,
                hint: checks?.source
                  ? t('actions.checksHintInherited', { source: checks.source.label })
                  : t('actions.checksHint'),
                onClick: () => setChecksModalOpen(true),
              },
              ...(can('remoteSchema') && (!enabledModules || enabledModules.includes('remote-schema'))
                ? [
                    {
                      key: 'remote',
                      label: t('actions.remote'),
                      hint: t('actions.remoteHint'),
                      onClick: () => setRemoteModalOpen(true),
                    },
                  ]
                : []),
              ...(can('naming')
                ? [{ key: 'naming', label: t('actions.naming'), onClick: () => setRenameModalOpen(true) }]
                : []),
              ...(can('envSwitch')
                ? [{ key: 'envs', label: t('actions.envs'), onClick: () => setEnvModalOpen(true) }]
                : []),
              ...(can('export')
                ? [
                    {
                      key: 'json',
                      label: 'JSON',
                      icon: <CodeOutlined />,
                      onClick: () => setJsonModalOpen(true),
                    },
                  ]
                : []),
              lockAction.action,
            ]}
          />
          {lockAction.modal}
        </div>
        {unavailable.length > 0 && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            <Tooltip title={unavailable.join(' ')}>
              <span style={{ textDecoration: 'underline dotted', cursor: 'help' }}>
                {t('unavailable', { count: unavailable.length })}
              </span>
            </Tooltip>
          </Typography.Paragraph>
        )}
        {verifyProgress && (
          <Space wrap size="large" style={{ marginTop: 12 }}>
            {VERIFY_STEPS.map((step) => {
              const status = verifyProgress[step.key] ?? 'pending';
              return (
                <Space key={step.key} size={6}>
                  {stepIcon[status]}
                  <span
                    style={{ color: status === 'pending' || status === 'skipped' ? BRAND.slate : undefined }}
                  >
                    {status === 'skipped'
                      ? t('stepSkipped', { label: t(`verifySteps.${step.key}`) })
                      : t(`verifySteps.${step.key}`)}
                  </span>
                </Space>
              );
            })}
          </Space>
        )}
      </Card>

      {/* Bouton flottant : sur mobile, l'icône du coin est loin du pouce une fois
          la page défilée, et un geste seul ne s'apprend pas tout seul. */}
      {mobile && can('assistant') && (
        <FloatButton
          icon={<RobotOutlined />}
          type="primary"
          tooltip={t('assistant')}
          onClick={openAssistant}
        />
      )}
      <Tabs
        style={{ marginTop: 16 }}
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'graph',
            label: t('tabs.graph'),
            children: structure.error ? (
              <Alert type="error" showIcon message={structure.error} />
            ) : structure.view ? (
              <WorkflowGraph view={structure.view} />
            ) : (
              <Skeleton active />
            ),
          },
          {
            key: 'nodes',
            label: structure.view
              ? t('tabs.nodesCount', { count: countNodes(structure.view) })
              : t('tabs.nodes'),
            children: structure.view ? <WorkflowNodes view={structure.view} /> : <Skeleton active />,
          },
          ...(can('fields')
            ? [
                {
                  key: 'samples',
                  label: t('tabs.samples'),
                  children: <ExecutionSamplesPanel workflowId={workflowId} active={tab === 'samples'} />,
                },
              ]
            : []),
          {
            key: 'findings',
            label: t('tabs.findings', { count: findings.length }),
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Select
                    allowClear
                    placeholder={t('filters.module')}
                    style={{ width: mobile ? '100%' : 180 }}
                    value={moduleFilter}
                    onChange={setModuleFilter}
                    options={[
                      { value: 'verifier', label: t('filters.structure') },
                      { value: 'js-checker', label: t('filters.js') },
                      { value: 'optimizer', label: t('filters.naming') },
                      { value: 'field-checker', label: t('filters.fields') },
                      { value: 'remote-schema', label: t('filters.remote') },
                    ]}
                  />
                  <Select
                    allowClear
                    placeholder={t('filters.severity')}
                    style={{ width: mobile ? '100%' : 150 }}
                    value={severityFilter}
                    onChange={setSeverityFilter}
                    options={['error', 'warning', 'info'].map((s) => ({ value: s, label: s }))}
                  />
                </Space>
                <FindingsList
                  findings={findings
                    .filter(
                      (f) =>
                        (!moduleFilter || f.module === moduleFilter) &&
                        (!severityFilter || f.severity === severityFilter),
                    )
                    .map((f) => ({
                      ...f,
                      suggestion: f.data?.suggestion ?? null,
                      line: f.data?.line ?? null,
                      snippet: f.data?.snippet ?? null,
                      snippetStart: f.data?.snippetStart ?? null,
                      autoFix: f.data?.autoFix === true,
                    }))}
                  onChanged={reloadFindings}
                />
              </>
            ),
          },
          {
            key: 'doc',
            label: t('tabs.doc'),
            children: doc ? (
              <div>
                <Space style={{ marginBottom: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('doc.saved')}
                  </Typography.Text>
                  {can('doc') && (
                    <Button size="small" type="link" loading={busy === 'doc'} onClick={generateDoc}>
                      {t('doc.regenerate')}
                    </Button>
                  )}
                </Space>
                {doc.summary && (
                  <Card size="small" style={{ marginBottom: 16 }}>
                    <Markdown content={doc.summary} />
                  </Card>
                )}
                <MermaidView code={doc.mermaid} />
              </div>
            ) : busy === 'doc-load' ? (
              <Skeleton active />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('doc.empty')}>
                {can('doc') && (
                  <Button type="primary" loading={busy === 'doc'} onClick={generateDoc}>
                    {t('doc.generate')}
                  </Button>
                )}
              </Empty>
            ),
          },
          {
            key: 'test',
            label: t('tabs.test'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.TextArea
                  rows={6}
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  placeholder={t('test.payloadPlaceholder', { example: PAYLOAD_EXAMPLE })}
                />
                <Space wrap>
                  <Button type="primary" loading={busy === 'test'} onClick={testWebhook}>
                    {t('test.trigger')}
                  </Button>
                  {can('test') && (
                    <Tooltip title={t('test.mockTooltip')}>
                      <Button onClick={() => setMockModalOpen(true)}>{t('test.mock')}</Button>
                    </Tooltip>
                  )}
                </Space>
                <TestCasesCard workflowId={workflowId} />
              </Space>
            ),
          },
        ]}
      />

      <CheckSelectionModal
        workflowId={workflowId}
        open={checksModalOpen}
        onClose={() => setChecksModalOpen(false)}
        onRun={(disabled) => verifyAll(disabled)}
        onSaved={reloadChecks}
      />

      <RenameSuggestionsModal
        workflowId={workflowId}
        open={renameModalOpen}
        onClose={() => setRenameModalOpen(false)}
        onApplied={afterRenames}
      />

      <RemoteSchemaModal
        workflowId={workflowId}
        open={remoteModalOpen}
        onClose={() => setRemoteModalOpen(false)}
        onChecked={reloadFindings}
      />

      <WorkflowJsonModal
        workflowId={workflowId}
        open={jsonModalOpen}
        onClose={() => setJsonModalOpen(false)}
      />

      <PromoteModal
        workflowId={workflowId}
        sourceInstanceId={workflow?.instanceId}
        open={promoteModalOpen}
        onClose={() => setPromoteModalOpen(false)}
        onPublication={setPublishRun}
      />

      <MockTestModal
        workflowId={workflowId}
        n8nUrl={workflow?.n8nUrl}
        open={mockModalOpen}
        onClose={() => setMockModalOpen(false)}
      />

      <EnvAssistantModal
        workflowId={workflowId}
        workflowName={workflow?.name}
        active={workflow?.active}
        tags={workflow?.tags}
        open={envModalOpen}
        startCopyTo={copyToEnv}
        onClose={() => {
          setEnvModalOpen(false);
          setCopyToEnv(null);
        }}
        onDone={loadCurrentEnv}
        groups={workflow?.groups}
        onPromote={() => setPromoteModalOpen(true)}
        onGroupDuplicate={setGroupDuplicateId}
      />
      {groupDuplicateId && (
        <GroupDuplicateModal
          groupId={groupDuplicateId}
          groupName={
            (workflow?.groups ?? []).find((group) => group.id === groupDuplicateId)?.name ?? t('thisGroup')
          }
          open
          onClose={() => setGroupDuplicateId(null)}
        />
      )}
    </div>
  );
}
