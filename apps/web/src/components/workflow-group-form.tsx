'use client';

import React, { useEffect, useState } from 'react';
import { Form, Input, Select } from 'antd';
import type { FormProps } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet } from '../lib/api';
import { GroupMemberPicker } from './group-member-picker';

interface InstanceRow {
  id: string;
  name: string;
}

/** Formulaire groupe : instance, nom, sélection multiple de workflows membres. */
export function WorkflowGroupForm({ formProps }: { formProps: FormProps }) {
  const t = useTranslations('settings.workflowGroupForm');
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const instanceId = Form.useWatch<string | undefined>('instanceId', formProps.form);

  useEffect(() => {
    apiGet<InstanceRow[]>('/instances?_start=0&_end=100')
      .then(setInstances)
      .catch(() => setInstances([]));
  }, []);

  return (
    <Form {...formProps} layout="vertical">
      <Form.Item
        label={t('instance')}
        name="instanceId"
        rules={[{ required: true }]}
        style={{ maxWidth: 320 }}
      >
        <Select
          options={instances.map((i) => ({ value: i.id, label: i.name }))}
          onChange={() => formProps.form?.setFieldsValue({ workflowIds: [] })}
        />
      </Form.Item>
      <Form.Item label={t('name')} name="name" rules={[{ required: true }]} style={{ maxWidth: 320 }}>
        <Input placeholder={t('namePlaceholder')} />
      </Form.Item>
      <Form.Item label={t('members')} name="workflowIds" extra={t('membersHint')}>
        <GroupMemberPicker instanceId={instanceId} />
      </Form.Item>
    </Form>
  );
}
