'use client';

import React, { useEffect, useState } from 'react';
import { Form, Input, Modal, Select, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('inventory.workflowMap.linkModal');
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
      title={editing ? t('editTitle') : t('addTitle')}
      open={open}
      onOk={submit}
      confirmLoading={saving}
      onCancel={onCancel}
      okText={editing ? t('save') : t('add')}
      cancelText={t('cancel')}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {t.rich('intro', { tag: (chunks) => <Tag>{chunks}</Tag> })}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="fromWorkflowId"
          label={t('from')}
          rules={[{ required: true, message: t('fromRequired') }]}
        >
          <Select showSearch optionFilterProp="label" options={options} disabled={editing !== null} />
        </Form.Item>
        <Form.Item
          name="toWorkflowId"
          label={t('to')}
          dependencies={['fromWorkflowId']}
          rules={[
            { required: true, message: t('toRequired') },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                value && value === getFieldValue('fromWorkflowId')
                  ? Promise.reject(new Error(t('self')))
                  : Promise.resolve(),
            }),
          ]}
        >
          <Select showSearch optionFilterProp="label" options={options} disabled={editing !== null} />
        </Form.Item>
        <Form.Item name="label" label={t('label')}>
          <Input placeholder={t('labelPlaceholder')} maxLength={80} />
        </Form.Item>
        <Form.Item name="note" label={t('note')}>
          <Input.TextArea rows={2} placeholder={t('notePlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
