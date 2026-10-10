'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Popconfirm, Space, Switch, Tag, Typography, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { DeleteOutlined, EditOutlined, TeamOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { EmptyPlaceholder, ListEmptyState } from '../../components/empty-state/list-empty-state';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';

interface Client {
  id: string;
  name: string;
  instanceCount: number;
  workflowCount: number;
  portalShowToday: boolean;
  portalShowIncidents: boolean;
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
  const [showToday, setShowToday] = useState(true);
  const [showIncidents, setShowIncidents] = useState(false);

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
      if (editing === 'new') {
        const created = await apiPost<{ id: string }>('/clients', { name });
        await apiPatch(`/clients/${created.id}`, {
          portalShowToday: showToday,
          portalShowIncidents: showIncidents,
        });
      } else if (editing) {
        await apiPatch(`/clients/${editing.id}`, {
          name,
          portalShowToday: showToday,
          portalShowIncidents: showIncidents,
        });
      }
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
            setShowToday(true);
            setShowIncidents(false);
          }}
        >
          {t('add')}
        </Button>
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('info')} />
      <Table
        dataSource={rows}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        locale={{
          emptyText: loading ? (
            <EmptyPlaceholder />
          ) : (
            <ListEmptyState
              idle={{
                title: t('empty.title'),
                text: t('empty.text'),
                actions: (
                  <Button
                    type="primary"
                    icon={<TeamOutlined />}
                    onClick={() => {
                      setEditing('new');
                      setName('');
                      setShowToday(true);
                      setShowIncidents(false);
                    }}
                  >
                    {t('add')}
                  </Button>
                ),
              }}
            />
          ),
        }}
      >
        <Table.Column dataIndex="name" title={tc('columns.name')} />
        {/* Une colonne de plus ferait passer la liste en lignes dépliables sur mobile (dès 4 colonnes) : les deux comptes partagent la même. */}
        <Table.Column<Client>
          dataIndex="instanceCount"
          title={t('instances')}
          width={150}
          render={(count: number, record) => (
            <Space size={4}>
              <Tag color={count > 0 ? 'blue' : 'default'}>{count}</Tag>
              {record.workflowCount > 0 && (
                <Tag color="cyan" title={t('workflows')}>
                  {record.workflowCount} WF
                </Tag>
              )}
            </Space>
          )}
        />
        <Table.Column<Client>
          title=""
          width={110}
          render={(_, record) => (
            <Space>
              <Button
                aria-label={tc('edit')}
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditing(record);
                  setName(record.name);
                  setShowToday(record.portalShowToday);
                  setShowIncidents(record.portalShowIncidents);
                }}
              />
              <Popconfirm title={t('deleteConfirm')} onConfirm={() => remove(record)}>
                <Button aria-label={tc('delete')} size="small" danger icon={<DeleteOutlined />} />
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
        <Space direction="vertical" size={8} style={{ marginTop: 16, width: '100%' }}>
          <Space>
            <Switch checked={showToday} onChange={setShowToday} aria-label={t('portalShowToday')} />
            {t('portalShowToday')}
          </Space>
          <Space>
            <Switch
              checked={showIncidents}
              onChange={setShowIncidents}
              aria-label={t('portalShowIncidents')}
            />
            {t('portalShowIncidents')}
          </Space>
          <Typography.Text type="secondary">{t('portalHint')}</Typography.Text>
        </Space>
      </Modal>
    </Card>
  );
}
