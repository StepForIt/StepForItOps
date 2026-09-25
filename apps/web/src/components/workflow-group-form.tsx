'use client';

import React, { useEffect, useState } from 'react';
import { Form, Input, Select } from 'antd';
import type { FormProps } from 'antd';
import { apiGet } from '../lib/api';
import { GroupMemberPicker } from './group-member-picker';

interface InstanceRow {
  id: string;
  name: string;
}

/** Formulaire groupe : instance, nom, sélection multiple de workflows membres. */
export function WorkflowGroupForm({ formProps }: { formProps: FormProps }) {
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const instanceId = Form.useWatch<string | undefined>('instanceId', formProps.form);

  useEffect(() => {
    apiGet<InstanceRow[]>('/instances?_start=0&_end=100')
      .then(setInstances)
      .catch(() => setInstances([]));
  }, []);

  return (
    <Form {...formProps} layout="vertical">
      <Form.Item label="Instance" name="instanceId" rules={[{ required: true }]} style={{ maxWidth: 320 }}>
        <Select
          options={instances.map((i) => ({ value: i.id, label: i.name }))}
          onChange={() => formProps.form?.setFieldsValue({ workflowIds: [] })}
        />
      </Form.Item>
      <Form.Item label="Nom du groupe" name="name" rules={[{ required: true }]} style={{ maxWidth: 320 }}>
        <Input placeholder="Facturation, CRM, Onboarding…" />
      </Form.Item>
      <Form.Item
        label="Workflows membres"
        name="workflowIds"
        extra="Une ligne par workflow métier : cocher le nom prend tous ses environnements. Un workflow peut appartenir à plusieurs groupes."
      >
        <GroupMemberPicker instanceId={instanceId} />
      </Form.Item>
    </Form>
  );
}
