'use client';

import React from 'react';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { LockOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import { FieldLabel } from '../../components/field-label';

const { Title, Text } = Typography;

const ERRORS: Record<string, string> = {
  already: 'La plateforme est déjà configurée — connecte-toi.',
  mismatch: 'Les deux mots de passe ne correspondent pas.',
};

/** Formulaire du premier lancement : créer LE compte admin, rien d'autre. */
export function SetupCard({ error }: { error?: string }) {
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
      <Card style={{ width: 420, maxWidth: '100%' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <SafetyOutlined style={{ fontSize: 28, color: '#1677ff' }} />
            <Title level={4} style={{ margin: '8px 0 4px' }}>
              Bienvenue — sécurisons la plateforme
            </Title>
            <Text type="secondary">
              Première ouverture : crée le compte administrateur. Tant qu&apos;il n&apos;existe pas, rien
              d&apos;autre n&apos;est accessible.
            </Text>
          </div>

          {error && <Alert type="error" showIcon message={ERRORS[error] ?? error} />}

          {/* Formulaire natif (pas de JS) : le POST crée le compte et pose la session. */}
          <form method="post" action="/auth/setup">
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <div>
                <FieldLabel htmlFor="setup-username" required>
                  Identifiant
                </FieldLabel>
                <Input
                  id="setup-username"
                  name="username"
                  size="large"
                  required
                  prefix={<UserOutlined />}
                  placeholder="Identifiant"
                  defaultValue="admin"
                  autoComplete="username"
                />
              </div>
              <div>
                <FieldLabel htmlFor="setup-password" required>
                  Mot de passe
                </FieldLabel>
                <Input.Password
                  id="setup-password"
                  name="password"
                  size="large"
                  required
                  minLength={10}
                  prefix={<LockOutlined />}
                  placeholder="Mot de passe (10 caractères minimum)"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <FieldLabel htmlFor="setup-confirm" required>
                  Confirmer le mot de passe
                </FieldLabel>
                <Input.Password
                  id="setup-confirm"
                  name="confirm"
                  size="large"
                  required
                  minLength={10}
                  prefix={<LockOutlined />}
                  placeholder="Confirmer le mot de passe"
                  autoComplete="new-password"
                />
              </div>
              <Button type="primary" size="large" block htmlType="submit">
                Créer le compte et entrer
              </Button>
            </Space>
          </form>

          <Text type="secondary" style={{ fontSize: 12 }}>
            La connexion Google (par domaine Workspace) peut s&apos;ajouter ensuite par variables
            d&apos;environnement — voir docs/authentification.md.
          </Text>
        </Space>
      </Card>
    </div>
  );
}
