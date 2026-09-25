'use client';

import React, { useEffect, useState } from 'react';
import { Form, Input, Modal, Select, Tag, Typography } from 'antd';
import type { WorkflowMapLink, WorkflowMapNode } from './types';

export interface WorkflowLinkFormValues {
  fromWorkflowId: string;
  toWorkflowId: string;
  label?: string;
  note?: string;
}

interface Props {
  open: boolean;
  workflows: WorkflowMapNode[];
  /** Lien en cours de modification ; null = création. */
  editing: WorkflowMapLink | null;
  onCancel: () => void;
  onSubmit: (values: WorkflowLinkFormValues) => Promise<void>;
}

/** Création / modification d'un lien manuel entre deux workflows. */
export function WorkflowLinkModal({ open, workflows, editing, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<WorkflowLinkFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      fromWorkflowId: editing?.fromId,
      toWorkflowId: editing?.toId,
      label: editing?.label ?? '',
      note: editing?.note ?? '',
    });
  }, [open, editing, form]);

  const options = workflows.map((workflow) => ({
    value: workflow.id,
    label: workflow.name,
    title: workflow.name,
  }));

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Modifier le lien' : 'Ajouter un lien entre deux workflows'}
      open={open}
      onOk={submit}
      confirmLoading={saving}
      onCancel={onCancel}
      okText={editing ? 'Enregistrer' : 'Ajouter'}
      cancelText="Annuler"
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Un lien manuel décrit un enchaînement que le JSON n&apos;expose pas : <Tag>A</Tag> déclenche{' '}
        <Tag>B</Tag> via un outil tiers, ou doit tourner avant lui.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="fromWorkflowId"
          label="Workflow de départ"
          rules={[{ required: true, message: 'Choisis le workflow de départ' }]}
        >
          <Select showSearch optionFilterProp="label" options={options} disabled={editing !== null} />
        </Form.Item>
        <Form.Item
          name="toWorkflowId"
          label="Workflow d'arrivée"
          dependencies={['fromWorkflowId']}
          rules={[
            { required: true, message: 'Choisis le workflow d’arrivée' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                value && value === getFieldValue('fromWorkflowId')
                  ? Promise.reject(new Error('Un workflow ne peut pas se lier à lui-même'))
                  : Promise.resolve(),
            }),
          ]}
        >
          <Select showSearch optionFilterProp="label" options={options} disabled={editing !== null} />
        </Form.Item>
        <Form.Item name="label" label="Libellé (affiché sur la flèche)">
          <Input placeholder="ex : envoie la facture validée" maxLength={80} />
        </Form.Item>
        <Form.Item name="note" label="Note (visible en vue tableau)">
          <Input.TextArea
            rows={2}
            placeholder="Précision utile : condition, fréquence, contrainte d'ordre…"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
