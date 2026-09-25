'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Modal, Space, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { apiDelete, apiGet, apiPut, setLockOverrideHandler } from '../api';
import { LockedWorkflow, lockReasonError } from './lock-override';

export interface WorkflowLock {
  workflowId: string;
  lockedBy: string | null;
  note: string | null;
  lockedAt: string;
}

interface WorkflowLocksValue {
  isLocked: (workflowId: string) => boolean;
  lockOf: (workflowId: string) => WorkflowLock | undefined;
  lock: (workflowId: string, note?: string) => Promise<void>;
  unlock: (workflowId: string) => Promise<void>;
  refresh: () => void;
}

const WorkflowLocksContext = createContext<WorkflowLocksValue>({
  isLocked: () => false,
  lockOf: () => undefined,
  lock: async () => undefined,
  unlock: async () => undefined,
  refresh: () => undefined,
});

export function useWorkflowLocks(): WorkflowLocksValue {
  return useContext(WorkflowLocksContext);
}

interface PendingAsk {
  locked: LockedWorkflow[];
  resolve: (reason: string | null) => void;
}

/**
 * Les verrous, servis une fois pour toute la console (une table courte : les
 * listes y lisent leur cadenas sans une requête par ligne), et la modale de
 * forçage que tout refus 423 ouvre, d'où qu'il vienne.
 */
export function WorkflowLocksProvider({ children }: { children: React.ReactNode }) {
  const [locks, setLocks] = useState<Map<string, WorkflowLock>>(new Map());
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const [reason, setReason] = useState('');
  // Deux refus simultanés passent l'un après l'autre : une modale, une décision.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(() => {
    apiGet<WorkflowLock[]>('/workflow-locks')
      .then((rows) => setLocks(new Map(rows.map((row) => [row.workflowId, row]))))
      .catch(() => undefined);
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(
    () =>
      setLockOverrideHandler((locked) => {
        const asked = queue.current.then(
          () =>
            new Promise<string | null>((resolve) => {
              setReason('');
              setPending({ locked, resolve });
            }),
        );
        queue.current = asked;
        return asked;
      }),
    [],
  );

  const answer = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  const value = useMemo<WorkflowLocksValue>(
    () => ({
      isLocked: (workflowId) => locks.has(workflowId),
      lockOf: (workflowId) => locks.get(workflowId),
      lock: async (workflowId, note) => {
        await apiPut(`/workflow-locks/${workflowId}`, { note });
        refresh();
      },
      unlock: async (workflowId) => {
        await apiDelete(`/workflow-locks/${workflowId}`);
        refresh();
      },
      refresh,
    }),
    [locks, refresh],
  );

  const error = lockReasonError(reason);
  const names = pending?.locked ?? [];

  return (
    <WorkflowLocksContext.Provider value={value}>
      {children}
      <Modal
        open={pending !== null}
        title={
          <Space>
            <LockOutlined />
            {names.length > 1 ? 'Workflows verrouillés' : 'Workflow verrouillé'}
          </Space>
        }
        okText="Forcer l’écriture"
        okButtonProps={{ danger: true, disabled: error !== null }}
        cancelText="Renoncer"
        onOk={() => answer(reason.trim())}
        onCancel={() => answer(null)}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {names.map((workflow) => (
            <Typography.Text key={workflow.id}>
              « {workflow.name} »
              {workflow.lockedBy ? (
                <Typography.Text type="secondary"> · verrouillé par {workflow.lockedBy}</Typography.Text>
              ) : null}
            </Typography.Text>
          ))}
          <Typography.Text type="secondary">
            Ce geste va le modifier. Le verrou reste en place après, et le forçage est journalisé.
          </Typography.Text>
          <Input.TextArea
            autoFocus
            rows={3}
            maxLength={500}
            placeholder="Raison (obligatoire)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Space>
      </Modal>
    </WorkflowLocksContext.Provider>
  );
}
