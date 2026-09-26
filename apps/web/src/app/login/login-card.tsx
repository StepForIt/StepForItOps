'use client';

import React from 'react';
import { Alert, Button, Card, Divider, Input, Space, Typography } from 'antd';
import { GoogleOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { FieldLabel } from '../../components/field-label';
import { BrandMark, BrandWordmark } from '../../components/brand-mark';
import { BRAND } from '../../lib/brand/colors';
import { LanguageMenuItem } from '../../components/language-menu-item';

const { Title, Text } = Typography;

/** Motifs d'échec renvoyés par les routes d'auth (`?error=`), traduits pour l'utilisateur. */
const ERROR_CODES = ['oauth', 'domain', 'google_off', 'credentials'] as const;
type ErrorCode = (typeof ERROR_CODES)[number];
const isErrorCode = (code: string): code is ErrorCode => (ERROR_CODES as readonly string[]).includes(code);

export function LoginCard({
  googleEnabled,
  passwordEnabled,
  domains,
  username,
  next,
  error,
}: {
  googleEnabled: boolean;
  passwordEnabled: boolean;
  domains: string[];
  username: string;
  next: string;
  error?: string;
}) {
  const t = useTranslations('misc.login');
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
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <BrandMark size={56} />
            <Title level={4} style={{ margin: '10px 0 4px' }}>
              <BrandWordmark size={22} />
            </Title>
            <Text type="secondary">{t('subtitle')}</Text>
          </div>

          {error && (
            <Alert
              type="error"
              showIcon
              message={isErrorCode(error) ? t(`errors.${error}`) : t('errors.unknown')}
            />
          )}

          {googleEnabled && (
            <>
              <Button
                type="primary"
                size="large"
                block
                icon={<GoogleOutlined />}
                href={`/auth/google?next=${encodeURIComponent(next)}`}
              >
                {t('google')}
              </Button>
              <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12 }}>
                {t('domains', { domains: domains.map((domain) => `@${domain}`).join(', ') })}
              </Text>
            </>
          )}

          {googleEnabled && passwordEnabled && (
            <Divider plain style={{ margin: 0 }}>
              {t('or')}
            </Divider>
          )}

          {passwordEnabled && (
            // Formulaire natif (pas de JS) : le POST pose directement le cookie de session.
            <form method="post" action="/auth/password">
              <input type="hidden" name="next" value={next} />
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <div>
                  <FieldLabel htmlFor="login-username" required>
                    {t('username')}
                  </FieldLabel>
                  <Input
                    id="login-username"
                    name="username"
                    size="large"
                    required
                    prefix={<UserOutlined />}
                    placeholder={t('username')}
                    defaultValue={username}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="login-password" required>
                    {t('password')}
                  </FieldLabel>
                  <Input.Password
                    id="login-password"
                    name="password"
                    size="large"
                    required
                    prefix={<LockOutlined />}
                    placeholder={t('password')}
                    autoComplete="current-password"
                  />
                </div>
                <Button size="large" block htmlType="submit" type={googleEnabled ? 'default' : 'primary'}>
                  {t('submit')}
                </Button>
              </Space>
            </form>
          )}
          <LanguageMenuItem collapsed={false} />
        </Space>
      </Card>
    </div>
  );
}
