'use client';

import React from 'react';
import { Alert, Button, Card, Checkbox, Modal, Popconfirm, Skeleton, Space, Tag, Typography } from 'antd';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { DiffCounts, WorkflowDiff, WorkflowDiffView } from './workflow-diff-view';
import { useWorkflowLocks } from '../lib/workflow-lock/workflow-locks';

/** Ce que la modification casse, du point de vue de la porte DEV/PROD. */
interface GateFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeName?: string;
}

/** Ce que la modification casse structurellement : jamais contournable. */
interface IntegrityBreach {
  code: string;
  message: string;
}

interface GateVerdict {
  blocked: boolean;
  /**
   * `integrity` : aucune case ne le lève. `quality` et `refusal` : contournables
   * par un humain — mais forcer un `refusal` ne fait que déplacer le refus chez n8n.
   */
  blockedBy?: 'integrity' | 'quality' | 'refusal';
  breaches: IntegrityBreach[];
  introduced: GateFinding[];
  /** Ce que n8n refusera d'écrire, que cette modification en soit l'auteur ou non. */
  refusals: GateFinding[];
  reason?: string;
}

/**
 * Un workflow ANNEXE de la même proposition : un sous-workflow appelé par celui
 * de la conversation, modifié par le même geste. Il n'a ni point de retour ni
 * bouton de publication — ce qu'on veut en voir avant d'appliquer, c'est ce qui
 * change et ce qui bloque.
 */
export interface ProposalPartReview {
  workflowId: string;
  workflowName: string;
  operations: Array<Record<string, unknown>>;
  status: string;
  warnings: string[];
  stale: boolean;
  workflowActive: boolean;
  gate: GateVerdict;
  diff: WorkflowDiff;
}

export interface ProposalReview {
  id: string;
  platform: 'n8n' | 'make';
  workflowId: string;
  summary: string;
  operations: Array<Record<string, unknown>>;
  status: string;
  createdAt: string;
  warnings: string[];
  stale: boolean;
  workflowActive: boolean;
  /** Ce que l'écriture produira quand ce n'est pas évident (brouillon non publié). */
  writeEffect: string | null;
  /** L'état d'avant, archivé : le filet, relevé avant l'écriture. */
  restorePoint: { versionId: string; createdAt: string } | null;
  /** L'état d'avant une application déjà faite : le retour arrière, longtemps après. */
  revertPoint: { versionId: string; createdAt: string } | null;
  /** Revenir en arrière emporterait aussi ce qui a été fait après l'application. */
  revertLosesLaterChanges: boolean;
  workflowName: string;
  gate: GateVerdict;
  diff: WorkflowDiff;
  /** Les sous-workflows touchés par la même modification. Vide dans le cas ordinaire. */
  parts?: ProposalPartReview[];
  /** Sous-workflows créés pour cette conversation et que rien n'est venu remplir. */
  leftovers?: ChatLeftover[];
}

/**
 * Un sous-workflow créé par l'assistant et resté vide. Il existe dans n8n parce
 * que l'id devait exister avant que le nœud d'appel ne le vise ; refuser la
 * proposition le laisse donc derrière, et rien ne disait d'où il venait.
 */
export interface ChatLeftover {
  workflowId: string;
  externalId: string;
  name: string;
  createdAt: string;
  url: string;
}

/**
 * Ce qu'une modification casse sur UN workflow, et si ça suffit à la refuser.
 * Extrait pour être rendu à l'identique sur le workflow de la conversation et
 * sur chaque sous-workflow : un refus qui ne se dirait que pour la racine
 * laisserait le bouton « Appliquer » allumé devant une écriture impossible.
 */
function GateAlerts({
  gate,
  pending,
  force,
  onForce,
  where,
}: {
  gate: GateVerdict;
  pending: boolean;
  force: boolean;
  onForce: (value: boolean) => void;
  /** Nommé quand ce n'est pas le workflow de la page : sinon le refus paraît porter sur lui. */
  where?: string;
}) {
  const refused = new Set(
    gate.refusals.map((finding) => `${finding.code}|${finding.nodeName ?? ''}|${finding.message}`),
  );
  const introduced = gate.introduced.filter(
    (finding) => !refused.has(`${finding.code}|${finding.nodeName ?? ''}|${finding.message}`),
  );
  const suffix = where ? ` — ${where}` : '';
  return (
    <>
      {gate.breaches.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={`Cette modification casserait le workflow — elle ne sera pas appliquée${suffix}`}
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {gate.breaches.map((breach) => (
                <Typography.Text key={breach.code}>{breach.message}</Typography.Text>
              ))}
              <Typography.Text type="secondary">Reformule la demande.</Typography.Text>
            </Space>
          }
        />
      )}

      {gate.refusals.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={`n8n refusera d'enregistrer ce workflow${suffix}`}
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {gate.refusals.map((finding, index) => (
                <Typography.Text key={`refusal-${finding.code}-${index}`}>
                  {finding.nodeName ? <Tag>{finding.nodeName}</Tag> : null}
                  {finding.message}
                </Typography.Text>
              ))}
              <Typography.Text type="secondary">Demande la correction dans la conversation.</Typography.Text>
              {gate.blockedBy === 'refusal' && pending && (
                <Checkbox checked={force} onChange={(e) => onForce(e.target.checked)}>
                  Tenter quand même
                </Checkbox>
              )}
            </Space>
          }
        />
      )}

      {introduced.length > 0 && (
        <Alert
          type={gate.blocked ? 'error' : 'warning'}
          showIcon
          message={
            (gate.blocked
              ? 'Cette modification introduit une erreur — elle ne sera pas appliquée'
              : 'Cette modification introduit des problèmes') + suffix
          }
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {introduced.map((finding, index) => (
                <Typography.Text key={`${finding.code}-${finding.nodeName ?? ''}-${index}`}>
                  <Tag color={finding.severity === 'error' ? 'red' : 'orange'}>{finding.severity}</Tag>
                  {finding.message}
                </Typography.Text>
              ))}
              {gate.blockedBy === 'quality' && pending && (
                <Checkbox checked={force} onChange={(e) => onForce(e.target.checked)}>
                  Appliquer quand même
                </Checkbox>
              )}
            </Space>
          }
        />
      )}
    </>
  );
}

/** Où la modification s'écrit, tel que l'écran le nomme. */
const platformName = (platform?: 'n8n' | 'make'): string => (platform === 'make' ? 'Make' : 'n8n');

/**
 * Revue d'une modification proposée par l'IA : rien n'est écrit dans n8n avant
 * validation explicite de ce diff. Deux lectures du MÊME changement — ce qu'il fait,
 * puis le JSON qui le prouve : sur une proposition à plusieurs nœuds, un diff brut
 * ne dit pas ce qu'on s'apprête à mettre en production.
 */
export function ProposalReviewModal({
  proposalId,
  onClose,
  onResolved,
}: {
  proposalId: string | null;
  onClose: () => void;
  onResolved?: () => void;
}) {
  const [review, setReview] = React.useState<ProposalReview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [running, setRunning] = React.useState<'apply' | 'discard' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [partial, setPartial] = React.useState(false);
  /** L'écriture n'a produit qu'un brouillon : publier reste un geste à part. */
  const [draftOnly, setDraftOnly] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  /** Point de retour relevé au moment de l'application, pour l'offrir juste après. */
  const [restorePoint, setRestorePoint] = React.useState<{
    versionId: string;
    createdAt: string;
  } | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  /** Retour arrière effectué depuis cette revue : le bouton a fait son office. */
  const [reverted, setReverted] = React.useState(false);
  const [force, setForce] = React.useState(false);
  const { isLocked } = useWorkflowLocks();
  /** Restes déjà supprimés depuis cet écran : la liste vient du serveur, le retrait est local. */
  const [removedLeftovers, setRemovedLeftovers] = React.useState<string[]>([]);
  const [removingLeftover, setRemovingLeftover] = React.useState<string | null>(null);

  React.useEffect(() => {
    setReview(null);
    setError(null);
    setDone(null);
    setPartial(false);
    setDraftOnly(false);
    setRestorePoint(null);
    setReverted(false);
    setForce(false);
    setRemovedLeftovers([]);
    if (!proposalId) return;
    setLoading(true);
    apiGet<ProposalReview>(`/workflow-chat/proposals/${proposalId}`)
      .then(setReview)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [proposalId]);

  /** Réécrit le workflow dans n8n avec une version archivée. */
  const restoreVersion = async (versionId: string, after: () => void) => {
    setRestoring(true);
    setError(null);
    try {
      await apiPost(`/versioning/versions/${versionId}/restore`);
      after();
      onResolved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  };

  const run = async (action: 'apply' | 'discard') => {
    if (!proposalId) return;
    setRunning(action);
    setError(null);
    try {
      if (action === 'apply') {
        const result = await apiPost<{
          syncError?: string;
          draftOnly?: boolean;
          restorePoint: { versionId: string; createdAt: string } | null;
        }>(`/workflow-chat/proposals/${proposalId}/apply`, { force });
        setDraftOnly(Boolean(result.draftOnly));
        setRestorePoint(result.restorePoint);
        // Le demi-succès se dit en clair : n8n a changé, l'historique non.
        setDone(result.syncError ?? 'Appliqué.');
        setPartial(Boolean(result.syncError));
      } else {
        await apiPost(`/workflow-chat/proposals/${proposalId}/discard`);
        setDone('Proposition rejetée.');
      }
      onResolved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const diff = review?.diff;
  const pending = review?.status === 'pending' && !done;
  /** Refus d'intégrité : aucune case ne le lève, le bouton reste éteint. */
  const breaks = (review?.gate.breaches.length ?? 0) > 0;
  const leftovers = (review?.leftovers ?? []).filter(
    (leftover) => !removedLeftovers.includes(leftover.workflowId),
  );
  const parts = review?.parts ?? [];
  /** Un sous-workflow bloqué bloque tout : le geste est indivisible. */
  const partBlocks = parts.some(
    (part) =>
      part.status === 'pending' &&
      (part.gate.breaches.length > 0 || (part.gate.blocked && !force) || part.stale),
  );

  return (
    <Modal
      title="Revue de la modification proposée"
      open={proposalId !== null}
      onCancel={onClose}
      width={860}
      footer={
        <Space>
          <Button onClick={onClose}>Fermer</Button>
          {pending && (
            <>
              <Button danger loading={running === 'discard'} onClick={() => run('discard')}>
                Rejeter
              </Button>
              <Button
                type="primary"
                loading={running === 'apply'}
                disabled={
                  review?.stale ||
                  (!diff?.hasChanges && parts.length === 0) ||
                  breaks ||
                  partBlocks ||
                  (review?.gate.blocked && !force)
                }
                onClick={() => run('apply')}
              >
                Appliquer à {platformName(review?.platform)}
              </Button>
            </>
          )}
        </Space>
      }
    >
      {loading && <Skeleton active />}

      {review && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={review.summary} />

          {/* Une modification qui ne touche QUE des sous-workflows a un diff racine
              vide : sans cette ligne, l'écran s'ouvre sur un « avant/après »
              identique et donne à croire que la proposition est vide. */}
          {!diff?.hasChanges && parts.length > 0 && (
            <Alert type="info" showIcon message={`« ${review.workflowName} » n'est pas modifié`} />
          )}

          {!diff?.hasChanges && parts.length === 0 && (
            <Alert
              type="warning"
              showIcon
              message="Aucune différence"
              description="Les opérations proposées ne changent rien par rapport à l'état actuel du workflow."
            />
          )}

          {/* Une proposition appliquée a elle-même fait bouger le workflow : la dire
              « obsolète » à côté de « déjà appliquée » se contredisait à l'écran. */}
          {review.stale && review.status === 'pending' && (
            <Alert
              type="error"
              showIcon
              message="Proposition obsolète"
              description="Le workflow a changé depuis que cette proposition a été formulée. Relance la demande dans le chat pour repartir de l'état actuel."
            />
          )}

          {review.status !== 'pending' && (
            <Alert
              type={review.status === 'applied' ? 'success' : 'warning'}
              showIcon
              message={review.status === 'applied' ? 'Proposition déjà appliquée' : 'Proposition rejetée'}
              /* Le retour arrière ne vivait que dans le message de succès, le temps de la
                 session : le dégât d'une modification IA se constate souvent le lendemain,
                 dans n8n, et il fallait alors retrouver la bonne ligne de la page Versions. */
              description={
                review.status !== 'applied' ? undefined : reverted ? (
                  <Typography.Text>
                    Workflow restauré dans l&apos;état d&apos;avant cette modification.
                  </Typography.Text>
                ) : review.revertPoint ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {review.revertLosesLaterChanges && (
                      <Typography.Text type="warning">
                        Attention : le workflow a changé dans {platformName(review.platform)} depuis cette
                        application. Revenir en arrière emporterait aussi ce qui a été fait après.
                      </Typography.Text>
                    )}
                    <Popconfirm
                      title="Revenir à l'état d'avant ?"
                      description={`Le workflow sera réécrit dans ${platformName(review.platform)} avec la version du ${new Date(
                        review.revertPoint.createdAt,
                      ).toLocaleString('fr-FR')}. Cette modification sera défaite.`}
                      okText="Restaurer"
                      cancelText="Annuler"
                      onConfirm={() => restoreVersion(review.revertPoint!.versionId, () => setReverted(true))}
                    >
                      <Button size="small" danger loading={restoring}>
                        Revenir à l&apos;état d&apos;avant
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : !diff?.hasChanges && parts.length > 0 ? undefined : (
                  <Typography.Text type="secondary">
                    L&apos;état d&apos;avant n&apos;est pas archivé : le retour arrière se fait à la main dans{' '}
                    {platformName(review.platform)}.
                  </Typography.Text>
                )
              }
            />
          )}

          {/* Un sous-workflow créé pour cette modification et laissé vide : il ne
              se distingue plus d'un workflow ordinaire dans la liste, et rien
              d'autre ne dit d'où il vient. Jamais supprimé d'office — c'est une
              suppression, elle se demande. */}
          {leftovers.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={
                leftovers.length > 1
                  ? `${leftovers.length} sous-workflows créés par l'assistant`
                  : "Sous-workflow créé par l'assistant"
              }
              description={
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Typography.Text type="secondary">
                    Vide et non appelé : supprimer ou garder.
                  </Typography.Text>
                  {leftovers.map((leftover) => (
                    <Space key={leftover.workflowId} wrap>
                      <Typography.Link href={leftover.url} target="_blank" rel="noreferrer">
                        {leftover.name}
                      </Typography.Link>
                      <Popconfirm
                        title="Supprimer ce workflow dans n8n ?"
                        description={`« ${leftover.name} » sera supprimé dans n8n. Il est vide et personne ne l'appelle ; l'opération est définitive.`}
                        okText="Supprimer"
                        cancelText="Annuler"
                        onConfirm={async () => {
                          setRemovingLeftover(leftover.workflowId);
                          setError(null);
                          try {
                            await apiDelete(`/workflow-chat/leftovers/${leftover.workflowId}`);
                            setRemovedLeftovers((known) => [...known, leftover.workflowId]);
                            onResolved?.();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setRemovingLeftover(null);
                          }
                        }}
                      >
                        <Button size="small" danger loading={removingLeftover === leftover.workflowId}>
                          Supprimer dans n8n
                        </Button>
                      </Popconfirm>
                    </Space>
                  ))}
                </Space>
              }
            />
          )}

          {review.workflowActive && pending && (
            <Alert
              type="warning"
              showIcon
              message={`Ce workflow est ACTIF sur ${platformName(review.platform)}`}
              description="La modification part en production dès le prochain déclenchement."
            />
          )}

          {pending &&
            [review.workflowId, ...(review.parts ?? []).map((part) => part.workflowId)].some(isLocked) && (
              <Alert
                type="warning"
                showIcon
                message="Workflow verrouillé"
                description="Appliquer demandera de forcer le verrou, avec une raison."
              />
            )}

          {review.writeEffect && pending && (
            <Alert
              type="warning"
              showIcon
              message="La modification partira en brouillon"
              description={review.writeEffect}
            />
          )}

          <GateAlerts gate={review.gate} pending={Boolean(pending)} force={force} onForce={setForce} />

          {review.warnings.map((warning) => (
            <Alert key={warning} type="warning" showIcon message={warning} />
          ))}

          {review.diff.nameChange && (
            <Alert
              type="warning"
              showIcon
              message={`Renommage du workflow : « ${review.diff.nameChange.before} » → « ${review.diff.nameChange.after} »`}
            />
          )}

          <DiffCounts counts={review.diff.counts} />

          <WorkflowDiffView
            diff={review.diff}
            extraJsonPanels={[
              {
                key: 'operations',
                label: (
                  <Typography.Text type="secondary">
                    Opérations demandées ({review.operations.length})
                  </Typography.Text>
                ),
                children: (
                  <pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
                    {JSON.stringify(review.operations, null, 2)}
                  </pre>
                ),
              },
            ]}
          />

          {parts.length > 0 && (
            <>
              <Typography.Text strong>
                + {parts.length} sous-workflow{parts.length > 1 ? 's' : ''} :{' '}
                {parts.map((part) => part.workflowName).join(', ')}
              </Typography.Text>
              {parts.map((part) => (
                <Card
                  key={part.workflowId}
                  size="small"
                  title={
                    <Space>
                      <Typography.Text strong>{part.workflowName}</Typography.Text>
                      {part.workflowActive && <Tag color="red">actif</Tag>}
                      {part.status === 'applied' && <Tag color="green">déjà écrit</Tag>}
                    </Space>
                  }
                >
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    {part.stale && part.status === 'pending' && (
                      <Alert
                        type="error"
                        showIcon
                        message="Ce sous-workflow a changé dans n8n depuis la proposition"
                        description="L'appliquer écraserait ce changement. Relance la demande dans la conversation pour repartir de l'état actuel."
                      />
                    )}
                    <GateAlerts
                      gate={part.gate}
                      pending={part.status === 'pending' && Boolean(pending)}
                      force={force}
                      onForce={setForce}
                      where={`« ${part.workflowName} »`}
                    />
                    {part.warnings.map((warning) => (
                      <Alert
                        key={`${part.workflowId}-${warning}`}
                        type="warning"
                        showIcon
                        message={warning}
                      />
                    ))}
                    <DiffCounts counts={part.diff.counts} />
                    <WorkflowDiffView
                      diff={part.diff}
                      extraJsonPanels={[
                        {
                          key: `operations-${part.workflowId}`,
                          label: (
                            <Typography.Text type="secondary">
                              Opérations demandées ({part.operations.length})
                            </Typography.Text>
                          ),
                          children: (
                            <pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
                              {JSON.stringify(part.operations, null, 2)}
                            </pre>
                          ),
                        },
                      ]}
                    />
                  </Space>
                </Card>
              ))}
            </>
          )}

          {pending && diff?.hasChanges && !review.restorePoint && (
            <Typography.Text type="warning" strong>
              Aucun point de retour : l&apos;application ne sera pas annulable.
            </Typography.Text>
          )}
        </Space>
      )}

      {done && (
        <Alert
          style={{ marginTop: 12 }}
          type={partial || draftOnly ? 'warning' : 'success'}
          showIcon
          message={done}
          description={
            review && (draftOnly || restorePoint) ? (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {draftOnly && (
                  <Space>
                    <Typography.Text>Non publié.</Typography.Text>
                    <Button
                      size="small"
                      type="primary"
                      loading={publishing}
                      onClick={async () => {
                        setPublishing(true);
                        try {
                          await apiPost(`/workflows/${review.workflowId}/publish`);
                          setDraftOnly(false);
                          setDone('Workflow publié : la version appliquée est celle qui tourne.');
                          onResolved?.();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setPublishing(false);
                        }
                      }}
                    >
                      Publier maintenant
                    </Button>
                  </Space>
                )}
                {/* Le retour arrière se propose ICI, au moment où l'on constate le dégât :
                    le chercher dans la page Versions suppose de savoir qu'il existe. */}
                {restorePoint && (
                  <Popconfirm
                    title="Revenir à l'état d'avant ?"
                    description={`Le workflow sera réécrit dans ${platformName(review?.platform)} avec la version du ${new Date(
                      restorePoint.createdAt,
                    ).toLocaleString('fr-FR')}. La modification qu'on vient d'appliquer sera perdue.`}
                    okText="Restaurer"
                    cancelText="Annuler"
                    onConfirm={() =>
                      restoreVersion(restorePoint.versionId, () => {
                        setRestorePoint(null);
                        setDraftOnly(false);
                        setDone("Workflow restauré dans l'état d'avant l'application.");
                      })
                    }
                  >
                    <Button size="small" danger loading={restoring}>
                      Revenir à l&apos;état d&apos;avant
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ) : undefined
          }
        />
      )}
      {error && <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} />}
    </Modal>
  );
}
