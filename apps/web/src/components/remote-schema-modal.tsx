'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Spin } from 'antd';
import { apiPost } from '../lib/api';
import { RemoteSchemaTables, RemoteTableView, UnlocatableView } from './remote-schema-tables';

interface RunResult {
  report: { tables: RemoteTableView[]; unlocatable: UnlocatableView[] };
  findings: unknown[];
}

interface Props {
  workflowId: string;
  open: boolean;
  onClose: () => void;
  /** Les findings du module viennent d'être réécrits : la liste de la page doit se recharger. */
  onChecked?: () => void;
}

/** « Le distant a-t-il tout ce que ce workflow attend ? », lu sur l'instance du workflow. */
export function RemoteSchemaModal({ workflowId, open, onClose, onChecked }: Props) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = React.useCallback(() => {
    setLoading(true);
    setError(null);
    apiPost<RunResult>(`/remote-schema/run/${workflowId}`, {})
      .then((data) => {
        setResult(data);
        onChecked?.();
      })
      .catch((failure) => setError((failure as Error).message))
      .finally(() => setLoading(false));
  }, [workflowId, onChecked]);

  useEffect(() => {
    if (open && !result && !loading) run();
    // Lancé à l'ouverture seulement : chaque passe crée des workflows temporaires dans n8n.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      title="Tables distantes"
      open={open}
      onCancel={onClose}
      width={860}
      footer={
        <Space>
          <Button loading={loading} onClick={run}>
            Relancer
          </Button>
          <Button type="primary" onClick={onClose}>
            Fermer
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} />}
        {loading && !result ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin tip="Lecture des tables…">
              <div style={{ height: 40 }} />
            </Spin>
          </div>
        ) : (
          result && (
            <RemoteSchemaTables tables={result.report.tables} unlocatable={result.report.unlocatable} />
          )
        )}
      </Space>
    </Modal>
  );
}
