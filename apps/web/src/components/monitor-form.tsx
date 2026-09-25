'use client';

import React from 'react';
import { Collapse, Form, Input, InputNumber, Select, Switch } from 'antd';
import type { FormProps } from 'antd';
import { useSelect } from '@refinedev/core';

/** Formulaire commun create/edit d'un Monitor. */
export function MonitorForm({ formProps }: { formProps: FormProps }) {
  const { options: instanceOptions } = useSelect({
    resource: 'instances',
    optionLabel: 'name',
    optionValue: 'id',
  });

  return (
    <Form {...formProps} layout="vertical">
      <Form.Item label="Nom" name="name" rules={[{ required: true }]}>
        <Input placeholder="Sync commandes — heartbeat" />
      </Form.Item>
      <Form.Item label="Type" name="kind" initialValue="heartbeat" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'heartbeat', label: 'Heartbeat (le workflow nous appelle)' },
            { value: 'active', label: 'Actif (on appelle le workflow)' },
            { value: 'error-watch', label: "Erreurs d'exécution (poll API n8n, sans exécution)" },
          ]}
        />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
        {({ getFieldValue }) => {
          const kind = getFieldValue('kind');
          if (kind === 'active') {
            return (
              <>
                <Form.Item label="URL à surveiller" name={['config', 'url']} rules={[{ required: true }]}>
                  <Input placeholder="https://n8n.mondomaine.tld/webhook/health" />
                </Form.Item>
                <Form.Item
                  label="Intervalle (secondes)"
                  name={['config', 'intervalSeconds']}
                  initialValue={300}
                >
                  <InputNumber min={60} step={60} />
                </Form.Item>
              </>
            );
          }
          if (kind === 'error-watch') {
            return (
              <>
                <Form.Item label="Instance n8n" name={['config', 'instanceId']} rules={[{ required: true }]}>
                  <Select placeholder="Choisir l'instance à surveiller" options={instanceOptions} />
                </Form.Item>
                <Form.Item
                  label="Intervalle (secondes)"
                  name={['config', 'intervalSeconds']}
                  initialValue={120}
                >
                  <InputNumber min={60} step={60} />
                </Form.Item>
              </>
            );
          }
          return null;
        }}
      </Form.Item>
      {/* Accessoire : la sonde Kuma est optionnelle (le monitor fonctionne sans). */}
      <Collapse
        ghost
        style={{ marginBottom: 24 }}
        items={[
          {
            key: 'advanced',
            label: 'Options avancées',
            forceRender: true,
            children: (
              <Form.Item
                label="URL push Uptime Kuma (optionnel)"
                name="kumaPushUrl"
                extra="Relaie l'état vers une sonde Uptime Kuma. Laisse vide si tu n'en utilises pas."
              >
                <Input placeholder="https://kuma.mondomaine.tld/api/push/XXXX" />
              </Form.Item>
            ),
          },
        ]}
      />
      <Form.Item label="Activé" name="enabled" valuePropName="checked" initialValue={true}>
        <Switch />
      </Form.Item>
    </Form>
  );
}
