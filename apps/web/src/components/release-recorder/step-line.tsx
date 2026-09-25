'use client';

import React, { useState } from 'react';
import { App, Button, Dropdown, MenuProps, Space, Tooltip, Typography } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  HolderOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  MoreOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GestureModal } from './gesture-modal';
import { moveStep } from './procedure-edit';
import { useReleaseRecorder } from './release-recorder';
import { stepText } from './replay';
import type { ProcedureStep, StepRun } from './types';

const NOTE_MAX = 2000;

/**
 * Une étape de la procédure : son état au rejeu, et son édition — glisser par la poignée,
 * ou le menu `···` (monter, descendre, insérer, note, renommer ou refaire le geste, supprimer).
 * Une étape `locked` a déjà été jouée : seule sa note se modifie encore.
 */
export function StepLine({
  step,
  index,
  run,
  locked,
  insertMark,
  onInsert,
}: {
  step: ProcedureStep;
  index: number;
  run: StepRun;
  locked: boolean;
  insertMark: boolean;
  onInsert: (position: number) => void;
}) {
  const recorder = useReleaseRecorder();
  const { modal, message } = App.useApp();
  const [editing, setEditing] = useState<'label' | 'note' | null>(null);
  const [gestureOpen, setGestureOpen] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.id, disabled: locked });
  const auto = step.kind === 'auto';
  const done = run.state === 'done' || run.state === 'skipped';
  const text = stepText(step, recorder.shift);
  const ids = recorder.procedure?.steps.map((row) => row.id) ?? [];
  const up = moveStep(ids, step.id, -1, recorder.frozen);
  const down = moveStep(ids, step.id, 1, recorder.frozen);

  const guard = (action: Promise<void>) =>
    action.catch((error: Error) => {
      message.error(error.message);
    });

  const confirmRemove = () =>
    modal.confirm({
      title: 'Supprimer cette étape ?',
      content: `${index + 1}. ${text}`,
      okText: 'Supprimer',
      okButtonProps: { danger: true },
      cancelText: 'Annuler',
      onOk: () => guard(recorder.removeStep(step.id)),
    });

  const items: MenuProps['items'] = [
    ...(locked
      ? []
      : [
          { key: 'up', label: 'Monter', disabled: !up, onClick: () => up && guard(recorder.reorder(up)) },
          {
            key: 'down',
            label: 'Descendre',
            disabled: !down,
            onClick: () => down && guard(recorder.reorder(down)),
          },
          { key: 'before', label: 'Insérer avant', onClick: () => onInsert(index) },
        ]),
    ...(!locked || index === recorder.frozen - 1
      ? [{ key: 'after', label: 'Insérer après', onClick: () => onInsert(index + 1) }]
      : []),
    {
      key: 'note',
      label: step.note ? 'Modifier la note' : 'Ajouter une note',
      onClick: () => setEditing('note'),
    },
    ...(!auto && !locked ? [{ key: 'label', label: 'Renommer', onClick: () => setEditing('label') }] : []),
    ...(auto && !locked && step.action
      ? [{ key: 'gesture', label: 'Modifier le geste', onClick: () => setGestureOpen(true) }]
      : []),
    ...(locked
      ? []
      : [
          { type: 'divider' as const },
          { key: 'remove', label: 'Supprimer', danger: true, onClick: confirmRemove },
        ]),
  ];

  const procedure = recorder.procedure;
  const recorded =
    procedure?.sourceEnv && procedure.targetEnv
      ? { source: procedure.sourceEnv, target: procedure.targetEnv }
      : null;

  const save = (patch: { label?: string; note?: string | null }) => {
    setEditing(null);
    const unchanged =
      patch.label !== undefined
        ? patch.label.trim() === step.label
        : (patch.note?.trim() || null) === step.note;
    if (unchanged || (patch.label !== undefined && !patch.label.trim())) return;
    void guard(recorder.updateStep(step.id, patch));
  };

  return (
    <>
      {insertMark && <InsertMark />}
      <div
        ref={setNodeRef}
        style={{
          padding: '10px 12px 10px 4px',
          borderBottom: '1px solid rgba(5, 5, 5, 0.04)',
          background: isDragging ? 'var(--ant-color-bg-container, #fff)' : undefined,
          boxShadow: isDragging ? '0 4px 12px rgba(0, 0, 0, 0.12)' : undefined,
          position: 'relative',
          zIndex: isDragging ? 1 : undefined,
          transform: CSS.Transform.toString(transform),
          transition,
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span
            ref={setActivatorNodeRef}
            {...(locked ? {} : { ...attributes, ...listeners })}
            aria-label={locked ? undefined : "Déplacer l'étape"}
            style={{
              width: 14,
              paddingTop: 2,
              color: '#bfbfbf',
              cursor: locked ? 'default' : 'grab',
              touchAction: 'none',
              visibility: locked ? 'hidden' : undefined,
            }}
          >
            <HolderOutlined />
          </span>
          <Tooltip title={auto ? 'Automatique' : 'Manuelle'}>
            <span style={{ color: auto ? '#1677ff' : '#d48806', paddingTop: 2 }}>
              {auto ? <ThunderboltOutlined /> : <UserOutlined />}
            </span>
          </Tooltip>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing === 'label' ? (
              <Typography.Text
                style={{ fontSize: 13 }}
                editable={{
                  editing: true,
                  text: step.label,
                  onChange: (label) => save({ label }),
                  onCancel: () => setEditing(null),
                  triggerType: ['text'],
                }}
              >
                {step.label}
              </Typography.Text>
            ) : (
              <Typography.Text
                delete={run.state === 'skipped'}
                type={done ? 'secondary' : undefined}
                style={{ fontSize: 13 }}
              >
                {index + 1}. {text}
              </Typography.Text>
            )}
            {editing === 'note' ? (
              <Typography.Paragraph
                style={{ fontSize: 12, margin: '4px 0 0' }}
                editable={{
                  editing: true,
                  text: step.note ?? '',
                  maxLength: NOTE_MAX,
                  autoSize: { minRows: 1, maxRows: 6 },
                  onChange: (note) => save({ note }),
                  onCancel: () => setEditing(null),
                  triggerType: ['text'],
                }}
              >
                {step.note ?? ''}
              </Typography.Paragraph>
            ) : (
              step.note && (
                <Typography.Paragraph
                  type="secondary"
                  style={{ fontSize: 12, margin: '2px 0 0', whiteSpace: 'pre-wrap', cursor: 'text' }}
                  onClick={() => setEditing('note')}
                >
                  {step.note}
                </Typography.Paragraph>
              )
            )}
          </div>
          <StepStatus run={run} />
          <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
            <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Modifier l'étape" />
          </Dropdown>
        </div>

        {run.state === 'done' && run.summary && (
          <div style={{ marginLeft: 44, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {run.summary}
            </Typography.Text>
            {run.redo && (
              <Button
                size="small"
                type="link"
                style={{ padding: 0, height: 'auto', fontSize: 12 }}
                onClick={() => recorder.redo(step.id)}
              >
                Refaire quand même
              </Button>
            )}
          </div>
        )}
        {run.state === 'waiting' && (
          <div style={{ marginLeft: 44, marginTop: 6 }}>
            {run.decisions?.map((decision) => (
              <div key={decision} style={{ fontSize: 12, color: '#d48806' }}>
                {decision}
              </div>
            ))}
            <Button
              size="small"
              type="primary"
              style={{ marginTop: 6 }}
              onClick={() => recorder.validate(step.id)}
            >
              {run.resume ? 'Appliquer quand même' : 'Fait'}
            </Button>
          </div>
        )}
        {run.state === 'failed' && (
          <div style={{ marginLeft: 44, marginTop: 6 }}>
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {run.error}
            </Typography.Text>
            <Space size={6} style={{ display: 'flex', marginTop: 6 }}>
              <Button size="small" onClick={() => recorder.retry(step.id)}>
                Réessayer
              </Button>
              <Button size="small" type="text" onClick={() => recorder.skip(step.id)}>
                Passer
              </Button>
            </Space>
          </div>
        )}
      </div>
      {auto && (
        <GestureModal
          open={gestureOpen}
          step={step}
          recorded={recorded}
          replay={recorder.mode === 'playing' ? recorder.hop : null}
          onClose={() => setGestureOpen(false)}
          onSubmit={(gesture) => recorder.updateGesture(step.id, gesture)}
        />
      )}
    </>
  );
}

/** Le repère d'insertion : là où partira la prochaine étape ajoutée. */
export function InsertMark() {
  return <div aria-hidden style={{ height: 2, margin: '0 16px', background: '#1677ff', borderRadius: 1 }} />;
}

function StepStatus({ run }: { run: StepRun }) {
  switch (run.state) {
    case 'running':
      return <LoadingOutlined />;
    case 'done':
      return <CheckCircleFilled style={{ color: '#52c41a' }} aria-label="Fait" />;
    case 'failed':
      return <CloseCircleFilled style={{ color: '#ff4d4f' }} aria-label="Échec" />;
    case 'skipped':
      return <MinusCircleOutlined style={{ color: '#bfbfbf' }} aria-label="Passée" />;
    default:
      return null;
  }
}
