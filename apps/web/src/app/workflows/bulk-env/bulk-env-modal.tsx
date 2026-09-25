'use client';

import React from 'react';
import { Alert, Button, Modal, Space, Tag, message } from 'antd';
import { apiGet } from '../../../lib/api';
import { WorkflowFamily } from '../workflow-row';
import { BulkEnvReviewTable } from './bulk-env-review-table';
import { BulkEnvSettingsForm } from './bulk-env-settings-form';
import { isApplicable, rowStatus } from './row-status';
import { BulkEnvAction, BulkSettings } from './types';
import { useBulkEnv } from './use-bulk-env';

const TITLES: Record<BulkEnvAction, string> = {
  promote: 'Promouvoir',
  duplicate: 'Dupliquer vers un env',
  mark: 'Déclarer l’env',
};

/** `dev` et `prod` sont les deux bouts obligatoires de la chaîne : les seuls qu'on puisse supposer. */
const DEFAULTS: Record<BulkEnvAction, BulkSettings> = {
  promote: {
    sourceEnv: 'dev',
    targetEnv: 'prod',
    throughChain: true,
    cascade: true,
    checkRemote: true,
    rename: false,
    publishLikeSource: false,
  },
  duplicate: {
    sourceEnv: 'dev',
    // Les envs intermédiaires sont déclarés, pas connus d'avance : c'est à l'humain de choisir.
    targetEnv: '',
    throughChain: true,
    cascade: true,
    checkRemote: false,
    rename: false,
    publishLikeSource: false,
  },
  mark: {
    sourceEnv: null,
    targetEnv: 'dev',
    throughChain: true,
    cascade: false,
    checkRemote: false,
    rename: true,
    publishLikeSource: false,
  },
};

/**
 * Un geste d'environnement joué sur plusieurs workflows métier. Trois temps : on
 * dit une fois d'où et vers où, chaque famille est prévisualisée par la route de
 * son geste, puis la revue sépare ce qui part d'un clic de ce qui demande un
 * regard. Rien n'est écrit avant « Appliquer », et une ligne refusée par n8n
 * n'arrête pas les suivantes.
 */
export function BulkEnvModal({
  action,
  families,
  open,
  onClose,
  onApplied,
}: {
  action: BulkEnvAction;
  families: WorkflowFamily[];
  open: boolean;
  onClose: () => void;
  /** Au moins une ligne est passée : la liste se recharge. */
  onApplied: () => void;
}) {
  const bulk = useBulkEnv(action);
  const [settings, setSettings] = React.useState<BulkSettings>(DEFAULTS[action]);
  const [instances, setInstances] = React.useState<Array<{ id: string; name: string }>>([]);

  React.useEffect(() => {
    if (!open) return;
    setSettings(DEFAULTS[action]);
    bulk.reset();
    apiGet<Array<{ id: string; name: string }>>('/instances?_start=0&_end=100')
      .then(setInstances)
      .catch((error) => message.error((error as Error).message));
    // `bulk.reset` est stable dans l'intention : on ne réinitialise qu'à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  const counts = {
    ready: bulk.rows.filter(isApplicable).length,
    decide: bulk.rows.filter((row) => rowStatus(row) === 'decide').length,
    blocked: bulk.rows.filter((row) => rowStatus(row) === 'blocked').length,
    skipped: bulk.rows.filter((row) => rowStatus(row) === 'skipped').length,
    loading: bulk.rows.filter((row) => rowStatus(row) === 'loading').length,
    done: bulk.rows.filter((row) => row.outcome.state === 'done').length,
    failed: bulk.rows.filter((row) => row.outcome.state === 'failed').length,
  };
  // Les lignes dont la seule décision est de relire le diff : on les valide ensemble une fois relues.
  const diffOnly = bulk.rows.filter(
    (row) =>
      rowStatus(row) === 'decide' &&
      row.preview?.data.readiness.decisions.every((decision) => decision.code === 'diff'),
  );
  // Seuls les compteurs non nuls s'affichent : « 3 prêtes · 1 bloquée ».
  const tally = [
    { count: counts.ready, one: 'prête', many: 'prêtes', color: 'green' },
    { count: counts.decide, one: 'à décider', many: 'à décider', color: 'orange' },
    { count: counts.blocked, one: 'bloquée', many: 'bloquées', color: 'red' },
    { count: counts.skipped, one: 'ignorée', many: 'ignorées', color: 'default' },
    { count: counts.done, one: 'appliquée', many: 'appliquées', color: 'blue' },
    { count: counts.failed, one: 'en échec', many: 'en échec', color: 'volcano' },
  ].filter((item) => item.count > 0);
  const busy = bulk.phase === 'planning' || bulk.phase === 'applying';
  const canPrepare = Boolean(settings.targetEnv) && (action === 'mark' || Boolean(settings.sourceEnv));

  const apply = async () => {
    await bulk.apply(bulk.rows);
    onApplied();
  };

  const footer =
    bulk.phase === 'setup' || bulk.phase === 'planning' ? (
      <Space>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          type="primary"
          loading={bulk.phase === 'planning'}
          disabled={!canPrepare}
          onClick={() =>
            bulk.prepare(
              families.map((family) => family.id),
              settings,
            )
          }
        >
          Préparer le lot
        </Button>
      </Space>
    ) : (
      <Space wrap>
        <Button onClick={bulk.reset} disabled={busy}>
          Changer les réglages
        </Button>
        {diffOnly.length > 0 && (
          <Button
            disabled={busy}
            onClick={() =>
              diffOnly.forEach((row) => bulk.setChoices(row.plan.familyKey, { validated: true }))
            }
          >
            Valider {diffOnly.length} diff{diffOnly.length > 1 ? 's' : ''}
          </Button>
        )}
        <Button onClick={onClose} disabled={bulk.phase === 'applying'}>
          Fermer
        </Button>
        <Button
          type="primary"
          loading={bulk.phase === 'applying'}
          disabled={counts.ready === 0 || counts.loading > 0 || busy}
          onClick={apply}
        >
          Appliquer {counts.ready} ligne{counts.ready > 1 ? 's' : ''} prête{counts.ready > 1 ? 's' : ''}
        </Button>
      </Space>
    );

  return (
    <Modal
      open={open}
      title={`${TITLES[action]} — ${families.length} workflow${families.length > 1 ? 's' : ''} métier`}
      width={1100}
      onCancel={bulk.phase === 'applying' ? undefined : onClose}
      maskClosable={false}
      closable={bulk.phase !== 'applying'}
      footer={footer}
      destroyOnClose
    >
      {bulk.error && <Alert type="error" showIcon message={bulk.error} style={{ marginBottom: 16 }} />}
      {bulk.phase === 'setup' || bulk.phase === 'planning' ? (
        <BulkEnvSettingsForm action={action} value={settings} onChange={setSettings} instances={instances} />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {tally.length > 0 && (
            <Space size={4} wrap>
              {tally.map((item) => (
                <Tag key={item.one} color={item.color}>
                  {item.count} {item.count > 1 ? item.many : item.one}
                </Tag>
              ))}
            </Space>
          )}
          <BulkEnvReviewTable
            rows={bulk.rows}
            locked={bulk.phase === 'applying'}
            onChoices={bulk.setChoices}
            onRefresh={(row) => void bulk.refreshPreview(row)}
          />
        </Space>
      )}
    </Modal>
  );
}
