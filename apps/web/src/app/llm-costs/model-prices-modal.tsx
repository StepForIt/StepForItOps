'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Tag, Tooltip, message } from 'antd';
import { Table } from '../../components/resizable-table';
import { DeleteOutlined, DollarOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('health.llmCosts.prices');
  const tc = useTranslations('common');

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
        result.stillUnknown > 0
          ? t('appliedWithUnknown', { updated: result.updated, stillUnknown: result.stillUnknown })
          : t('applied', { updated: result.updated }),
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
      title={t('title')}
      open={open}
      onCancel={() => onClose(changed)}
      footer={<Button onClick={() => onClose(changed)}>{tc('close')}</Button>}
      width={720}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* Ligne d'ajout dense : le libellé est porté par aria-label (accessible)
            plutôt qu'affiché, pour garder les trois champs sur une seule ligne. */}
        <Form form={form} layout="inline" onFinish={create}>
          <Form.Item name="pattern" rules={[{ required: true, message: t('patternRequired') }]}>
            <Input
              aria-label={t('patternLabel')}
              placeholder={t('patternPlaceholder')}
              style={{ width: 240 }}
            />
          </Form.Item>
          <Form.Item name="inputPerMTok" rules={[{ required: true, message: t('inputRequired') }]}>
            <InputNumber
              aria-label={t('inputLabel')}
              placeholder={t('input')}
              min={0}
              step={0.05}
              style={{ width: 100 }}
            />
          </Form.Item>
          <Form.Item name="outputPerMTok" rules={[{ required: true, message: t('outputRequired') }]}>
            <InputNumber
              aria-label={t('outputLabel')}
              placeholder={t('output')}
              min={0}
              step={0.05}
              style={{ width: 100 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
            {tc('add')}
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
              title: t('pattern'),
              dataIndex: 'pattern',
              render: (pattern: string, row) => (
                <Space size={6}>
                  <code>{pattern}</code>
                  {row.source === 'custom' && <Tag color="blue">custom</Tag>}
                </Space>
              ),
            },
            {
              title: t('input'),
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
              title: t('output'),
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
                <Popconfirm title={t('deleteConfirm')} onConfirm={() => remove(row)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />

        <Tooltip title={t('applyTooltip')}>
          <Button icon={<DollarOutlined />} loading={applying} onClick={applyMissing}>
            {t('apply')}
          </Button>
        </Tooltip>
      </Space>
    </Modal>
  );
}
