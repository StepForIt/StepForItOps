'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Checkbox, Modal, Radio, Select, Space, Tag, message } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../lib/api';
import { useEnvLabel, useEnvs } from '../../../../lib/envs';
import { usePromoteDefaults } from './promote-defaults';
import { SwitchedResource, SwitchedResources } from '../../../../components/switched-resources';
import { BRAND } from '../../../../lib/brand/colors';

/**
 * Les gestes possibles autour des environnements. Ils ne se distinguent pas par
 * leur mécanique (tous finissent en remplacement d'ids) mais par ce qu'ils
 * TOUCHENT : l'existant, une copie, l'étiquette, une autre instance — ou tout le
 * domaine auquel ce workflow appartient.
 */
type Intent = 'switch' | 'copy' | 'mark' | 'promote' | 'group';

interface SwitchPlan {
  hits: Array<{ path: string; from: string; to: string }>;
  switched?: SwitchedResource[];
  unmapped: Array<{ key: string; provider: string; label?: string; nodes: string[] }>;
}

/** Un nœud qui SORT du système, tel que le voit le module tester. */
interface MockCandidate {
  nodeName: string;
  reason: string;
  suggested: boolean;
}

/**
 * Le nom sans son suffixe d'env — recopié du domaine, qui ne franchit pas la
 * frontière du web (`@nwm/core` n'est pas une dépendance du front).
 */
function withoutEnvSuffix(name: string, envs: Array<{ id: string }>): string {
  const ids = envs
    .map((env) => env.id)
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
  if (ids.length === 0) return name.trim();
  return name
    .replace(new RegExp(`[\\s\\-_[(](${ids.join('|')})[\\])\\s]*$`, 'i'), '')
    .trim()
    .replace(/[\s\-_[(]+$/, '')
    .trim();
}

export function EnvAssistantModal({
  workflowId,
  workflowName,
  active,
  tags,
  groups,
  open,
  onClose,
  onDone,
  onPromote,
  onGroupDuplicate,
  startCopyTo,
}: {
  workflowId: string;
  workflowName?: string;
  active?: boolean;
  tags?: string[];
  /** Groupes métier du workflow : ce qui rend le geste « tout le domaine » possible. */
  groups?: Array<{ id: string; name: string }>;
  open: boolean;
  onClose: () => void;
  /** Quelque chose a changé côté n8n : la page se recharge. */
  onDone: () => void;
  /** La promotion a son propre assistant (gates, diff) : on lui passe la main. */
  onPromote: () => void;
  /** La duplication de groupe a le sien (impact par membre) : idem. */
  onGroupDuplicate: (groupId: string) => void;
  /**
   * Env visé d'emblée, avec l'intention « copier » : c'est l'onglet d'un env où ce
   * workflow n'existe pas encore. Sans lui, l'assistant rouvre sur son menu et
   * redemande ce qu'on venait déjà de désigner.
   */
  startCopyTo?: string | null;
}) {
  const t = useTranslations('workflowShow.envAssistant');
  const tCommon = useTranslations('common');
  const { envs } = useEnvs();
  const envLabel = useEnvLabel();
  const promoteDefaults = usePromoteDefaults(workflowId, open);
  const [intent, setIntent] = useState<Intent | null>(null);
  // Le premier env déclaré : c'est là qu'on travaille, donc la cible la plus probable.
  const [targetEnv, setTargetEnv] = useState(envs[0]?.id ?? '');
  const [cascade, setCascade] = useState(true);
  const [rename, setRename] = useState(true);
  const [understood, setUnderstood] = useState(false);
  const [plan, setPlan] = useState<SwitchPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [mappings, setMappings] = useState<number | null>(null);
  const [pinCandidates, setPinCandidates] = useState<MockCandidate[]>([]);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinChecked, setPinChecked] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string | undefined>();

  // Prérequis : sans mapping il n'y a rien à rebrancher.
  useEffect(() => {
    if (!open) return;
    setIntent(startCopyTo ? 'copy' : null);
    if (startCopyTo) setTargetEnv(startCopyTo);
    setUnderstood(false);
    setGroupId(groups?.[0]?.id);
    setPinEnabled(false);
    setPinCandidates([]);
    apiGet<unknown[]>('/resource-mappings?_start=0&_end=200')
      .then((rows) => setMappings(rows.length))
      .catch(() => setMappings(null));
  }, [open, groups, startCopyTo]);

  // Le plan de bascule répond à la seule question qui compte pour « rebrancher » :
  // est-ce qu'il y a quelque chose à remplacer, et qu'est-ce qui restera en place ?
  useEffect(() => {
    if (!open || (intent !== 'switch' && intent !== 'copy')) return;
    setPlan(null);
    apiPost<SwitchPlan>(`/env-switcher/preview/${workflowId}`, { targetEnv })
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [open, intent, targetEnv, workflowId]);

  // Ce qui sort du système, pour le proposer à l'épinglage sur la COPIE. La liste
  // vient du module tester : désactivé, on n'affiche simplement pas la section.
  useEffect(() => {
    if (!open || intent !== 'copy') return;
    apiGet<{ candidates: MockCandidate[] }>(`/tester/mock-plan/${workflowId}`)
      .then((plan) => {
        setPinCandidates(plan.candidates);
        setPinChecked(plan.candidates.filter((c) => c.suggested).map((c) => c.nodeName));
      })
      .catch(() => setPinCandidates([]));
  }, [open, intent, workflowId]);

  const alreadyTagged = (tags ?? []).some((tag) => tag.toLowerCase() === `env:${targetEnv}`);
  const noMapping = mappings === 0;

  const choices: Array<{ value: Intent; title: string; detail: React.ReactNode; blocked?: string }> = [
    {
      value: 'switch',
      title: t('choices.switchTitle'),
      detail: t('choices.switchDetail'),
      blocked: noMapping ? t('choices.switchBlocked') : undefined,
    },
    {
      value: 'copy',
      title: t('choices.copyTitle'),
      detail: t('choices.copyDetail', { env: targetEnv.toUpperCase() }),
    },
    {
      value: 'mark',
      title: t('choices.markTitle'),
      detail: t.rich('choices.markDetail', {
        env: targetEnv,
        code: (chunks) => <code>{chunks}</code>,
      }),
    },
    {
      value: 'group',
      title: t('choices.groupTitle'),
      detail: t('choices.groupDetail', { names: (groups ?? []).map((group) => group.name).join(', ') }),
      blocked: (groups ?? []).length === 0 ? t('choices.groupBlocked') : undefined,
    },
    {
      value: 'promote',
      title: promoteDefaults?.targetEnv
        ? t('choices.promoteTitleTo', { env: envLabel(promoteDefaults.targetEnv) })
        : t('choices.promoteTitle'),
      detail: t('choices.promoteDetail'),
    },
  ];

  const act = async () => {
    if (intent === 'group') {
      if (!groupId) return;
      onClose();
      onGroupDuplicate(groupId);
      return;
    }
    setBusy(true);
    try {
      if (intent === 'switch') {
        await apiPost(`/env-switcher/apply/${workflowId}`, { targetEnv });
        message.success(t('switched', { env: targetEnv }));
      }
      if (intent === 'copy') {
        const result = await apiPost<{
          newName: string;
          subWorkflows: Array<{ status: string; targetName?: string; sourceName?: string }>;
          pinsLost: string[];
        }>(`/env-switcher/duplicate/${workflowId}`, {
          targetEnv,
          cascade,
          pinNodes: pinEnabled ? pinChecked : [],
        });
        message.success(t('copyCreated', { name: result.newName }));
        // Sans pinData, la copie enverrait pour de vrai dès le premier essai.
        if (result.pinsLost.length > 0) {
          message.error(t('pinsLost', { names: result.pinsLost.join(', ') }), 10);
        }
        // Un sous-workflow resté sans copie garde l'id d'origine : la copie rappelle l'original.
        const missing = result.subWorkflows.filter(
          (sub) => sub.status !== 'mapped' && sub.status !== 'unchanged',
        );
        if (missing.length > 0) {
          message.warning(
            t('subsMissing', {
              env: targetEnv.toUpperCase(),
              names: missing.map((sub) => sub.targetName ?? sub.sourceName ?? '?').join(', '),
            }),
            8,
          );
        }
      }
      if (intent === 'mark') {
        const result = await apiPost<{ newName?: string }>(`/env-switcher/mark/${workflowId}`, {
          targetEnv,
          rename,
        });
        message.success(
          result.newName
            ? t('markedRenamed', { env: targetEnv, name: result.newName })
            : t('marked', { env: targetEnv }),
        );
      }
      onDone();
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const action: Record<
    Exclude<Intent, 'promote'>,
    { label: string; danger?: boolean; disabled?: boolean }
  > = {
    group: { label: t('actions.group'), disabled: !groupId },
    switch: {
      label: t('actions.switch', { env: targetEnv }),
      danger: true,
      disabled: (plan !== null && plan.hits.length === 0) || (active === true && !understood),
    },
    copy: { label: t('actions.copy', { env: targetEnv.toUpperCase() }), disabled: false },
    mark: { label: t('actions.mark', { env: targetEnv }), disabled: alreadyTagged && !rename },
  };

  return (
    <Modal
      title={t('title')}
      open={open}
      onCancel={onClose}
      width={620}
      footer={
        intent === null || intent === 'promote' ? null : (
          <Space>
            <Button onClick={() => setIntent(null)}>{tCommon('back')}</Button>
            <Button
              type="primary"
              danger={action[intent].danger}
              loading={busy}
              disabled={action[intent].disabled}
              onClick={act}
            >
              {action[intent].label}
            </Button>
          </Space>
        )
      }
    >
      {intent === null ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>{t('question', { name: workflowName ?? '' })}</div>
          <Radio.Group
            style={{ width: '100%' }}
            // La promotion a son propre assistant : ce choix-là passe la main aussitôt.
            onChange={(e) => {
              const value = e.target.value as Intent;
              if (value === 'promote') {
                onClose();
                onPromote();
                return;
              }
              setIntent(value);
            }}
            value={intent}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {choices.map((choice) => (
                <Radio key={choice.value} value={choice.value} disabled={Boolean(choice.blocked)}>
                  <b>{choice.title}</b>
                  <div style={{ color: '#888' }}>{choice.detail}</div>
                  {choice.blocked && (
                    <div style={{ color: BRAND.danger }}>
                      {t('unavailable', { reason: choice.blocked })}{' '}
                      {choice.value === 'switch' ? (
                        <Link href="/resource-mappings/create">{t('declareMapping')}</Link>
                      ) : choice.value === 'group' ? (
                        <Link href="/workflow-groups/create">{t('createGroup')}</Link>
                      ) : (
                        <Link href="/instances">{t('addInstance')}</Link>
                      )}
                    </div>
                  )}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Space>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {intent === 'group' ? (
            <div>
              {t('whichGroup')}
              <Select
                value={groupId}
                onChange={setGroupId}
                style={{ width: 260, marginLeft: 8 }}
                options={(groups ?? []).map((group) => ({ value: group.id, label: group.name }))}
              />
            </div>
          ) : (
            <div>
              {intent === 'switch' && t('switchQuestion')}
              {intent === 'copy' && t('copyQuestion')}
              {intent === 'mark' && t('markQuestion')}
              <Select
                value={targetEnv}
                onChange={setTargetEnv}
                style={{ width: 160, marginLeft: 8 }}
                options={envs.map((env) => ({ value: env.id, label: env.label }))}
              />
            </div>
          )}

          {intent === 'switch' && (
            <>
              {active && (
                <Alert
                  type="error"
                  showIcon
                  message={t('activeWarning', { env: targetEnv })}
                  description={
                    <Checkbox checked={understood} onChange={(e) => setUnderstood(e.target.checked)}>
                      {t('understood')}
                    </Checkbox>
                  }
                />
              )}
              {plan &&
                (plan.hits.length === 0 ? (
                  <span style={{ color: '#888' }}>{t('nothingToReplace', { env: targetEnv })}</span>
                ) : (
                  <SwitchedResources switched={plan.switched} replacements={plan.hits.length} />
                ))}
            </>
          )}

          {intent === 'copy' && (
            <>
              <Checkbox checked={cascade} onChange={(e) => setCascade(e.target.checked)}>
                {t('cascade')}
              </Checkbox>

              {pinCandidates.length > 0 && (
                <div>
                  <Checkbox checked={pinEnabled} onChange={(e) => setPinEnabled(e.target.checked)}>
                    {t('pin', { count: pinCandidates.length })}
                  </Checkbox>
                  {pinEnabled &&
                    pinCandidates.map((candidate) => (
                      <div key={candidate.nodeName} style={{ marginLeft: 24 }}>
                        <Checkbox
                          checked={pinChecked.includes(candidate.nodeName)}
                          onChange={(e) =>
                            setPinChecked((current) =>
                              e.target.checked
                                ? [...current, candidate.nodeName]
                                : current.filter((name) => name !== candidate.nodeName),
                            )
                          }
                        >
                          <b>{candidate.nodeName}</b> <Tag>{candidate.reason}</Tag>
                        </Checkbox>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}

          {intent === 'mark' && (
            <>
              <Checkbox checked={rename} onChange={(e) => setRename(e.target.checked)}>
                {t('rename', {
                  name: withoutEnvSuffix(workflowName ?? '', envs),
                  env: targetEnv.toUpperCase(),
                })}
              </Checkbox>
              {alreadyTagged && (
                <span>
                  <Tag>{t('alreadyTagged', { env: targetEnv })}</Tag>
                </span>
              )}
            </>
          )}

          {(intent === 'switch' || intent === 'copy') && plan && plan.unmapped.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t('unmapped', { count: plan.unmapped.length })}
              description={
                <>
                  <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
                    {plan.unmapped.map((resource) => (
                      <li key={resource.key}>
                        <Tag>{resource.provider}</Tag>
                        {resource.label ?? resource.key}{' '}
                        <span style={{ color: '#999' }}>({resource.nodes.join(', ')})</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/resource-mappings/create">
                    <Button size="small">{t('declareMapping')}</Button>
                  </Link>
                </>
              }
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
