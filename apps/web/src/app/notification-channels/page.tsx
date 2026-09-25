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

const TYPE_LABELS: Record<Channel['type'], string> = {
  slack: 'Slack (incoming webhook)',
  webhook: 'Webhook (POST JSON)',
};

/**
 * Canaux d'alerte : où partent les « nouveau problème » et « problème revenu ».
 * L'URL est un secret : l'API n'en renvoie que la fin (`urlHint`) — le champ
 * reste vide en édition et ne remplace l'existante que s'il est ressaisi.
 */
export default function NotificationChannelsPage() {
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
      message.success('Canal enregistré');
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
      message.success(`Message d'essai envoyé sur « ${channel.name} »`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const remove = async (channel: Channel) => {
    try {
      await apiDelete(`/notification-channels/${channel.id}`);
      message.success('Canal supprimé');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Card
      title="Canaux d'alerte"
      extra={
        <Button type="primary" icon={<BellOutlined />} onClick={() => open('new')}>
          Ajouter un canal
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Quand un problème apparaît (nouveau groupe d'erreurs) ou revient après avoir été traité, chaque canal actif reçoit une alerte. Les imports d'historique n'alertent jamais."
      />
      <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={false}>
        <Table.Column dataIndex="name" title="Nom" />
        <Table.Column
          dataIndex="type"
          title="Type"
          render={(type: Channel['type']) => <Tag>{TYPE_LABELS[type]}</Tag>}
        />
        <Table.Column
          dataIndex="urlHint"
          title="URL"
          render={(hint: string) => (
            <Tooltip title="L'URL complète n'est jamais renvoyée (secret)">
              <code>{hint}</code>
            </Tooltip>
          )}
        />
        <Table.Column<Channel>
          title="Alertes"
          render={(_, record) => (
            <Space size={4}>
              {record.onNewGroup && <Tag color="blue">nouveau problème</Tag>}
              {record.onRegression && <Tag color="volcano">rechute</Tag>}
              {record.onPerfDrift && <Tag color="orange">dérive de durée</Tag>}
              {record.onBudget && <Tag color="gold">budget IA</Tag>}
              {record.onRelayBroken && <Tag color="red">surveillance muette</Tag>}
              {record.onModelLifecycle && <Tag color="purple">modèle déprécié</Tag>}
            </Space>
          )}
        />
        <Table.Column<Channel>
          dataIndex="enabled"
          title="Actif"
          render={(enabled: boolean) => (enabled ? <Tag color="green">actif</Tag> : <Tag>coupé</Tag>)}
        />
        <Table.Column<Channel>
          title=""
          width={150}
          render={(_, record) => (
            <Space>
              <Tooltip title="Envoyer un message d'essai">
                <Button
                  size="small"
                  icon={<SendOutlined />}
                  loading={testing === record.id}
                  onClick={() => test(record)}
                />
              </Tooltip>
              <Button size="small" icon={<EditOutlined />} onClick={() => open(record)} />
              <Popconfirm title="Supprimer ce canal ?" onConfirm={() => remove(record)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        />
      </Table>

      <Modal
        title={editing === 'new' ? 'Nouveau canal' : 'Modifier le canal'}
        open={editing !== null}
        onOk={save}
        confirmLoading={saving}
        onCancel={() => setEditing(null)}
        okText="Enregistrer"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Nom" rules={[{ required: true, message: 'Un nom' }]}>
            <Input placeholder="Slack #ops" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item
            name="url"
            label="URL"
            rules={editing === 'new' ? [{ required: true, message: "L'URL du webhook" }] : []}
            extra={
              editing !== 'new'
                ? 'Laisser vide pour conserver l’URL actuelle (elle n’est jamais réaffichée).'
                : 'Slack : Incoming Webhook (https://hooks.slack.com/…). Webhook : n’importe quelle URL qui accepte un POST JSON.'
            }
          >
            <Input placeholder="https://hooks.slack.com/services/…" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="onNewGroup" label="Nouveau problème" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="onRegression" label="Rechute" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="onPerfDrift" label="Dérive de durée" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="onBudget" label="Budget IA dépassé" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="onRelayBroken"
              label="Surveillance muette"
              valuePropName="checked"
              tooltip="Le push vers la sonde Uptime Kuma échoue : plus rien ne signalerait l'arrêt de ce monitor."
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="onModelLifecycle"
              label="Modèle déprécié ou retiré"
              tooltip="Un modèle appelé par un workflow du parc n'est plus servi par son provider."
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="Actif" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}
