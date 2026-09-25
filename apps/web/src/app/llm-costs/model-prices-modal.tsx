'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Tag, Tooltip, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { DeleteOutlined, DollarOutlined, PlusOutlined } from '@ant-design/icons';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { ModelPriceRow } from './types';

interface PriceForm {
  pattern: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Gestion de la table des tarifs par modèle (USD / million de tokens). Le motif
 * matche en exact puis en préfixe ; une ligne modifiée passe en « custom » et
 * n'est plus écrasée par le seed. « Valoriser les appels sans tarif » recalcule
 * les lignes restées à null après un ajout — les coûts déjà figés ne bougent pas.
 */
export function ModelPricesModal({
  open,
  onClose,
  suggestedPattern,
}: {
  open: boolean;
  onClose: (changed: boolean) => void;
  suggestedPattern?: string;
}) {
  const [rows, setRows] = useState<ModelPriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [changed, setChanged] = useState(false);
  const [form] = Form.useForm<PriceForm>();

  const load = useCallback(() => {
    setLoading(true);
    apiGet<ModelPriceRow[]>('/ai-cost/prices')
      .then(setRows)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) {
      load();
      if (suggestedPattern) form.setFieldsValue({ pattern: suggestedPattern });
    }
  }, [open, load, suggestedPattern, form]);

  const create = async (values: PriceForm) => {
    try {
      await apiPost('/ai-cost/prices', values);
      form.resetFields();
      setChanged(true);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const update = async (row: ModelPriceRow, patch: Partial<PriceForm>) => {
    try {
      await apiPut(`/ai-cost/prices/${row.id}`, {
        pattern: row.pattern,
        inputPerMTok: row.inputPerMTok,
        outputPerMTok: row.outputPerMTok,
        ...patch,
      });
      setChanged(true);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const remove = async (row: ModelPriceRow) => {
    try {
      await apiDelete(`/ai-cost/prices/${row.id}`);
      setChanged(true);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const applyMissing = async () => {
    setApplying(true);
    try {
      const result = await apiPost<{ updated: number; stillUnknown: number }>(
        '/ai-cost/prices/apply-missing',
      );
      message.success(
        `${result.updated} appel(s) valorisé(s)` +
          (result.stillUnknown > 0 ? ` · ${result.stillUnknown} toujours sans tarif` : ''),
      );
      setChanged(true);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title="Tarifs par modèle (USD / million de tokens)"
      open={open}
      onCancel={() => onClose(changed)}
      footer={<Button onClick={() => onClose(changed)}>Fermer</Button>}
      width={720}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* Ligne d'ajout dense : le libellé est porté par aria-label (accessible)
            plutôt qu'affiché, pour garder les trois champs sur une seule ligne. */}
        <Form form={form} layout="inline" onFinish={create}>
          <Form.Item name="pattern" rules={[{ required: true, message: 'Motif requis' }]}>
            <Input
              aria-label="Motif du modèle"
              placeholder="Motif (ex. gpt-4o, claude-sonnet-5)"
              style={{ width: 240 }}
            />
          </Form.Item>
          <Form.Item name="inputPerMTok" rules={[{ required: true, message: 'Prix input' }]}>
            <InputNumber
              aria-label="Prix input (USD / million de tokens)"
              placeholder="Input"
              min={0}
              step={0.05}
              style={{ width: 100 }}
            />
          </Form.Item>
          <Form.Item name="outputPerMTok" rules={[{ required: true, message: 'Prix output' }]}>
            <InputNumber
              aria-label="Prix output (USD / million de tokens)"
              placeholder="Output"
              min={0}
              step={0.05}
              style={{ width: 100 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
            Ajouter
          </Button>
        </Form>

        <Table<ModelPriceRow>
          rowKey="id"
          dataSource={rows}
          loading={loading}
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          columns={[
            {
              title: 'Motif',
              dataIndex: 'pattern',
              render: (pattern: string, row) => (
                <Space size={6}>
                  <code>{pattern}</code>
                  {row.source === 'custom' && <Tag color="blue">custom</Tag>}
                </Space>
              ),
            },
            {
              title: 'Input',
              dataIndex: 'inputPerMTok',
              width: 130,
              render: (value: number, row) => (
                <InputNumber
                  size="small"
                  min={0}
                  step={0.05}
                  value={value}
                  onChange={(next) => next !== null && update(row, { inputPerMTok: next })}
                />
              ),
            },
            {
              title: 'Output',
              dataIndex: 'outputPerMTok',
              width: 130,
              render: (value: number, row) => (
                <InputNumber
                  size="small"
                  min={0}
                  step={0.05}
                  value={value}
                  onChange={(next) => next !== null && update(row, { outputPerMTok: next })}
                />
              ),
            },
            {
              width: 50,
              render: (_, row) => (
                <Popconfirm title="Supprimer ce tarif ?" onConfirm={() => remove(row)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />

        <Tooltip title="Chiffre les appels sans tarif">
          <Button icon={<DollarOutlined />} loading={applying} onClick={applyMissing}>
            Valoriser les appels sans tarif
          </Button>
        </Tooltip>
      </Space>
    </Modal>
  );
}
