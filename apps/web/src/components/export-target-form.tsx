'use client';

import React, { useState } from 'react';
import { Alert, Button, Collapse, Form, Input, Select, Space, Switch, message } from 'antd';
import type { FormProps } from 'antd';
import { ApiOutlined, GithubOutlined } from '@ant-design/icons';
import { apiPost } from '../lib/api';

interface Repo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/**
 * Formulaire cible d'export. L'API ne renvoie jamais les secrets (`hasToken` seulement) :
 * en édition, un token laissé vide conserve l'existant, et les appels repos/branches/test
 * passent `targetId` pour que l'API le reprenne côté serveur.
 */
export function ExportTargetForm({ formProps }: { formProps: FormProps }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const form = formProps.form;
  const initial = formProps.initialValues as { id?: string; hasToken?: boolean } | undefined;
  const targetId = initial?.id;
  const hasStoredToken = Boolean(initial?.hasToken);

  const token = (): string | undefined => form?.getFieldValue(['config', 'token']);

  const loadRepos = async () => {
    setBusy('repos');
    try {
      const result = await apiPost<Repo[]>('/export-targets/github/repos', { token: token(), targetId });
      setRepos(result);
      message.success(`${result.length} repos accessibles — choisis dans la liste`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onRepoSelected = async (fullName: string) => {
    const repo = repos.find((r) => r.fullName === fullName);
    if (!repo) return;
    form?.setFieldValue(['config', 'owner'], repo.owner);
    form?.setFieldValue(['config', 'repo'], repo.name);
    form?.setFieldValue(['config', 'branch'], repo.defaultBranch);
    if (!form?.getFieldValue('name')) form?.setFieldValue('name', `GitHub ${repo.fullName}`);
    try {
      setBranches(
        await apiPost<string[]>('/export-targets/github/branches', {
          token: token(),
          targetId,
          owner: repo.owner,
          repo: repo.name,
        }),
      );
    } catch {
      setBranches([repo.defaultBranch]);
    }
  };

  const testAccess = async () => {
    setBusy('test');
    try {
      const config = form?.getFieldValue('config') ?? {};
      const result = await apiPost<{ ok: boolean; error?: string }>('/export-targets/test', {
        kind: form?.getFieldValue('kind'),
        targetId,
        config,
      });
      if (result.ok) message.success('Accès au repo vérifié ✔');
      else message.error(`Accès KO : ${result.error}`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Form {...formProps} layout="vertical">
      <Form.Item label="Type" name="kind" initialValue="github" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'github', label: 'GitHub' },
            { value: 'gdrive', label: 'Google Drive' },
          ]}
          onChange={() => {
            setRepos([]);
            setBranches([]);
          }}
        />
      </Form.Item>

      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
        {({ getFieldValue }) =>
          getFieldValue('kind') === 'github' ? (
            <>
              <Form.Item
                label="Token GitHub"
                name={['config', 'token']}
                extra={
                  hasStoredToken
                    ? 'Un token est déjà enregistré (jamais réaffiché). Laisse vide pour le conserver.'
                    : 'Fine-grained PAT avec « Contents: Read and write » sur le repo. Laisse vide pour utiliser GITHUB_TOKEN du serveur.'
                }
              >
                <Input.Password
                  placeholder={
                    hasStoredToken
                      ? '•••••• (token enregistré, conservé si vide)'
                      : 'ghp_… (optionnel si GITHUB_TOKEN défini)'
                  }
                />
              </Form.Item>
              <Space style={{ marginBottom: 16 }}>
                <Button icon={<GithubOutlined />} loading={busy === 'repos'} onClick={loadRepos}>
                  Lister mes repos
                </Button>
                <Button icon={<ApiOutlined />} loading={busy === 'test'} onClick={testAccess}>
                  Tester l&apos;accès
                </Button>
              </Space>
              {repos.length > 0 && (
                <Form.Item label="Repo">
                  <Select
                    showSearch
                    placeholder="Choisir un repo"
                    options={repos.map((r) => ({
                      value: r.fullName,
                      label: `${r.fullName}${r.private ? ' 🔒' : ''}`,
                    }))}
                    onChange={onRepoSelected}
                  />
                </Form.Item>
              )}
              <Space size="large" wrap>
                <Form.Item label="Owner" name={['config', 'owner']} rules={[{ required: true }]}>
                  <Input placeholder="mon-org" style={{ width: 200 }} />
                </Form.Item>
                <Form.Item label="Repo" name={['config', 'repo']} rules={[{ required: true }]}>
                  <Input placeholder="n8n-workflows" style={{ width: 220 }} />
                </Form.Item>
              </Space>
              {/* La branche a un défaut (main), remplie au choix du repo : repliée. */}
              <Collapse
                ghost
                style={{ marginBottom: 16 }}
                items={[
                  {
                    key: 'advanced',
                    label: 'Options avancées',
                    forceRender: true,
                    children: (
                      <Form.Item label="Branche" name={['config', 'branch']} initialValue="main">
                        {branches.length > 0 ? (
                          <Select
                            options={branches.map((b) => ({ value: b, label: b }))}
                            style={{ width: 180 }}
                          />
                        ) : (
                          <Input style={{ width: 180 }} />
                        )}
                      </Form.Item>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Google Drive : token OAuth à durée courte (~1h) — utilisable pour des exports ponctuels."
              />
              <Form.Item label="Folder ID (optionnel)" name={['config', 'folderId']}>
                <Input placeholder="1AbC…" />
              </Form.Item>
              <Form.Item
                label="Access token"
                name={['config', 'accessToken']}
                extra={
                  hasStoredToken
                    ? 'Un token est déjà enregistré (jamais réaffiché). Laisse vide pour le conserver.'
                    : 'Laisse vide pour utiliser GDRIVE_ACCESS_TOKEN du serveur.'
                }
              >
                <Input.Password placeholder={hasStoredToken ? '•••••• (token enregistré)' : 'ya29….'} />
              </Form.Item>
            </>
          )
        }
      </Form.Item>

      <Form.Item label="Nom" name="name" rules={[{ required: true }]}>
        <Input placeholder="Rempli automatiquement au choix du repo" />
      </Form.Item>
      <Form.Item label="Activée" name="enabled" valuePropName="checked" initialValue={true}>
        <Switch />
      </Form.Item>
    </Form>
  );
}
