'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Popconfirm, Space, Tag, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { DeleteOutlined, EditOutlined, TeamOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';

interface Client {
  id: string;
  name: string;
  instanceCount: number;
}

/** Clients de l'agence : de simples groupes d'instances pour les vues agrégées. */
export default function ClientsPage() {
  const t = useTranslations('settings.clients');
  const tc = useTranslations('common');
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Client | null | 'new'>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<Client[]>('/clients?_start=0&_end=200')
      .then(setRows)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing === 'new') await apiPost('/clients', { name });
      else if (editing) await apiPatch(`/clients/${editing.id}`, { name });
      message.success(t('saved'));
      setEditing(null);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (client: Client) => {
    try {
      await apiDelete(`/clients/${client.id}`);
      message.success(t('deleted'));
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Card
      title={t('title')}
      extra={
        <Button
          type="primary"
          icon={<TeamOutlined />}
          onClick={() => {
            setEditing('new');
            setName('');
          }}
        >
          {t('add')}
        </Button>
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('info')} />
      <Table dataSource={rows} rowKey="id" loading={loading} size="small" pagination={false}>
        <Table.Column dataIndex="name" title={tc('columns.name')} />
        <Table.Column<Client>
          dataIndex="instanceCount"
          title={t('instances')}
          width={110}
          render={(count: number) => <Tag color={count > 0 ? 'blue' : 'default'}>{count}</Tag>}
        />
        <Table.Column<Client>
          title=""
          width={110}
          render={(_, record) => (
            <Space>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditing(record);
                  setName(record.name);
                }}
              />
              <Popconfirm title={t('deleteConfirm')} onConfirm={() => remove(record)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        />
      </Table>

      <Modal
        title={editing === 'new' ? t('new') : t('rename')}
        open={editing !== null}
        onOk={save}
        confirmLoading={saving}
        onCancel={() => setEditing(null)}
        okText={tc('save')}
      >
        <Input
          aria-label={t('name')}
          placeholder={t('name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={save}
          autoFocus
        />
      </Modal>
    </Card>
  );
}
