'use client';

import React from 'react';
import { Segmented, Tooltip } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALES, type Locale } from '../i18n/locale';
import { setLocale } from '../i18n/set-locale';

/** Choix de la langue, en pied de menu. */
export function LanguageMenuItem({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations('app.language');
  const locale = useLocale() as Locale;

  if (collapsed) {
    const next = LOCALES.find((l) => l !== locale) ?? locale;
    return (
      <Tooltip placement="right" title={t(next)}>
        <div
          style={{ textAlign: 'center', padding: '8px 0', cursor: 'pointer' }}
          onClick={() => setLocale(next)}
        >
          <GlobalOutlined /> {next.toUpperCase()}
        </div>
      </Tooltip>
    );
  }

  return (
    <div style={{ padding: '8px 12px' }}>
      <Segmented
        size="small"
        block
        aria-label={t('label')}
        value={locale}
        onChange={(value) => setLocale(String(value))}
        options={LOCALES.map((l) => ({ value: l, label: <Tooltip title={t(l)}>{l.toUpperCase()}</Tooltip> }))}
      />
    </div>
  );
}
