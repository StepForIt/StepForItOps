'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Empty, Space, Spin, Typography } from 'antd';
import { ApiOutlined, CheckCircleTwoTone, ClearOutlined, FilterOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { listEmptyKind } from '../../lib/empty-state/list-empty-kind';
import { BRAND } from '../../lib/brand/colors';
import { useInstances } from './use-instances';

export interface IdleEmptyContent {
  title: React.ReactNode;
  text?: React.ReactNode;
  /** Le geste qui remplit la page. */
  actions?: React.ReactNode;
  /** `success` : une liste vide est ici une bonne nouvelle (aucune erreur). */
  tone?: 'neutral' | 'success';
}

/**
 * État vide commun des listes : dit POURQUOI la liste est vide et met sous la main le
 * geste qui en sort (règle pure `list-empty-kind.ts`). Les cas communs (aucune
 * instance, recherche, filtres) sont écrits ici une fois ; la page ne fournit que ce
 * qui lui est propre, le cas `idle`.
 */
export function ListEmptyState({
  needsInstances = false,
  search,
  onClearSearch,
  searchActions,
  filterCount = 0,
  onResetFilters,
  idle,
}: {
  /** La page lit le parc : sans instance, elle ne peut rien montrer. */
  needsInstances?: boolean;
  search?: string;
  onClearSearch?: () => void;
  /** Geste de plus quand la recherche ne trouve rien (ex. synchroniser). */
  searchActions?: React.ReactNode;
  filterCount?: number;
  onResetFilters?: () => void;
  idle: IdleEmptyContent;
}) {
  const t = useTranslations('common.emptyState');
  const { instances, loading } = useInstances(needsInstances);
  if (loading) return <Spin style={{ margin: 32 }} />;

  const kind = listEmptyKind({
    instanceCount: needsInstances ? instances.length : null,
    search,
    filterCount,
  });
  const content: IdleEmptyContent = {
    'no-instance': {
      title: t('noInstance.title'),
      text: t('noInstance.text'),
      actions: (
        <Link href="/instances/create">
          <Button type="primary" size="large" icon={<ApiOutlined />}>
            {t('noInstance.cta')}
          </Button>
        </Link>
      ),
    },
    'no-search-match': {
      title: t('noSearchMatch.title', { search: search ?? '' }),
      text: t('noSearchMatch.text'),
      actions: (
        <Space wrap style={{ justifyContent: 'center' }}>
          {searchActions}
          {onClearSearch && (
            <Button icon={<ClearOutlined />} onClick={onClearSearch}>
              {t('noSearchMatch.clear')}
            </Button>
          )}
        </Space>
      ),
    },
    'no-filter-match': {
      title: t('noFilterMatch.title'),
      text: t('noFilterMatch.text', { count: filterCount }),
      actions: onResetFilters && (
        <Button type="primary" icon={<FilterOutlined />} onClick={onResetFilters}>
          {t('noFilterMatch.reset')}
        </Button>
      ),
    },
    idle,
  }[kind];

  return (
    <Empty
      image={
        content.tone === 'success' ? (
          <CheckCircleTwoTone twoToneColor={BRAND.success} style={{ fontSize: 48 }} />
        ) : (
          Empty.PRESENTED_IMAGE_SIMPLE
        )
      }
      imageStyle={content.tone === 'success' ? { height: 56 } : undefined}
      style={{ padding: '24px 16px' }}
      description={
        <Space direction="vertical" size={4} style={{ maxWidth: 520 }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {content.title}
          </Typography.Text>
          {content.text && <Typography.Text type="secondary">{content.text}</Typography.Text>}
        </Space>
      }
    >
      {content.actions && (
        <Space direction="vertical" align="center" size={12}>
          {content.actions}
        </Space>
      )}
    </Empty>
  );
}

/** Tient la place pendant un chargement : l'état vide n'a de sens qu'une fois la liste revenue. */
export function EmptyPlaceholder() {
  return <div style={{ minHeight: 160 }} />;
}
