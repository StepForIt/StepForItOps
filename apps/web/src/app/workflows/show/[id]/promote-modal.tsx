'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Descriptions, Modal, Select, Space, Tag, message } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../../../../lib/api';
import { PromoteVersionCard, PromoteVersionGate, ReleaseLevel } from './promote-version-card';
import { PromoteChainCard, PromoteChainGate } from './promote-chain-card';
import { useInstanceScope } from '../../../../lib/instance-scope';
import { useEnvLabel, useEnvOptions } from '../../../../lib/envs';
import { useEnabledModules } from '../../../../lib/enabled-modules';
import { RemoteTableView } from '../../../../components/remote-schema-tables';
import { PromoteChecks } from './promote-checks';
import { buildPromoteChecks } from './promote-check-list';
import { usePromoteDefaults } from './promote-defaults';
import { PublishRunView, publishRunSummary } from './publish-run';

interface InstanceRow {
  id: string;
  name: string;
}

interface PromoteFinding {
  id: string;
  module: string;
  code: string;
  message: string;
  nodeName?: string;
  suggestion?: string;
}

interface PromoteGates {
  /** `items` est tronqué (20) ; `errors` reste le compte exact. */
  findings: { ok: boolean; errors: number; items: PromoteFinding[] };
  tests: { ok: boolean; total: number; passed: number; failed: number; neverRun: number } | null;
  credentials: { ok: boolean; missing: string[] };
  subWorkflows: {
    ok: boolean;
    total: number;
    mapped: number;
    missing: number;
    dynamic: number;
    cascade: number;
    archived: number;
  };
  version: PromoteVersionGate;
  chain: PromoteChainGate;
  /** null : contrôle non demandé, ou module `remote-schema` désactivé. */
  remoteSchema: {
    ok: boolean;
    missing: Array<{ code: string; message: string; nodeName?: string; suggestion?: string }>;
    unverified: Array<{ table: string; reason: string }>;
    tables: RemoteTableView[];
  } | null;
}

interface SubWorkflowMapping {
  nodeName: string;
  kind: 'execute' | 'tool';
  sourceN8nId: string;
  sourceName?: string;
  targetName?: string;
  targetN8nId?: string;
  targetArchived?: boolean;
  status: 'mapped' | 'unchanged' | 'missing' | 'dynamic';
}

export interface PromotePreview {
  sourceName: string;
  targetInstanceName: string;
  targetName: string;
  mode: 'create' | 'update';
  targetActive?: boolean;
  targetArchived?: boolean;
  replacements: number;
  switched?: Array<{ nodeName: string; from: string; to: string }>;
  unmapped: Array<{ key: string; provider: string; label?: string; nodes: string[] }>;
  subWorkflows: SubWorkflowMapping[];
  cascade: Array<{ workflowId: string; sourceName: string; targetName: string }>;
  gates: PromoteGates;
  blockers: string[];
  forceable: boolean;
  needsSkipConfirm: boolean;
  webhookPaths: {
    preserved: Array<{ node: string; from: string; to: string }>;
    changes: Array<{ node: string; from: string; to: string }>;
  };
  /** URLs que la cible va servir, déjà tenues sur l'instance cible par un autre workflow. */
  entryClashes?: Array<{
    node: string;
    url: string;
    holderName: string;
    holderActive: boolean;
    holderNode: string;
    move: string | null;
  }>;
  /** Sous-workflows appelés en brouillon sur la cible : n8n refuse d'activer la cible tant qu'ils le sont. */
  callees?: {
    publish: Array<{ id: string; name: string }>;
    manual: Array<{ id: string; name: string; reason: string }>;
  };
  diff?: {
    counts: { added: number; removed: number; modified: number; renamed: number };
    nodes: Array<{
      name: string;
      change: 'added' | 'removed' | 'modified' | 'renamed';
      renamedFrom?: string;
    }>;
    hasChanges: boolean;
  };
}

interface PromoteResult {
  mode: 'create' | 'update';
  targetName: string;
  replacements: number;
  cascaded: Array<{ targetName: string; targetN8nId?: string }>;
  version?: string;
  through?: Array<{ env: string; instanceName: string; targetName: string }>;
  renames?: Array<{
    name: string;
    renamed: string;
    status: 'renamed' | 'already' | 'no-marker' | 'failed';
    error?: string;
  }>;
  moved?: Array<{ workflowName: string; node: string; from: string; to: string }>;
  callees?: { published: string[]; manual: Array<{ name: string; reason: string }> };
  publication?: PublishRunView;
  publicationError?: string;
}

const DIFF_LABEL = { added: 'ajouté', removed: 'supprimé', modified: 'modifié', renamed: 'renommé' } as const;
const DIFF_COLOR = { added: 'green', removed: 'red', modified: 'orange', renamed: 'blue' } as const;

/** Les exemplaires qui recevront le numéro : source, étapes traversées, cible. */
function versionTouched(
  preview: PromotePreview,
  through: boolean,
  targetEnv: string | undefined,
): { names: string[]; createdEnv?: string } {
  const chain = preview.gates.chain;
  const stepEnvs = through && chain.skipped.length > 0 ? chain.steps.map((step) => step.env) : [];
  const names = preview.gates.version.current
    .filter(
      (row) =>
        row.name === preview.sourceName ||
        row.name === preview.targetName ||
        (row.env !== null && stepEnvs.includes(row.env)),
    )
    .map((row) => row.name);
  return { names, createdEnv: preview.mode === 'create' ? targetEnv : undefined };
}

/**
 * L'unique écran de promotion, qu'on l'ouvre de la page workflow ou de l'écart
 * avec la prod : le preview dit si la cible sera créée ou ÉCRASÉE (correspondance
 * par nom), et la promotion n'est cliquable qu'après l'avoir vu. La cible est
 * proposée d'emblée — même instance, étape suivante de la chaîne — et se change.
 */
export function PromoteModal({
  workflowId,
  sourceInstanceId,
  open,
  onClose,
  initialTarget,
  onPublication,
}: {
  workflowId: string;
  sourceInstanceId?: string;
  open: boolean;
  onClose: () => void;
  /** Cible imposée par l'appelant ; sans elle, celle que propose l'API. */
  initialTarget?: { instanceId: string; env?: string };
  /** La chaîne « publier comme la source » rendue par la promotion. */
  onPublication?: (run: PublishRunView) => void;
}) {
  const { instanceName } = useInstanceScope();
  const envOptions = useEnvOptions();
  const envLabel = useEnvLabel();
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [targetInstanceId, setTargetInstanceId] = useState<string | undefined>(undefined);
  const [targetEnv, setTargetEnv] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [force, setForce] = useState(false);
  const [cascade, setCascade] = useState(true);
  // Libérer une URL déjà tenue sur la cible : la convention, donc cochée d'office.
  const [moveClashing, setMoveClashing] = useState(true);
  // Un sous-workflow qui ne démarre rien seul se publie sans risque, et n8n l'exige.
  const [publishCallees, setPublishCallees] = useState(true);
  // Promouvoir ne déploie pas, sauf à le demander.
  const [publishLikeSource, setPublishLikeSource] = useState(false);
  const { enabled: enabledModules } = useEnabledModules();
  const remoteAvailable = !enabledModules || enabledModules.includes('remote-schema');
  const [showDiff, setShowDiff] = useState(false);
  // Traverser plutôt qu'ignorer : c'est la réponse par défaut à un saut d'étape,
  // et elle ne coûte rien quand la chaîne n'en déclare aucune.
  const [through, setThrough] = useState(true);
  const [confirmSkip, setConfirmSkip] = useState(false);
  // Non renseigné tant que l'humain n'a rien touché : c'est la proposition du
  // preview qui s'applique, et elle porte sa raison.
  const [bump, setBump] = useState<ReleaseLevel | undefined>(undefined);

  const defaults = usePromoteDefaults(workflowId, open && !initialTarget);

  useEffect(() => {
    if (!open) return;
    const target =
      initialTarget ??
      (defaults ? { instanceId: defaults.targetInstanceId, env: defaults.targetEnv ?? undefined } : null);
    if (!target) return;
    setTargetInstanceId(target.instanceId);
    setTargetEnv(target.env);
  }, [open, initialTarget, defaults]);

  useEffect(() => {
    if (!open) return;
    // L'instance source reste dans la liste : dev et prod cohabitent souvent sur la
    // même instance, sous des noms suffixés — y pousser est un cas normal.
    apiGet<InstanceRow[]>('/instances?_start=0&_end=100')
      .then(setInstances)
      .catch((error) => message.error((error as Error).message));
  }, [open, sourceInstanceId]);

  const onSameInstance = targetInstanceId !== undefined && targetInstanceId === sourceInstanceId;

  const loadPreview = React.useCallback(
    async (announce = false) => {
      if (!targetInstanceId) return;
      // Sans env cible, l'API refuserait : le message serait une erreur rouge pour un
      // choix simplement pas encore fait.
      if (targetInstanceId === sourceInstanceId && !targetEnv) return;
      setBusy('preview');
      try {
        setPreview(
          await apiPost<PromotePreview>(`/env-switcher/promote/${workflowId}/preview`, {
            targetInstanceId,
            targetEnv,
            cascade,
            checkRemote: remoteAvailable,
            moveClashing,
          }),
        );
        // Un re-clic renvoie souvent le même aperçu : sans ce toast, il semble mort.
        if (announce) message.success('Aperçu actualisé');
      } catch (error) {
        message.error((error as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [workflowId, sourceInstanceId, targetInstanceId, targetEnv, cascade, remoteAvailable, moveClashing],
  );

  // Tout changement de cible invalide l'aperçu (on ne promeut que ce qu'on vient de
  // voir) et le recharge aussitôt : la lecture est sans risque, autant l'afficher.
  useEffect(() => {
    setPreview(null);
    setForce(false);
    setConfirmSkip(false);
    setBump(undefined);
    void loadPreview();
  }, [loadPreview]);

  // Niveau effectif : celui qu'on a choisi, sinon celui que le preview propose.
  const level: ReleaseLevel = bump ?? preview?.gates.version.level ?? 'patch';
  const chain = preview?.gates.chain;
  const missingSubs = (preview?.subWorkflows ?? [])
    .filter((sub) => sub.status === 'missing' && !sub.targetArchived)
    .map((sub) => sub.targetName ?? sub.sourceName ?? sub.sourceN8nId);
  // Le saut se juge côté UI : cocher « passer par » ou « sauter quand même » doit
  // répondre tout de suite, sans recharger un aperçu qui ne changerait pas.
  const skipping = Boolean(chain && chain.skipped.length > 0 && !through);
  const chainBlocked = skipping && chain?.mode === 'block';
  const chainNeedsConfirm = skipping && chain?.mode === 'warn' && !confirmSkip;

  const apply = async () => {
    if (!targetInstanceId) return;
    setBusy('apply');
    try {
      const result = await apiPost<PromoteResult>(`/env-switcher/promote/${workflowId}`, {
        targetInstanceId,
        targetEnv,
        force,
        cascade,
        throughChain: through,
        confirmSkip,
        checkRemote: remoteAvailable,
        moveClashing,
        publishCallees,
        publishLikeSource,
        bump: level,
      });
      const also =
        result.cascaded.length > 0
          ? ` — ${result.cascaded.length} sous-workflow(s) créé(s) au passage : ${result.cascaded
              .map((sub) => sub.targetName)
              .join(', ')}`
          : '';
      const traversed =
        result.through && result.through.length > 0
          ? ` — passé par ${result.through.map((step) => step.env.toUpperCase()).join(', ')}`
          : '';
      const version = result.version ? ` en ${result.version}` : '';
      // Le numéro vit à deux endroits : la colonne de la plateforme et le NOM côté
      // n8n. Taire le second faisait annoncer « posé en 1.3.0 » à côté d'un n8n
      // resté en « (1.2.2) », sans rien pour le voir hors des logs du conteneur.
      const renames = result.renames ?? [];
      const failed = renames.filter((rename) => rename.status === 'failed');
      const renamed = renames.filter((rename) => rename.status === 'renamed');
      const named =
        renamed.length > 0
          ? ` — nom n8n mis à jour (${renamed.map((rename) => `« ${rename.renamed} »`).join(', ')})`
          : renames.length > 0 && renames.every((rename) => rename.status === 'no-marker')
            ? ' — nom n8n inchangé : aucun marqueur de version (1.2.3) dans le nom'
            : '';
      const freed =
        result.moved && result.moved.length > 0
          ? ` — URL libérée : ${result.moved.map((m) => `« ${m.workflowName} » passé en /${m.to}`).join(', ')}`
          : '';
      message.success(
        result.mode === 'create'
          ? `« ${result.targetName} » créé sur l'instance cible${version} (inactif, ${result.replacements} remplacements)${traversed}${also}${named}${freed}`
          : `« ${result.targetName} » mis à jour sur l'instance cible${version} (${result.replacements} remplacements)${traversed}${also}${named}${freed}`,
        result.cascaded.length > 0 || traversed || named || freed ? 8 : undefined,
      );
      if (result.callees && result.callees.published.length > 0) {
        message.info(
          `Sous-workflows publiés : ${result.callees.published.map((n) => `« ${n} »`).join(', ')}`,
          8,
        );
      }
      // Ce qui reste en brouillon empêchera d'activer la cible : à dire, pas à taire —
      // sauf quand la chaîne « publier comme la source » s'en charge, étape par étape.
      if (!result.publication) {
        const manual = new Map((result.callees?.manual ?? []).map((callee) => [callee.name, callee.reason]));
        for (const [name, reason] of manual) {
          message.warning(`« ${name} » reste à publier dans n8n : ${reason}`, 12);
        }
      }
      // Un renommage raté ne défait pas la promotion — mais il se dit, et il dit
      // ce que n8n a refusé : sinon les deux numéros divergent en silence.
      for (const rename of failed) {
        message.error(
          `« ${rename.name} » devait devenir « ${rename.renamed} » dans n8n : ${rename.error ?? 'refus de n8n'}. ` +
            `La version est posée dans la plateforme, le nom est à corriger à la main.`,
          12,
        );
      }
      if (result.publication) {
        if (result.publication.status === 'paused') message.error(publishRunSummary(result.publication), 12);
        else message.success(publishRunSummary(result.publication), 8);
        onPublication?.(result.publication);
      }
      if (result.publicationError) {
        message.error(`Publication à faire à la main : ${result.publicationError}`, 12);
      }
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="Promouvoir"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button loading={busy === 'preview'} disabled={!targetInstanceId} onClick={() => loadPreview(true)}>
            Actualiser l&apos;aperçu
          </Button>
          <Button
            type="primary"
            danger={preview?.mode === 'update' || (preview?.blockers.length ?? 0) > 0}
            loading={busy === 'apply'}
            disabled={
              !preview ||
              chainBlocked ||
              chainNeedsConfirm ||
              (preview.blockers.length > 0 && !(force && preview.forceable))
            }
            onClick={apply}
          >
            {preview?.mode === 'update' ? 'Écraser sur la cible' : 'Promouvoir'}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          {sourceInstanceId && (
            <>
              <Tag color="geekblue" style={{ marginRight: 4 }}>
                {instanceName(sourceInstanceId)}
              </Tag>
              <ArrowRightOutlined style={{ marginRight: 8, color: '#999' }} />
            </>
          )}
          <Select
            placeholder="Instance cible"
            style={{ width: 240, marginRight: 8 }}
            value={targetInstanceId}
            onChange={setTargetInstanceId}
            options={instances.map((row) => ({
              value: row.id,
              label: row.id === sourceInstanceId ? `${row.name} (même instance)` : row.name,
            }))}
          />
          <Select
            allowClear={!onSameInstance}
            status={onSameInstance && !targetEnv ? 'warning' : undefined}
            placeholder={onSameInstance ? 'Env cible (obligatoire)' : 'Env cible (optionnel)'}
            style={{ width: 230 }}
            value={targetEnv}
            // '' = l'option « Aucun » : plus visible que la croix d'allowClear.
            onChange={(value) => setTargetEnv(value || undefined)}
            options={[
              // Sur la même instance, « aucun env » viserait le workflow lui-même.
              ...(onSameInstance ? [] : [{ value: '', label: 'Aucun — copie telle quelle' }]),
              ...envOptions,
            ]}
          />
        </div>
        {preview && missingSubs.length > 0 && (
          <Checkbox checked={cascade} onChange={(e) => setCascade(e.target.checked)}>
            Créer aussi sur la cible les sous-workflows qui y manquent : {missingSubs.join(', ')}
          </Checkbox>
        )}
        {preview && (
          <Checkbox checked={publishLikeSource} onChange={(e) => setPublishLikeSource(e.target.checked)}>
            Publier comme la source (sous-workflows d’abord)
          </Checkbox>
        )}
        {preview && (
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Cible">
              « {preview.targetName} »
              {!onSameInstance && <span style={{ color: '#999' }}> sur {preview.targetInstanceName}</span>}{' '}
              {preview.mode === 'create' ? (
                <Tag color="green">sera créé (inactif)</Tag>
              ) : (
                <Tag color="orange">sera remplacé</Tag>
              )}
              {preview.targetActive && <Tag color="red">ACTIF</Tag>}
              {preview.targetArchived && <Tag color="red">ARCHIVÉ</Tag>}
            </Descriptions.Item>
            {preview.replacements > 0 && (
              <Descriptions.Item label={`Données ${targetEnv ? envLabel(targetEnv) : ''}`}>
                {preview.switched && preview.switched.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {preview.switched.map((row) => (
                      <li key={`${row.nodeName}:${row.from}`}>
                        {row.nodeName} : {row.from} → <strong>{row.to}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  `${preview.replacements} base(s)/table(s) remplacée(s) par leur équivalent ${targetEnv ? envLabel(targetEnv) : ''}`
                )}
              </Descriptions.Item>
            )}
            {preview.diff && (
              <Descriptions.Item label="Nœuds vs la cible">
                {preview.diff.hasChanges ? (
                  <>
                    {[
                      [preview.diff.counts.added, 'ajouté(s)'],
                      [preview.diff.counts.removed, 'supprimé(s)'],
                      [preview.diff.counts.modified, 'modifié(s)'],
                      [preview.diff.counts.renamed, 'renommé(s)'],
                    ]
                      .filter(([n]) => n)
                      .map(([n, l]) => `${n} ${l}`)
                      .join(' · ')}
                    {preview.diff.nodes.length > 0 && (
                      <Button type="link" size="small" onClick={() => setShowDiff(!showDiff)}>
                        {showDiff ? 'masquer' : 'lesquels ?'}
                      </Button>
                    )}
                    {showDiff && (
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {preview.diff.nodes.map((node) => (
                          <li key={`${node.change}:${node.name}`}>
                            <Tag color={DIFF_COLOR[node.change]}>{DIFF_LABEL[node.change]}</Tag>
                            {node.renamedFrom ? `${node.renamedFrom} → ${node.name}` : node.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  'identiques — rien ne change'
                )}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
        {preview && chain && (
          <PromoteChainCard
            gate={chain}
            through={through}
            onThrough={setThrough}
            confirmSkip={confirmSkip}
            onConfirmSkip={setConfirmSkip}
          />
        )}
        {preview && (
          <PromoteVersionCard
            gate={preview.gates.version}
            level={level}
            onLevel={setBump}
            touched={versionTouched(preview, through, targetEnv)}
          />
        )}
        {preview && <PromoteChecks checks={buildPromoteChecks(preview, remoteAvailable)} />}
        {preview && preview.blockers.length > 0 && (
          <Alert
            type="error"
            showIcon
            message={`Promotion bloquée : ${preview.blockers.join(' ; ')}`}
            description={
              preview.forceable ? (
                <Checkbox checked={force} onChange={(e) => setForce(e.target.checked)}>
                  Forcer quand même, en connaissance de cause
                </Checkbox>
              ) : (
                'Ce blocage ne se force pas : n8n refuse d’écrire sur un workflow archivé.'
              )
            }
          />
        )}
        {preview &&
          ((preview.callees?.publish.length ?? 0) > 0 || (preview.callees?.manual.length ?? 0) > 0) && (
            <Alert
              type={(preview.callees?.manual.length ?? 0) > 0 ? 'warning' : 'info'}
              showIcon
              message="Sous-workflows en brouillon sur la cible"
              description={
                <Space direction="vertical" size={4}>
                  <span>
                    n8n refuse d’activer un workflow tant que ses sous-workflows ne sont pas publiés.
                  </span>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(preview.callees?.publish ?? []).map((c) => (
                      <li key={`p-${c.id}`}>« {c.name} » : sera publié</li>
                    ))}
                    {(preview.callees?.manual ?? []).map((c) => (
                      <li key={`m-${c.id}`}>
                        « {c.name} » : à publier à la main — {c.reason}
                      </li>
                    ))}
                  </ul>
                  {(preview.callees?.publish.length ?? 0) > 0 && (
                    <Checkbox checked={publishCallees} onChange={(e) => setPublishCallees(e.target.checked)}>
                      Publier ces sous-workflows avant la promotion
                    </Checkbox>
                  )}
                </Space>
              }
            />
          )}
        {preview && (preview.entryClashes ?? []).length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="URL déjà servie sur la cible"
            description={
              <Space direction="vertical" size={4}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(preview.entryClashes ?? []).map((c) => (
                    <li key={`${c.node}-${c.holderName}-${c.holderNode}`}>
                      « {c.node} » : <code>/{c.url}</code> est tenu par « {c.holderName} »
                      {c.holderActive ? ' (actif)' : ' (inactif)'}
                      {c.move ? (
                        <>
                          {' '}
                          → <code>/{c.move}</code>
                        </>
                      ) : (
                        ' — à libérer dans n8n'
                      )}
                    </li>
                  ))}
                </ul>
                {(preview.entryClashes ?? []).some((c) => c.move) && (
                  <Checkbox checked={moveClashing} onChange={(e) => setMoveClashing(e.target.checked)}>
                    Libérer ces URLs pendant la promotion
                  </Checkbox>
                )}
              </Space>
            }
          />
        )}
        {preview &&
          (preview.webhookPaths.preserved.length > 0 || preview.webhookPaths.changes.length > 0) && (
            <Alert
              type="info"
              showIcon
              message="URL des webhooks"
              description={
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {preview.webhookPaths.preserved.map((p) => (
                    <li key={`p-${p.node}`}>
                      « {p.node} » : URL inchangée (<code>/{p.to}</code>)
                    </li>
                  ))}
                  {preview.webhookPaths.changes.map((c) => (
                    <li key={`c-${c.node}`}>
                      « {c.node} » : nouvelle URL <code>/{c.to}</code>
                    </li>
                  ))}
                </ul>
              }
            />
          )}
      </Space>
    </Modal>
  );
}
