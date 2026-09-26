'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { useTranslations } from 'next-intl';
import { Table } from '../../components/resizable-table';
import { BellOutlined, DeleteOutlined, EditOutlined, SendOutlined } from '@ant-design/icons';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';

interface Channel {
  id: string;
  name: string;
  type: 'slack' | 'webhook';
  urlHint: string;
  enabled: boolean;
  onNewGroup: boolean;
  onRegression: boolean;
  onPerfDrift: boolean;
  onBudget: boolean;
  onRelayBroken: boolean;
  onModelLifecycle: boolean;
}

interface ChannelForm {
  name: string;
  type: 'slack' | 'webhook';
  url?: string;
  enabled: boolean;
  onNewGroup: boolean;
  onRegression: boolean;
  onPerfDrift: boolean;
  onBudget: boolean;
  onRelayBroken: boolean;
  onModelLifecycle: boolean;
}

// Libellé : `misc.notificationChannels.types.<type>`.
const TYPES: Channel['type'][] = ['slack', 'webhook'];

/**
 * Canaux d'alerte : où partent les « nouveau problème » et « problème revenu ».
 * L'URL est un secret : l'API n'en renvoie que la fin (`urlHint`) — le champ
 * reste vide en édition et ne remplace l'existante que s'il est ressaisi.
 */
export default function NotificationChannelsPage() {
  const t = useTranslations('misc.notificationChannels');
  const tc = useTranslations('common');
  const [rows, setRows] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Channel | null | 'new'>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [form] = Form.useForm<ChannelForm>();

  const load = useCallback(() => {
    setLoading(true);
    apiGet<Channel[]>('/notification-channels?_start=0&_end=100')
      .then(setRows)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const open = (channel: Channel | 'new') => {
    setEditing(channel);
    form.setFieldsValue(
      channel === 'new'
        ? {
            name: '',
            type: 'slack',
            url: '',
            enabled: true,
            onNewGroup: true,
            onRegression: true,
            onPerfDrift: true,
            onBudget: true,
            onRelayBroken: true,
            onModelLifecycle: true,
          }
        : { ...channel, url: '' },
    );
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      // En édition, une URL laissée vide = secret inchangé côté API.
      const payload = { ...values, url: values.url?.trim() || undefined };
      if (editing === 'new') await apiPost('/notification-channels', payload);
      else if (editing) await apiPatch(`/notification-channels/${editing.id}`, payload);
      message.success(t('toast.saved'));
      setEditing(null);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const test = async (channel: Channel) => {
    setTesting(channel.id);
    try {
      await apiPost(`/notification-channels/${channel.id}/test`);
      message.success(t('toast.tested', { name: channel.name }));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const remove = async (channel: Channel) => {
    try {
      await apiDelete(`/notification-channels/${channel.id}`);
      message.success(t('toast.deleted'));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Card
      title={t('title')}
      extra={
        <Button type="primary" icon={<BellOutlined />} onClick={() => open('new')}>
          {t('add')}
        </Button>
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('intro')} />
      <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={false}>
        <Table.Column dataIndex="name" title={t('fields.name')} />
        <Table.Column
          dataIndex="type"
          title={t('fields.type')}
          render={(type: Channel['type']) => <Tag>{t(`types.${type}`)}</Tag>}
        />
        <Table.Column
          dataIndex="urlHint"
          title="URL"
          render={(hint: string) => (
            <Tooltip title={t('urlHidden')}>
              <code>{hint}</code>
            </Tooltip>
          )}
        />
        <Table.Column<Channel>
          title={t('fields.alerts')}
          render={(_, record) => (
            <Space size={4}>
              {record.onNewGroup && <Tag color="blue">{t('tags.newGroup')}</Tag>}
              {record.onRegression && <Tag color="volcano">{t('tags.regression')}</Tag>}
              {record.onPerfDrift && <Tag color="orange">{t('tags.perfDrift')}</Tag>}
              {record.onBudget && <Tag color="gold">{t('tags.budget')}</Tag>}
              {record.onRelayBroken && <Tag color="red">{t('tags.relayBroken')}</Tag>}
              {record.onModelLifecycle && <Tag color="purple">{t('tags.modelLifecycle')}</Tag>}
            </Space>
          )}
        />
        <Table.Column<Channel>
          dataIndex="enabled"
          title={t('fields.enabled')}
          render={(enabled: boolean) =>
            enabled ? <Tag color="green">{t('tags.on')}</Tag> : <Tag>{t('tags.off')}</Tag>
          }
        />
        <Table.Column<Channel>
          title=""
          width={150}
          render={(_, record) => (
            <Space>
              <Tooltip title={t('sendTest')}>
                <Button
                  size="small"
                  icon={<SendOutlined />}
                  loading={testing === record.id}
                  onClick={() => test(record)}
                />
              </Tooltip>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => open(record)}
                aria-label={tc('edit')}
              />
              <Popconfirm title={t('deleteConfirm')} onConfirm={() => remove(record)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        />
      </Table>

      <Modal
        title={editing === 'new' ? t('modal.new') : t('modal.edit')}
        open={editing !== null}
        onOk={save}
        confirmLoading={saving}
        onCancel={() => setEditing(null)}
        okText={tc('save')}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('fields.name')}
            rules={[{ required: true, message: t('modal.nameRequired') }]}
          >
            <Input placeholder="Slack #ops" />
          </Form.Item>
          <Form.Item name="type" label={t('fields.type')} rules={[{ required: true }]}>
            <Select options={TYPES.map((value) => ({ value, label: t(`types.${value}`) }))} />
          </Form.Item>
          <Form.Item
            name="url"
            label="URL"
            rules={editing === 'new' ? [{ required: true, message: t('modal.urlRequired') }] : []}
            extra={editing !== 'new' ? t('modal.urlKeep') : t('modal.urlHelp')}
          >
            <Input placeholder="https://hooks.slack.com/services/…" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="onNewGroup" label={t('modal.onNewGroup')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="onRegression" label={t('modal.onRegression')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="onPerfDrift" label={t('modal.onPerfDrift')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="onBudget" label={t('modal.onBudget')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="onRelayBroken"
              label={t('modal.onRelayBroken')}
              valuePropName="checked"
              tooltip={t('modal.onRelayBrokenHelp')}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="onModelLifecycle"
              label={t('modal.onModelLifecycle')}
              tooltip={t('modal.onModelLifecycleHelp')}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label={t('fields.enabled')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}
