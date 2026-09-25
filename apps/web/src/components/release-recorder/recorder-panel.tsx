'use client';

import React, { useState } from 'react';
import { App, Button, Input, Space, Tag, Tooltip, Typography } from 'antd';
import { CloseOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { GestureModal } from './gesture-modal';
import { useReleaseRecorder } from './release-recorder';
import { InsertMark, StepLine } from './step-line';
import type { StepRun } from './types';

const TODO: StepRun = { state: 'todo' };

/** La procédure en cours : ce qui a été capté, ou ce qui se rejoue, étape par étape — et s'édite sur place. */
export function RecorderPanel({ onHide }: { onHide?: () => void }) {
  const recorder = useReleaseRecorder();
  const { message } = App.useApp();
  const { mode, procedure, hop, runs, busy, frozen } = recorder;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Où ira la prochaine étape ajoutée ; `null` : à la fin (ou au curseur du rejeu).
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [gestureOpen, setGestureOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Au doigt, un appui prolongé : sinon le défilement du tiroir partirait en glisser.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!procedure) return null;

  const steps = procedure.steps;
  const ids = steps.map((step) => step.id);
  const pending = steps.filter((step) => !['done', 'skipped'].includes((runs[step.id] ?? TODO).state));
  const manualLeft = pending.filter((step) => step.kind === 'manual').length;
  const canPlay =
    mode === 'playing' && !busy && pending.length > 0 && (runs[pending[0].id] ?? TODO).state === 'todo';
  const target = insertAt === null ? undefined : Math.max(insertAt, frozen);
  const recorded =
    procedure.sourceEnv && procedure.targetEnv
      ? { source: procedure.sourceEnv, target: procedure.targetEnv }
      : null;

  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await recorder.addManual(draft, target);
      setDraft('');
      setInsertAt(null);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Seules les étapes hors zone figée se glissent ; lâchée sur une étape jouée, elle se range juste derrière.
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const from = ids.indexOf(String(active.id));
    const to = Math.max(ids.indexOf(String(over.id)), frozen);
    if (from < frozen || from === to) return;
    void recorder.reorder(arrayMove(ids, from, to));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(5, 5, 5, 0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Text strong ellipsis style={{ flex: 1 }}>
            {procedure.name}
          </Typography.Text>
          {onHide && (
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onHide} aria-label="Masquer" />
          )}
          {!onHide && mode !== 'recording' && !busy && (
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={recorder.close}
              aria-label="Fermer"
            />
          )}
        </div>
        <Space size={6} style={{ marginTop: 4 }} wrap>
          {mode === 'recording' && <Tag color="red">● Enregistrement</Tag>}
          {mode === 'playing' && hop && (
            <Tag color="blue">
              {hop.source.toUpperCase()} → {hop.target.toUpperCase()}
            </Tag>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {mode === 'playing'
              ? pending.length === 0
                ? 'Terminé'
                : `${pending.length} restantes${manualLeft ? `, dont ${manualLeft} manuelles` : ''}`
              : `${steps.length} étapes`}
          </Typography.Text>
        </Space>
      </div>

      <div style={{ flex: 1 }}>
        {steps.length === 0 && mode === 'recording' && (
          <Typography.Paragraph type="secondary" style={{ padding: 16, margin: 0, fontSize: 13 }}>
            Fais ta mise en ligne normalement : promotions, déclarations d&apos;env et tests s&apos;ajoutent
            ici.
          </Typography.Paragraph>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids.slice(frozen)} strategy={verticalListSortingStrategy}>
            {steps.map((step, index) => (
              <StepLine
                key={step.id}
                step={step}
                index={index}
                run={runs[step.id] ?? TODO}
                locked={index < frozen}
                insertMark={target === index}
                onInsert={(position) => setInsertAt(position)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {target === steps.length && steps.length > 0 && <InsertMark />}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid rgba(5, 5, 5, 0.06)' }}>
        {target !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
            <Typography.Text type="secondary" style={{ flex: 1, fontSize: 12 }}>
              {target < steps.length ? `Insertion avant l'étape ${target + 1}` : 'Insertion à la fin'}
            </Typography.Text>
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setInsertAt(null)}>
              Annuler
            </Button>
          </div>
        )}
        {/* Un vrai formulaire : Entrée valide l'étape, comme dans n'importe quel champ. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Étape manuelle"
              aria-label="Étape manuelle"
            />
            <Button
              htmlType="submit"
              icon={<PlusOutlined />}
              loading={saving}
              disabled={!draft.trim()}
              aria-label="Ajouter"
            />
            <Tooltip title="Ajouter un geste">
              <Button
                icon={<ThunderboltOutlined />}
                onClick={() => setGestureOpen(true)}
                aria-label="Ajouter un geste"
              />
            </Tooltip>
          </Space.Compact>
        </form>
        {mode !== 'viewing' && (
          <div style={{ marginTop: 8 }}>
            {mode === 'recording' ? (
              <Button danger type="primary" block onClick={recorder.stopRecording}>
                Arrêter l&apos;enregistrement
              </Button>
            ) : (
              <Button type="primary" block onClick={recorder.play} disabled={!canPlay} loading={busy}>
                {Object.keys(runs).length === 0 ? 'Lancer' : 'Reprendre'}
              </Button>
            )}
          </div>
        )}
      </div>
      <GestureModal
        open={gestureOpen}
        recorded={recorded}
        replay={mode === 'playing' ? hop : null}
        onClose={() => setGestureOpen(false)}
        onSubmit={async (gesture) => {
          await recorder.addGesture(gesture, target);
          setInsertAt(null);
        }}
      />
    </div>
  );
}
