'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { apiDelete, apiGet, apiPost } from '../lib/api';

export type CheckModuleId = 'verifier' | 'js-checker' | 'optimizer' | 'field-checker' | 'remote-schema';
export type CheckScope = 'family' | 'group' | 'instance' | 'global';

export interface CheckGroup {
  id: string;
  module: CheckModuleId;
  label: string;
  description: string;
  costly?: boolean;
}

export interface CheckDef {
  code: string;
  group: string;
  label: string;
}

export interface CheckCatalog {
  groups: CheckGroup[];
  checks: CheckDef[];
}

interface ProfileTarget {
  scope: CheckScope;
  targetId: string;
  label: string;
}

export interface ResolvedProfile {
  disabled: string[];
  source: ProfileTarget | null;
  targets: ProfileTarget[];
}

type SaveDecision =
  | { action: 'none' }
  | { action: 'auto'; scope: CheckScope; notice: string }
  | { action: 'ask'; suggested: CheckScope; reason: string };

interface SavedProfile extends ProfileTarget {
  id: string;
  disabled: string[];
}

/** Catalogue des contrôles, servi par l'API (le web ne dépend pas de `@nwm/core`). */
export function useCheckCatalog(): CheckCatalog | null {
  const [catalog, setCatalog] = useState<CheckCatalog | null>(null);
  useEffect(() => {
    apiGet<CheckCatalog>('/check-profiles/catalog')
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);
  return catalog;
}

/** Sélection qui s'applique à ce workflow, et d'où elle vient. */
export function useResolvedChecks(workflowId: string): {
  resolved: ResolvedProfile | null;
  reload: () => void;
} {
  const [resolved, setResolved] = useState<ResolvedProfile | null>(null);
  const reload = useCallback(() => {
    apiGet<ResolvedProfile>(`/check-profiles/resolve/${workflowId}`)
      .then(setResolved)
      .catch(() => setResolved(null));
  }, [workflowId]);
  useEffect(reload, [reload]);
  return { resolved, reload };
}

interface Props {
  open: boolean;
  workflowId: string;
  onClose: () => void;
  /** Lance la vérification avec cette sélection (codes DÉCOCHÉS). */
  onRun: (disabled: string[]) => void;
  /** Appelé après un enregistrement, pour rafraîchir l'origine affichée. */
  onSaved?: () => void;
}

/**
 * Choix des contrôles avant de lancer une vérification.
 *
 * Mode simple : une case par famille de contrôles — c'est la granularité à
 * laquelle on décide (« pas les sticky notes sur ce workflow »). Mode avancé :
 * la règle une à une, pour les cas où l'on ne veut retirer qu'un contrôle.
 *
 * La portée d'enregistrement est décidée par le serveur (cf. `check-profile.ts`),
 * qui ne rend la main que lorsque la même sélection se répète — signe d'une règle
 * d'équipe et non d'une exception. Elle reste NOMMÉE et modifiable ici : laissée
 * implicite, personne ne savait qu'un réglage pouvait valoir pour un groupe ou
 * pour toute l'instance, et le palier « groupe » n'était en pratique jamais atteint.
 */
export function CheckSelectionModal({ open, workflowId, onClose, onRun, onSaved }: Props) {
  const catalog = useCheckCatalog();
  const { resolved, reload } = useResolvedChecks(workflowId);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const [saved, setSaved] = useState<SavedProfile[] | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [ask, setAsk] = useState<{
    decision: Extract<SaveDecision, { action: 'ask' }>;
    selection: string[];
  } | null>(null);
  const [askScope, setAskScope] = useState<CheckScope>('family');
  // 'auto' = on laisse le serveur décider (le comportement d'avant, resté le défaut).
  const [scope, setScope] = useState<CheckScope | 'auto'>('auto');

  // Le mode choisi est celui qu'on retrouvera la prochaine fois : passer en
  // avancé à chaque ouverture serait le seul geste vraiment répétitif de l'écran.
  useEffect(() => {
    const stored = window.localStorage.getItem('nwm.check-mode');
    if (stored === 'advanced' || stored === 'simple') setMode(stored);
  }, []);
  useEffect(() => {
    window.localStorage.setItem('nwm.check-mode', mode);
  }, [mode]);

  useEffect(() => {
    if (open && resolved) setDisabled(resolved.disabled);
  }, [open, resolved]);

  useEffect(() => {
    if (open) setScope('auto');
  }, [open]);

  const loadSaved = () => {
    apiGet<SavedProfile[]>('/check-profiles')
      .then(setSaved)
      .catch(() => setSaved([]));
  };

  if (!catalog || !resolved) {
    return (
      <Modal open={open} onCancel={onClose} footer={null} title="Contrôles à jouer">
        <Spin />
      </Modal>
    );
  }

  const codesOfGroup = (groupId: string) =>
    catalog.checks.filter((check) => check.group === groupId).map((check) => check.code);

  const toggleGroup = (groupId: string, on: boolean) => {
    const codes = codesOfGroup(groupId);
    setDisabled((current) =>
      on ? current.filter((code) => !codes.includes(code)) : [...new Set([...current, ...codes])],
    );
  };

  const toggleCode = (code: string, on: boolean) =>
    setDisabled((current) => (on ? current.filter((c) => c !== code) : [...new Set([...current, code])]));

  const groupState = (groupId: string): { checked: boolean; indeterminate: boolean } => {
    const codes = codesOfGroup(groupId);
    const offCount = codes.filter((code) => disabled.includes(code)).length;
    return { checked: offCount < codes.length, indeterminate: offCount > 0 && offCount < codes.length };
  };

  const activeCount = catalog.checks.length - disabled.length;

  /** Enregistre la sélection ; le serveur ne rend la main que s'il faut choisir. */
  const persist = async (selection: string[], scope?: CheckScope) => {
    const result = await apiPost<{ decision: SaveDecision }>(`/check-profiles/apply/${workflowId}`, {
      disabled: selection,
      scope,
    });
    if (result.decision.action === 'ask' && !scope) {
      setAskScope(result.decision.suggested);
      setAsk({ decision: result.decision, selection });
      return;
    }
    if (result.decision.action === 'auto' && result.decision.notice) {
      message.info(result.decision.notice);
    }
    reload();
    onSaved?.();
  };

  const runNow = () => {
    const selection = [...disabled];
    onRun(selection);
    onClose();
    persist(selection, scope === 'auto' ? undefined : scope).catch((error) =>
      message.error((error as Error).message),
    );
  };

  const scopeOptions = [
    { value: 'auto', label: 'Portée : décidée automatiquement' },
    ...resolved.targets.map((target) => ({ value: target.scope, label: `Enregistrer pour ${target.label}` })),
  ];

  const removeProfile = async (id: string) => {
    try {
      await apiDelete(`/check-profiles/${id}`);
      loadSaved();
      reload();
      onSaved?.();
    } catch (error) {
      // Un profil retiré change ce que la plateforme joue sur tout un périmètre :
      // un échec silencieux laissait croire au retrait, et les contrôles
      // continuaient de tourner comme avant.
      message.error((error as Error).message);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        width={720}
        title="Contrôles à jouer"
        footer={[
          <Button key="reset" onClick={() => setDisabled([])}>
            Tout cocher
          </Button>,
          <Button key="cancel" onClick={onClose}>
            Annuler
          </Button>,
          <Button key="run" type="primary" onClick={runNow}>
            Lancer la vérification ({activeCount})
          </Button>,
        ]}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space style={{ justifyContent: 'space-between', width: '100%' }} align="start">
            <Space direction="vertical" size={4}>
              {resolved.source && (
                <Typography.Text type="secondary">
                  Configuration héritée de : {resolved.source.label}
                </Typography.Text>
              )}
              <Tooltip title="Le périmètre le plus précis l’emporte.">
                <Select
                  size="small"
                  style={{ minWidth: 320 }}
                  value={scope}
                  onChange={(value) => setScope(value as CheckScope | 'auto')}
                  options={scopeOptions}
                />
              </Tooltip>
            </Space>
            <Segmented
              value={mode}
              onChange={(value) => setMode(value as 'simple' | 'advanced')}
              options={[
                { label: 'Simple', value: 'simple' },
                { label: 'Avancé', value: 'advanced' },
              ]}
            />
          </Space>

          {mode === 'simple' ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              {catalog.groups.map((group) => {
                const state = groupState(group.id);
                return (
                  <Checkbox
                    key={group.id}
                    checked={state.checked}
                    indeterminate={state.indeterminate}
                    onChange={(event) => toggleGroup(group.id, event.target.checked)}
                  >
                    <Space size={4}>
                      <Tooltip title={group.description}>
                        <strong>{group.label}</strong>
                      </Tooltip>
                      {group.costly && (
                        <Tooltip title="Contrôle coûteux (appel IA ou lecture des exécutions n8n)">
                          <Tag color="gold" icon={<ThunderboltOutlined />} style={{ marginInlineEnd: 0 }}>
                            coûteux
                          </Tag>
                        </Tooltip>
                      )}
                    </Space>
                  </Checkbox>
                );
              })}
            </Space>
          ) : (
            <Collapse
              size="small"
              defaultActiveKey={catalog.groups.map((group) => group.id)}
              items={catalog.groups.map((group) => {
                const state = groupState(group.id);
                return {
                  key: group.id,
                  label: (
                    <Checkbox
                      checked={state.checked}
                      indeterminate={state.indeterminate}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => toggleGroup(group.id, event.target.checked)}
                    >
                      {group.label}
                    </Checkbox>
                  ),
                  children: (
                    <Space direction="vertical">
                      {catalog.checks
                        .filter((check) => check.group === group.id)
                        .map((check) => (
                          <Checkbox
                            key={check.code}
                            checked={!disabled.includes(check.code)}
                            onChange={(event) => toggleCode(check.code, event.target.checked)}
                          >
                            <Tooltip title={check.code}>{check.label}</Tooltip>
                          </Checkbox>
                        ))}
                    </Space>
                  ),
                };
              })}
            />
          )}

          <Typography.Link
            onClick={() => {
              setShowSaved((visible) => !visible);
              if (!saved) loadSaved();
            }}
          >
            {showSaved ? 'Masquer' : 'Voir'} les configurations enregistrées
          </Typography.Link>
          {showSaved && (
            <Space direction="vertical" style={{ width: '100%' }}>
              {(saved ?? []).length === 0 && (
                <Typography.Text type="secondary">Aucune configuration enregistrée.</Typography.Text>
              )}
              {(saved ?? []).map((profile) => (
                <Space key={profile.id} style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text>
                    {profile.label} — {catalog.checks.length - profile.disabled.length} contrôles actifs
                  </Typography.Text>
                  <Popconfirm
                    title={`Retirer « ${profile.label} » ?`}
                    description="Ce périmètre repassera sur la configuration héritée : les contrôles décochés ici se rejoueront."
                    okText="Retirer"
                    okButtonProps={{ danger: true }}
                    cancelText="Annuler"
                    onConfirm={() => removeProfile(profile.id)}
                  >
                    <Button size="small" danger type="text" icon={<DeleteOutlined />}>
                      Retirer
                    </Button>
                  </Popconfirm>
                </Space>
              ))}
            </Space>
          )}
        </Space>
      </Modal>

      <Modal
        open={Boolean(ask)}
        title="Appliquer cette sélection à…"
        okText="Enregistrer"
        cancelText="Juste pour cette fois"
        onCancel={() => setAsk(null)}
        onOk={async () => {
          const pending = ask;
          setAsk(null);
          if (!pending) return;
          await persist(pending.selection, askScope).catch((error) =>
            message.error((error as Error).message),
          );
        }}
      >
        <Space direction="vertical">
          <Alert type="info" showIcon message={ask?.decision.reason} />
          <Radio.Group value={askScope} onChange={(event) => setAskScope(event.target.value)}>
            <Space direction="vertical">
              {resolved.targets.map((target) => (
                <Radio key={target.scope} value={target.scope}>
                  {target.label}
                  {ask?.decision.suggested === target.scope && (
                    <Tag color="blue" style={{ marginInlineStart: 8 }}>
                      suggéré
                    </Tag>
                  )}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Space>
      </Modal>
    </>
  );
}
