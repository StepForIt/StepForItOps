'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, Divider, Popover, Space, Tooltip } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, SettingOutlined } from '@ant-design/icons';

export interface ColumnsMenuItem {
  id: string;
  label: string;
  visible: boolean;
}

/**
 * Le menu « Colonnes » posé dans le coin droit de l'en-tête d'une table : afficher,
 * masquer et réordonner les colonnes, revenir à l'affichage par défaut, et
 * réinitialiser tout ce que la page a retenu (filtres, tri, page, largeurs).
 * Des flèches plutôt qu'un glisser-déposer : le geste marche aussi au doigt.
 */
export function ColumnsMenu({
  items,
  onToggle,
  onMove,
  onResetColumns,
  onResetView,
}: {
  /** Dans l'ordre d'affichage, masquées comprises. */
  items: ColumnsMenuItem[];
  onToggle: (id: string, visible: boolean) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onResetColumns: () => void;
  onResetView: () => void;
}) {
  const t = useTranslations('shell.columnsMenu');
  const visibleCount = items.filter((item) => item.visible).length;
  const content = (
    <div style={{ minWidth: 220 }}>
      {items.map((item, index) => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
          <Checkbox
            style={{ flex: 1 }}
            checked={item.visible}
            // La dernière colonne visible ne se masque pas : la table n'aurait plus rien à montrer.
            disabled={item.visible && visibleCount === 1}
            onChange={(event) => onToggle(item.id, event.target.checked)}
          >
            {item.label}
          </Checkbox>
          <Button
            size="small"
            type="text"
            icon={<ArrowUpOutlined />}
            aria-label={t('moveUp', { label: item.label })}
            disabled={index === 0}
            onClick={() => onMove(item.id, -1)}
          />
          <Button
            size="small"
            type="text"
            icon={<ArrowDownOutlined />}
            aria-label={t('moveDown', { label: item.label })}
            disabled={index === items.length - 1}
            onClick={() => onMove(item.id, 1)}
          />
        </div>
      ))}
      <Divider style={{ margin: '8px 0' }} />
      <Space direction="vertical" size={0}>
        <Button type="link" size="small" style={{ padding: 0 }} onClick={onResetColumns}>
          {t('resetColumns')}
        </Button>
        <Tooltip title={t('resetViewHint')}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={onResetView}>
            {t('resetView')}
          </Button>
        </Tooltip>
      </Space>
    </div>
  );
  return (
    <Popover trigger="click" placement="bottomRight" title={t('title')} content={content}>
      <Button size="small" type="text" icon={<SettingOutlined />} aria-label={t('title')} />
    </Popover>
  );
}
