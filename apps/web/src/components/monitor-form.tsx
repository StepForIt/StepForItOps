'use client';

import React from 'react';
import { Collapse, Form, Input, InputNumber, Select, Switch } from 'antd';
import type { FormProps } from 'antd';
import { useSelect } from '@refinedev/core';
import { useTranslations } from 'next-intl';

/** Formulaire commun create/edit d'un Monitor. */
export function MonitorForm({ formProps }: { formProps: FormProps }) {
  const t = useTranslations('settings.monitorForm');
  const { options: instanceOptions } = useSelect({
    resource: 'instances',
    optionLabel: 'name',
    optionValue: 'id',
  });

  return (
    <Form {...formProps} layout="vertical">
      <Form.Item label={t('name')} name="name" rules={[{ required: true }]}>
        <Input placeholder={t('namePlaceholder')} />
      </Form.Item>
      <Form.Item label={t('kind')} name="kind" initialValue="heartbeat" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'heartbeat', label: t('kindHeartbeat') },
            { value: 'active', label: t('kindActive') },
            { value: 'error-watch', label: t('kindErrorWatch') },
          ]}
        />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
        {({ getFieldValue }) => {
          const kind = getFieldValue('kind');
          if (kind === 'active') {
            return (
              <>
                <Form.Item label={t('url')} name={['config', 'url']} rules={[{ required: true }]}>
                  <Input placeholder="https://n8n.mondomaine.tld/webhook/health" />
                </Form.Item>
                <Form.Item label={t('interval')} name={['config', 'intervalSeconds']} initialValue={300}>
                  <InputNumber min={60} step={60} />
                </Form.Item>
              </>
            );
          }
          if (kind === 'error-watch') {
            return (
              <>
                <Form.Item label={t('instance')} name={['config', 'instanceId']} rules={[{ required: true }]}>
                  <Select placeholder={t('instancePlaceholder')} options={instanceOptions} />
                </Form.Item>
                <Form.Item label={t('interval')} name={['config', 'intervalSeconds']} initialValue={120}>
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
            label: t('advanced'),
            forceRender: true,
            children: (
              <Form.Item label={t('kumaPushUrl')} name="kumaPushUrl" extra={t('kumaPushUrlHint')}>
                <Input placeholder="https://kuma.mondomaine.tld/api/push/XXXX" />
              </Form.Item>
            ),
          },
        ]}
      />
      <Form.Item label={t('enabled')} name="enabled" valuePropName="checked" initialValue={true}>
        <Switch />
      </Form.Item>
    </Form>
  );
}
