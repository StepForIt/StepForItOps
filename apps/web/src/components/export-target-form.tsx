'use client';

import React, { useState } from 'react';
import { Alert, Button, Collapse, Form, Input, Select, Space, Switch, message } from 'antd';
import type { FormProps } from 'antd';
import { ApiOutlined, GithubOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('settings.exportTargetForm');
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
      message.success(t('reposLoaded', { count: result.length }));
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
      if (result.ok) message.success(t('accessOk'));
      else message.error(t('accessKo', { error: result.error ?? '' }));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Form {...formProps} layout="vertical">
      <Form.Item label={t('kind')} name="kind" initialValue="github" rules={[{ required: true }]}>
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
                label={t('githubToken')}
                name={['config', 'token']}
                extra={hasStoredToken ? t('tokenStoredHint') : t('githubTokenHint')}
              >
                <Input.Password
                  placeholder={
                    hasStoredToken ? t('githubTokenStoredPlaceholder') : t('githubTokenPlaceholder')
                  }
                />
              </Form.Item>
              <Space style={{ marginBottom: 16 }}>
                <Button icon={<GithubOutlined />} loading={busy === 'repos'} onClick={loadRepos}>
                  {t('listRepos')}
                </Button>
                <Button icon={<ApiOutlined />} loading={busy === 'test'} onClick={testAccess}>
                  {t('testAccess')}
                </Button>
              </Space>
              {repos.length > 0 && (
                <Form.Item label={t('repo')}>
                  <Select
                    showSearch
                    placeholder={t('chooseRepo')}
                    options={repos.map((r) => ({
                      value: r.fullName,
                      label: `${r.fullName}${r.private ? ' 🔒' : ''}`,
                    }))}
                    onChange={onRepoSelected}
                  />
                </Form.Item>
              )}
              <Space size="large" wrap>
                <Form.Item label={t('owner')} name={['config', 'owner']} rules={[{ required: true }]}>
                  <Input placeholder={t('ownerPlaceholder')} style={{ width: 200 }} />
                </Form.Item>
                <Form.Item label={t('repo')} name={['config', 'repo']} rules={[{ required: true }]}>
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
                    label: t('advanced'),
                    forceRender: true,
                    children: (
                      <Form.Item label={t('branch')} name={['config', 'branch']} initialValue="main">
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
              <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('gdriveInfo')} />
              <Form.Item label={t('folderId')} name={['config', 'folderId']}>
                <Input placeholder="1AbC…" />
              </Form.Item>
              <Form.Item
                label={t('accessToken')}
                name={['config', 'accessToken']}
                extra={hasStoredToken ? t('tokenStoredHint') : t('gdriveTokenHint')}
              >
                <Input.Password placeholder={hasStoredToken ? t('gdriveTokenStoredPlaceholder') : 'ya29….'} />
              </Form.Item>
            </>
          )
        }
      </Form.Item>

      <Form.Item label={t('name')} name="name" rules={[{ required: true }]}>
        <Input placeholder={t('namePlaceholder')} />
      </Form.Item>
      <Form.Item label={t('enabled')} name="enabled" valuePropName="checked" initialValue={true}>
        <Switch />
      </Form.Item>
    </Form>
  );
}
