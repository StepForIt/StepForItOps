'use client';

import React, { useEffect, useState } from 'react';
import { Button, Collapse, Form, Input, Select, message } from 'antd';
import type { FormInstance, FormProps } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../lib/api';

interface InstanceFormProps {
  formProps: FormProps;
  /** En édition, la clé API n'est jamais renvoyée par l'API : le champ reste vide et facultatif. */
  instanceId?: string;
}

/** Les zones qui servent l'API Make. La zone fait partie de l'identité du compte :
 *  un jeton d'une zone est refusé par les autres, avec le même message qu'un
 *  droit manquant — d'où le choix dans une liste plutôt qu'en saisie libre. */
const MAKE_ZONES = [
  'eu1.make.com',
  'eu2.make.com',
  'us1.make.com',
  'us2.make.com',
  'eu1.make.celonis.com',
  'us1.make.celonis.com',
];

/** Rattachement client — accessoire, partagé par les deux plateformes. */
function ClientField({ clients }: { clients: Array<{ id: string; name: string }> }) {
  const t = useTranslations('settings.instanceForm');
  const tc = useTranslations('common');
  return (
    <Form.Item label={t('client')} name="clientId" extra={t('clientHint')}>
      <Select
        allowClear
        placeholder={tc('none')}
        options={clients.map((client) => ({ value: client.id, label: client.name }))}
      />
    </Form.Item>
  );
}

/** Formulaire commun create/edit d'une instance, avec test de connexion avant sauvegarde. */
export function InstanceForm({ formProps, instanceId }: InstanceFormProps) {
  const t = useTranslations('settings.instanceForm');
  const [testing, setTesting] = useState(false);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [platform, setPlatform] = useState<'n8n' | 'make'>(
    (formProps.initialValues?.platform as 'n8n' | 'make') ?? 'n8n',
  );
  const isEdit = Boolean(instanceId);
  const isMake = platform === 'make';

  useEffect(() => {
    apiGet<Array<{ id: string; name: string }>>('/clients?_start=0&_end=200')
      .then(setClients)
      .catch(() => setClients([]));
  }, []);

  const testConnection = async (form?: FormInstance) => {
    const zone = form?.getFieldValue('zone');
    const baseUrl = isMake ? `https://${zone ?? ''}` : form?.getFieldValue('baseUrl');
    const apiKey = form?.getFieldValue('apiKey');
    if (isMake && !zone) {
      message.warning(t('zoneFirst'));
      return;
    }
    if (!baseUrl || (!apiKey && !isEdit)) {
      message.warning(t('urlAndKeyFirst'));
      return;
    }
    setTesting(true);
    try {
      const result = await apiPost<{ ok: boolean; workflowCount?: number; error?: string }>(
        '/instances/test-config',
        {
          baseUrl,
          apiKey,
          instanceId,
          platform,
          zone,
          orgId: form?.getFieldValue('externalOrgId'),
          teamId: form?.getFieldValue('externalTeamId'),
        },
      );
      if (result.ok)
        message.success(
          t(isMake ? 'connectionOkMake' : 'connectionOkN8n', { count: result.workflowCount ?? 0 }),
        );
      else message.error(t('connectionKo', { error: result.error ?? '' }));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Form
      {...formProps}
      layout="vertical"
      onValuesChange={(changed, all) => {
        // Chez Make, l'URL n'est pas saisie : elle EST la zone. La déduire ici
        // évite un champ que personne ne saurait remplir autrement.
        if (changed.zone) formProps.form?.setFieldValue('baseUrl', `https://${changed.zone}`);
        formProps.onValuesChange?.(changed, all);
      }}
    >
      <Form.Item label={t('name')} name="name" rules={[{ required: true }]}>
        <Input placeholder={isMake ? t('namePlaceholderMake') : t('namePlaceholderN8n')} />
      </Form.Item>
      <Form.Item
        label={t('platform')}
        name="platform"
        initialValue="n8n"
        extra={isEdit ? t('platformLocked') : t('platformHint')}
      >
        <Select
          disabled={isEdit}
          onChange={(value) => setPlatform(value as 'n8n' | 'make')}
          options={[
            { value: 'n8n', label: 'n8n' },
            { value: 'make', label: 'Make.com' },
          ]}
        />
      </Form.Item>

      {/* L'ESSENTIEL d'abord : ce qu'il faut pour que la plateforme lise les workflows. */}
      {isMake ? (
        <>
          <Form.Item label={t('zone')} name="zone" rules={[{ required: true }]} extra={t('zoneHint')}>
            <Select placeholder="eu1.make.com" options={MAKE_ZONES.map((z) => ({ value: z, label: z }))} />
          </Form.Item>
          <Form.Item name="baseUrl" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            label={t('makeToken')}
            name="apiKey"
            rules={[{ required: !isEdit }]}
            extra={isEdit ? t('keepToken') : t('makeTokenHint')}
          >
            <Input.Password placeholder={isEdit ? t('tokenStored') : t('makeTokenPlaceholder')} />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item
            label={t('baseUrl')}
            name="baseUrl"
            rules={[{ required: true }]}
            extra={t('baseUrlHint')}
          >
            <Input placeholder="https://n8n.mondomaine.tld" />
          </Form.Item>
          <Form.Item
            label={t('apiKey')}
            name="apiKey"
            rules={[{ required: !isEdit }]}
            extra={isEdit ? t('keepKey') : undefined}
          >
            <Input.Password placeholder={isEdit ? t('keyStored') : t('apiKeyPlaceholder')} />
          </Form.Item>
        </>
      )}

      {/* L'ACCESSOIRE, replié : périmètre Make / compte du catalogue de nœuds /
          rattachement. Rien ici n'est requis pour connecter l'instance. */}
      <Collapse
        ghost
        style={{ marginBottom: 24 }}
        items={[
          {
            key: 'advanced',
            label: t('advanced'),
            forceRender: true,
            children: isMake ? (
              <>
                <Form.Item label={t('team')} name="externalTeamId" extra={t('teamHint')}>
                  <Input placeholder="2648401" />
                </Form.Item>
                <Form.Item label={t('org')} name="externalOrgId" extra={t('orgHint')}>
                  <Input placeholder="8875044" />
                </Form.Item>
                <ClientField clients={clients} />
              </>
            ) : (
              <>
                <Form.Item label={t('n8nAccount')} name="n8nEmail" extra={t('n8nAccountHint')}>
                  <Input placeholder="admin@mondomaine.tld" autoComplete="off" />
                </Form.Item>
                <Form.Item
                  label={t('n8nPassword')}
                  name="n8nPassword"
                  extra={isEdit ? t('keepPassword') : undefined}
                >
                  <Input.Password
                    placeholder={isEdit ? t('passwordStored') : t('passwordPlaceholder')}
                    autoComplete="new-password"
                  />
                </Form.Item>
                <ClientField clients={clients} />
              </>
            ),
          },
        ]}
      />
      <Button icon={<ApiOutlined />} loading={testing} onClick={() => testConnection(formProps.form)}>
        {t('testConnection')}
      </Button>
    </Form>
  );
}
