'use client';

import React from 'react';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { LockOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { FieldLabel } from '../../components/field-label';
import { BRAND } from '../../lib/brand/colors';
import { LanguageMenuItem } from '../../components/language-menu-item';

const { Title, Text } = Typography;

/** `?error=` : un code connu, `http_<statut>` quand l'API n'a rien dit, sinon le message de l'API tel quel. */
function useErrorText(error: string): string {
  const t = useTranslations('misc.setup.errors');
  if (error === 'already') return t('already');
  if (error === 'mismatch') return t('mismatch');
  const http = /^http_(\d+)$/.exec(error);
  return http ? t('http', { status: http[1] }) : error;
}

function SetupError({ error }: { error: string }) {
  return <Alert type="error" showIcon message={useErrorText(error)} />;
}

/** Formulaire du premier lancement : créer LE compte admin, rien d'autre. */
export function SetupCard({ error }: { error?: string }) {
  const t = useTranslations('misc.setup');
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: BRAND.papier,
      }}
    >
      <Card style={{ width: 420, maxWidth: '100%' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <SafetyOutlined style={{ fontSize: 28, color: BRAND.primary }} />
            <Title level={4} style={{ margin: '8px 0 4px' }}>
              {t('title')}
            </Title>
            <Text type="secondary">{t('intro')}</Text>
          </div>

          {error && <SetupError error={error} />}

          {/* Formulaire natif (pas de JS) : le POST crée le compte et pose la session. */}
          <form method="post" action="/auth/setup">
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <div>
                <FieldLabel htmlFor="setup-username" required>
                  {t('username')}
                </FieldLabel>
                <Input
                  id="setup-username"
                  name="username"
                  size="large"
                  required
                  prefix={<UserOutlined />}
                  placeholder={t('username')}
                  defaultValue="admin"
                  autoComplete="username"
                />
              </div>
              <div>
                <FieldLabel htmlFor="setup-password" required>
                  {t('password')}
                </FieldLabel>
                <Input.Password
                  id="setup-password"
                  name="password"
                  size="large"
                  required
                  minLength={10}
                  prefix={<LockOutlined />}
                  placeholder={t('passwordPlaceholder')}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <FieldLabel htmlFor="setup-confirm" required>
                  {t('confirm')}
                </FieldLabel>
                <Input.Password
                  id="setup-confirm"
                  name="confirm"
                  size="large"
                  required
                  minLength={10}
                  prefix={<LockOutlined />}
                  placeholder={t('confirm')}
                  autoComplete="new-password"
                />
              </div>
              <Button type="primary" size="large" block htmlType="submit">
                {t('submit')}
              </Button>
            </Space>
          </form>

          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('googleLater')}
          </Text>
          <LanguageMenuItem collapsed={false} />
        </Space>
      </Card>
    </div>
  );
}
