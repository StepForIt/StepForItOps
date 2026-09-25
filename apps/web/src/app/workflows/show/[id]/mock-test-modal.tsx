'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space, Switch, Tag, Tooltip, message } from 'antd';
import { apiGet, apiPost } from '../../../../lib/api';

interface MockCandidate {
  nodeName: string;
  type: string;
  kind: 'email' | 'message' | 'http-write' | 'data-write' | 'sub-workflow';
  reason: string;
  suggested: boolean;
  exemption?: string;
  targetName?: string;
}

interface MockResult {
  copyN8nId?: string;
  pinned: string[];
  stubs: Array<{ calledName: string; stubName: string; stubN8nId: string; reused: boolean }>;
}

const KIND_COLOR: Record<MockCandidate['kind'], string> = {
  email: 'red',
  message: 'volcano',
  'http-write': 'orange',
  'data-write': 'gold',
  'sub-workflow': 'blue',
};

/**
 * Test bouchonné : on choisit ce qui NE doit pas partir. Tout ce qui sort est
 * pré-coché — un envoi réel pendant un essai ne se rattrape pas, alors qu'un
 * bouchon en trop se voit dans le résultat.
 */
export function MockTestModal({
  workflowId,
  n8nUrl,
  open,
  onClose,
}: {
  workflowId: string;
  n8nUrl?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<MockCandidate[] | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [stubSubWorkflows, setStubSubWorkflows] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCandidates(null);
    apiGet<{ candidates: MockCandidate[] }>(`/tester/mock-plan/${workflowId}`)
      .then((plan) => {
        setCandidates(plan.candidates);
        setChecked(plan.candidates.filter((c) => c.suggested).map((c) => c.nodeName));
      })
      .catch((error) => message.error((error as Error).message));
  }, [open, workflowId]);

  const subCalls = (candidates ?? []).filter(
    (c) => c.kind === 'sub-workflow' && !checked.includes(c.nodeName),
  );

  const create = async () => {
    setBusy(true);
    try {
      const result = await apiPost<MockResult>(`/tester/mock/${workflowId}`, {
        nodeNames: checked,
        stubSubWorkflows: stubSubWorkflows && subCalls.length > 0,
      });
      // L'url du workflow finit par son id : la copie vit au même endroit.
      const copyUrl = n8nUrl && result.copyN8nId ? n8nUrl.replace(/[^/]+$/, result.copyN8nId) : undefined;
      message.success({
        content: (
          <span>
            Copie [TEST] créée
            {copyUrl && (
              <>
                {' '}
                <a href={copyUrl} target="_blank" rel="noopener noreferrer">
                  Ouvrir
                </a>
              </>
            )}
          </span>
        ),
        duration: 10,
      });
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tester sans rien envoyer"
      open={open}
      onCancel={onClose}
      width={620}
      footer={
        <Space>
          <Button onClick={onClose}>Annuler</Button>
          <Button type="primary" loading={busy} disabled={candidates === null} onClick={create}>
            Créer la copie [TEST]
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="info" showIcon message="Crée une copie [TEST] ; les nœuds cochés ne partent pas." />

        {candidates?.length === 0 && (
          <Alert type="success" showIcon message="Aucun nœud ne sort du système : rien à bouchonner." />
        )}

        {(candidates ?? []).map((candidate) => (
          <Tooltip key={candidate.nodeName} title={candidate.exemption}>
            <Checkbox
              checked={checked.includes(candidate.nodeName)}
              onChange={(e) =>
                setChecked((current) =>
                  e.target.checked
                    ? [...current, candidate.nodeName]
                    : current.filter((name) => name !== candidate.nodeName),
                )
              }
            >
              <b>{candidate.nodeName}</b> <Tag color={KIND_COLOR[candidate.kind]}>{candidate.reason}</Tag>
              {candidate.targetName && <span style={{ color: '#888' }}>→ {candidate.targetName}</span>}
            </Checkbox>
          </Tooltip>
        ))}

        {subCalls.length > 0 && (
          <Tooltip title="L'appel part vers un workflow vide, dont l'exécution montre ce qui aurait été envoyé.">
            <div>
              <Switch checked={stubSubWorkflows} onChange={setStubSubWorkflows} size="small" /> Rerouter{' '}
              {subCalls.length} sous-workflow(s) vers un bouchon
            </div>
          </Tooltip>
        )}
      </Space>
    </Modal>
  );
}
