'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { App, Checkbox, Form, Input, Modal, Select, Space } from 'antd';
import { apiGet } from '../../lib/api';
import { useEnvs } from '../../lib/envs';
import { unshiftEnv } from './procedure-edit';
import { useReleaseRecorder } from './release-recorder';
import { TARGETLESS, type EnvHop, type GestureDraft, type MacroAction, type ProcedureStep } from './types';

const ACTIONS: Array<{ value: MacroAction; label: string }> = [
  { value: 'promote', label: 'Promouvoir' },
  { value: 'duplicate', label: 'Dupliquer vers un env' },
  { value: 'mark', label: "Déclarer l'env" },
  { value: 'switch', label: 'Rebrancher les ressources' },
  { value: 'run-tests', label: 'Jouer les tests' },
  { value: 'publish', label: 'Publier' },
];

/** Les réglages rejouables de chaque geste, avec les défauts du rejeu (`playAutoStep`). */
const OPTIONS: Record<MacroAction, Array<{ key: string; label: string; initial: boolean }>> = {
  promote: [
    { key: 'throughChain', label: 'Via envs intermédiaires', initial: true },
    { key: 'cascade', label: 'Créer les sous-workflows manquants', initial: true },
    { key: 'checkRemote', label: 'Vérifier les tables distantes', initial: false },
    { key: 'publishLikeSource', label: 'Publier comme la source', initial: false },
  ],
  duplicate: [{ key: 'cascade', label: 'Créer les sous-workflows manquants', initial: true }],
  mark: [{ key: 'rename', label: 'Suffixer le nom', initial: false }],
  switch: [],
  'run-tests': [],
  publish: [],
};

interface Family {
  id: string;
  name: string;
}

interface Values {
  action: MacroAction;
  family?: string;
  sourceEnv?: string;
  targetEnv?: string;
  note?: string;
  options: string[];
}

const initialOptions = (action: MacroAction) =>
  OPTIONS[action].filter((option) => option.initial).map((option) => option.key);

/**
 * Un geste rejouable posé à la main, sans l'avoir fait dans la console — ou celui d'une
 * étape existante, refait (`step`). Les envs se saisissent tels qu'on les lit à l'écran —
 * ceux du rejeu quand il tourne — et partent à l'API dans les termes de l'enregistrement (`unshiftEnv`).
 */
export function GestureModal({
  open,
  recorded,
  replay,
  step,
  onSubmit,
  onClose,
}: {
  open: boolean;
  recorded: EnvHop | null;
  replay: EnvHop | null;
  step?: ProcedureStep;
  onSubmit: (gesture: GestureDraft) => Promise<void>;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { shift } = useReleaseRecorder();
  const { envs } = useEnvs();
  const [form] = Form.useForm<Values>();
  const action = Form.useWatch('action', form) ?? 'promote';
  const [families, setFamilies] = useState<Family[]>([]);
  const [search, setSearch] = useState('');
  // Le choix est gardé à part : une nouvelle recherche peut le sortir de la liste.
  const [picked, setPicked] = useState<Family | null>(null);
  const [saving, setSaving] = useState(false);
  const envIds = useMemo(() => envs.map((env) => env.id), [envs]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : '';
      apiGet<Family[]>(`/workflows/families?_start=0&_end=30${q}`, controller.signal)
        .then(setFamilies)
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  const familyOptions = [
    ...(picked && !families.some((family) => family.id === picked.id) ? [picked] : []),
    ...families,
  ].map((family) => ({ value: family.id, label: family.name }));

  // Au rejeu, un env qui ne s'écrit pas dans les termes de l'enregistrement ne se propose pas.
  const envOptions = (target: boolean) =>
    envs
      .filter((env) => unshiftEnv(env.id, target ? action : null, envIds, recorded, replay) !== null)
      .map((env) => ({ value: env.id, label: env.label }));

  const submit = async (values: Values) => {
    const family = picked?.id === values.family ? picked : null;
    if (!family) return;
    const back = (env: string | undefined, target: boolean) =>
      env ? unshiftEnv(env, target ? values.action : null, envIds, recorded, replay) : null;
    setSaving(true);
    try {
      await onSubmit({
        action: values.action,
        familyKey: family.id,
        familyName: family.name,
        sourceEnv: back(values.sourceEnv, false),
        targetEnv: TARGETLESS.has(values.action) ? null : back(values.targetEnv, true),
        options: Object.fromEntries(
          OPTIONS[values.action].map((option) => [option.key, (values.options ?? []).includes(option.key)]),
        ),
        note: values.note ?? null,
      });
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={step ? 'Modifier le geste' : 'Ajouter un geste'}
      okText={step ? 'Enregistrer' : 'Ajouter'}
      onOk={form.submit}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnClose
      afterOpenChange={(visible) => {
        if (!visible) return;
        form.resetFields();
        setSearch('');
        setPicked(null);
        if (step?.action && step.familyKey) {
          const action = step.action;
          setPicked({ id: step.familyKey, name: step.familyName ?? step.familyKey });
          form.setFieldsValue({
            action,
            family: step.familyKey,
            sourceEnv: shift(step.sourceEnv) ?? undefined,
            targetEnv: shift(step.targetEnv, step) ?? undefined,
            // Un réglage absent de l'étape se rejoue avec son défaut : on le montre tel.
            options: OPTIONS[action]
              .filter((option) => step.options?.[option.key] ?? option.initial)
              .map((option) => option.key),
            note: step.note ?? undefined,
          });
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{ action: 'promote', options: initialOptions('promote') }}
        onValuesChange={(changed: Partial<Values>) => {
          if (changed.action) form.setFieldsValue({ options: initialOptions(changed.action) });
        }}
      >
        <Form.Item name="action" label="Geste">
          <Select options={ACTIONS} />
        </Form.Item>
        <Form.Item
          name="family"
          label="Workflow"
          rules={[{ required: true, message: 'Choisis un workflow' }]}
        >
          <Select
            showSearch
            filterOption={false}
            onSearch={setSearch}
            onChange={(id: string) => setPicked(families.find((family) => family.id === id) ?? null)}
            placeholder="Rechercher"
            options={familyOptions}
          />
        </Form.Item>
        <Space style={{ display: 'flex' }} align="start">
          <Form.Item
            name="sourceEnv"
            label={
              TARGETLESS.has(action)
                ? 'Sur'
                : action === 'mark'
                  ? 'Env actuel'
                  : action === 'switch'
                    ? 'Exemplaire'
                    : 'Depuis'
            }
            rules={[{ required: action !== 'mark', message: 'Obligatoire' }]}
          >
            <Select style={{ width: 150 }} options={envOptions(false)} allowClear={action === 'mark'} />
          </Form.Item>
          {!TARGETLESS.has(action) && (
            <Form.Item
              name="targetEnv"
              label={action === 'mark' ? 'Déclarer en' : action === 'switch' ? 'Données de' : 'Vers'}
              rules={[{ required: true, message: 'Obligatoire' }]}
            >
              <Select style={{ width: 150 }} options={envOptions(true)} />
            </Form.Item>
          )}
        </Space>
        {OPTIONS[action].length > 0 && (
          <Form.Item name="options">
            <Checkbox.Group
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
              options={OPTIONS[action].map((option) => ({ value: option.key, label: option.label }))}
            />
          </Form.Item>
        )}
        <Form.Item name="note" label="Note" style={{ marginBottom: 0 }}>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} placeholder="Facultatif" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
