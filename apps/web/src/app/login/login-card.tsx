'use client';

import React from 'react';
import { Alert, Button, Card, Divider, Input, Space, Typography } from 'antd';
import { GoogleOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { FieldLabel } from '../../components/field-label';

const { Title, Text } = Typography;

/** Motifs d'échec renvoyés par les routes d'auth, traduits pour l'utilisateur. */
const ERRORS: Record<string, string> = {
  oauth: 'La connexion Google a échoué. Réessaie.',
  domain: "Ce compte Google n'appartient pas au domaine autorisé.",
  google_off: "La connexion Google n'est pas configurée sur cette instance.",
  credentials: 'Identifiant ou mot de passe incorrect.',
};

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
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#f5f5f5',
      }}
    >
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={4} style={{ marginBottom: 4 }}>
              StepForIt Ops
            </Title>
            <Text type="secondary">Connexion réservée à l&apos;équipe</Text>
          </div>

          {error && <Alert type="error" showIcon message={ERRORS[error] ?? 'Connexion impossible.'} />}

          {googleEnabled && (
            <>
              <Button
                type="primary"
                size="large"
                block
                icon={<GoogleOutlined />}
                href={`/auth/google?next=${encodeURIComponent(next)}`}
              >
                Se connecter avec Google
              </Button>
              <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 12 }}>
                Comptes {domains.map((domain) => `@${domain}`).join(', ')} uniquement
              </Text>
            </>
          )}

          {googleEnabled && passwordEnabled && (
            <Divider plain style={{ margin: 0 }}>
              ou
            </Divider>
          )}

          {passwordEnabled && (
            // Formulaire natif (pas de JS) : le POST pose directement le cookie de session.
            <form method="post" action="/auth/password">
              <input type="hidden" name="next" value={next} />
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <div>
                  <FieldLabel htmlFor="login-username" required>
                    Identifiant
                  </FieldLabel>
                  <Input
                    id="login-username"
                    name="username"
                    size="large"
                    required
                    prefix={<UserOutlined />}
                    placeholder="Identifiant"
                    defaultValue={username}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="login-password" required>
                    Mot de passe
                  </FieldLabel>
                  <Input.Password
                    id="login-password"
                    name="password"
                    size="large"
                    required
                    prefix={<LockOutlined />}
                    placeholder="Mot de passe"
                    autoComplete="current-password"
                  />
                </div>
                <Button size="large" block htmlType="submit" type={googleEnabled ? 'default' : 'primary'}>
                  Se connecter
                </Button>
              </Space>
            </form>
          )}
        </Space>
      </Card>
    </div>
  );
}
