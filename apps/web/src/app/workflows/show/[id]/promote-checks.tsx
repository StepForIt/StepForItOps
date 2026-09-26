'use client';

import React, { useState } from 'react';
import { Button, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { BRAND } from '../../../../lib/brand/colors';
import { useTranslations } from 'next-intl';

export type CheckStatus = 'error' | 'warning' | 'ok' | 'neutral';

export interface PromoteCheck {
  key: string;
  label: string;
  status: CheckStatus;
  summary: React.ReactNode;
  detail?: React.ReactNode;
}

const ICON: Record<CheckStatus, React.ReactNode> = {
  error: <CloseCircleOutlined style={{ color: BRAND.danger }} />,
  warning: <ExclamationCircleOutlined style={{ color: BRAND.warning }} />,
  ok: <CheckCircleOutlined style={{ color: BRAND.success }} />,
  neutral: <MinusCircleOutlined style={{ color: '#999' }} />,
};

function CheckRow({ check }: { check: PromoteCheck }) {
  const t = useTranslations('workflowShow.promoteChecks');
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: '6px 0', borderTop: '1px solid #f0f0f0' }}>
      <Space align="start" size={8} style={{ width: '100%' }}>
        {ICON[check.status]}
        <div style={{ flex: 1 }}>
          <Typography.Text strong>{check.label}</Typography.Text>{' '}
          <Typography.Text type={check.status === 'error' ? 'danger' : undefined}>
            {check.summary}
          </Typography.Text>
          {check.detail && (
            <Button
              type="link"
              size="small"
              icon={open ? <DownOutlined /> : <RightOutlined />}
              onClick={() => setOpen(!open)}
            >
              {t('detail')}
            </Button>
          )}
          {open && check.detail && <div style={{ marginTop: 6 }}>{check.detail}</div>}
        </div>
      </Space>
    </div>
  );
}

/** Seul ce qui demande une action s'affiche ; le reste se déplie. */
export function PromoteChecks({ checks }: { checks: PromoteCheck[] }) {
  const t = useTranslations('workflowShow.promoteChecks');
  const [showAll, setShowAll] = useState(false);
  const failing = checks.filter((check) => check.status === 'error' || check.status === 'warning');
  const passing = checks.filter((check) => check.status === 'ok' || check.status === 'neutral');
  return (
    <div>
      <Typography.Title level={5} style={{ marginBottom: 4 }}>
        {t('title')}
      </Typography.Title>
      {failing.map((check) => (
        <CheckRow key={check.key} check={check} />
      ))}
      {passing.length > 0 && (
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 4 }}>
          <Button
            type="link"
            size="small"
            style={{ paddingLeft: 0 }}
            icon={showAll ? <DownOutlined /> : <RightOutlined />}
            onClick={() => setShowAll(!showAll)}
          >
            {failing.length === 0 ? t('noProblem') : t('othersOk', { count: passing.length })}
          </Button>
          {!showAll && (
            <Space size={4} wrap>
              {passing.map((check) => (
                <Tag key={check.key} bordered={false}>
                  {check.label}
                </Tag>
              ))}
            </Space>
          )}
          {showAll && passing.map((check) => <CheckRow key={check.key} check={check} />)}
        </div>
      )}
    </div>
  );
}
