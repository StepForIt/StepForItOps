'use client';

import React, { useEffect, useState } from 'react';
import { Button, Collapse, Form, Input, Select, message } from 'antd';
import type { FormInstance, FormProps } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
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
  return (
    <Form.Item
      label="Client"
      name="clientId"
      extra="Rattachement pour les vues agrégées (dashboard, coûts, temps gagné). Les clients se créent dans Paramètres → Clients."
    >
      <Select
        allowClear
        placeholder="Aucun"
        options={clients.map((client) => ({ value: client.id, label: client.name }))}
      />
    </Form.Item>
  );
}

/** Formulaire commun create/edit d'une instance, avec test de connexion avant sauvegarde. */
export function InstanceForm({ formProps, instanceId }: InstanceFormProps) {
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
      message.warning('Choisis la zone Make avant de tester');
      return;
    }
    if (!baseUrl || (!apiKey && !isEdit)) {
      message.warning("Renseigne l'URL et la clé API avant de tester");
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
          `Connexion OK — ${result.workflowCount} ${isMake ? 'scénarios' : 'workflows'} visibles`,
        );
      else message.error(`Connexion KO : ${result.error}`);
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
      <Form.Item label="Nom" name="name" rules={[{ required: true }]}>
        <Input placeholder={isMake ? 'Make — équipe principale' : 'n8n principal'} />
      </Form.Item>
      <Form.Item
        label="Plateforme"
        name="platform"
        initialValue="n8n"
        extra={
          isEdit
            ? "La plateforme ne se change pas après coup : les workflows déjà en base sont du format de l'ancienne, et rien ne saurait les relire."
            : "n8n (auto-hébergé) ou Make (SaaS). Ce choix décide de la façon dont le contenu des workflows est lu — il n'est jamais deviné."
        }
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
          <Form.Item
            label="Zone"
            name="zone"
            rules={[{ required: true }]}
            extra="Celle qui figure dans l'URL quand tu es connecté à Make. Un jeton d'une zone est refusé par les autres, avec le même message qu'un droit manquant : c'est la première chose à vérifier si la connexion échoue."
          >
            <Select placeholder="eu1.make.com" options={MAKE_ZONES.map((z) => ({ value: z, label: z }))} />
          </Form.Item>
          <Form.Item name="baseUrl" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            label="Jeton d'API"
            name="apiKey"
            rules={[{ required: !isEdit }]}
            extra={
              isEdit
                ? 'Laisser vide pour conserver le jeton actuel.'
                : 'Créé dans Make : profil → API access → Add token. La lecture suffit : scenarios:read, teams:read, organizations:read.'
            }
          >
            <Input.Password placeholder={isEdit ? 'Jeton enregistré — non affiché' : 'Jeton Make'} />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item
            label="URL de base"
            name="baseUrl"
            rules={[{ required: true }]}
            extra="L'environnement n'est pas lié à l'instance : il est déduit par workflow (tag env:dev ou suffixe « - DEV » dans le nom)."
          >
            <Input placeholder="https://n8n.mondomaine.tld" />
          </Form.Item>
          <Form.Item
            label="Clé API"
            name="apiKey"
            rules={[{ required: !isEdit }]}
            extra={isEdit ? 'Laisser vide pour conserver la clé actuelle.' : undefined}
          >
            <Input.Password
              placeholder={isEdit ? 'Clé enregistrée — non affichée' : 'Créée dans n8n : Settings → n8n API'}
            />
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
            label: 'Options avancées',
            forceRender: true,
            children: isMake ? (
              <>
                <Form.Item
                  label="Team"
                  name="externalTeamId"
                  extra="L'id numérique de la team dont on liste les scénarios — il est dans l'URL de Make. Make refuse de lister sans team ni organisation ; la team est la plus précise des deux."
                >
                  <Input placeholder="2648401" />
                </Form.Item>
                <Form.Item
                  label="Organisation (à défaut de team)"
                  name="externalOrgId"
                  extra="À ne renseigner que pour couvrir toutes les teams d'une organisation."
                >
                  <Input placeholder="8875044" />
                </Form.Item>
                <ClientField clients={clients} />
              </>
            ) : (
              <>
                <Form.Item
                  label="Compte n8n (facultatif)"
                  name="n8nEmail"
                  extra={
                    "La clé API n'ouvre que l'API publique. La description des nœuds — leurs paramètres et " +
                    'les valeurs admises — est servie ailleurs, derrière la session du navigateur. Avec ce ' +
                    'compte, les contrôles portent sur TA version de n8n et tes nœuds communautaires ; sans ' +
                    'lui, la plateforme se rabat sur un catalogue mutualisé, plus générique. Laisser vide ' +
                    'pour retirer le compte.'
                  }
                >
                  <Input placeholder="admin@mondomaine.tld" autoComplete="off" />
                </Form.Item>
                <Form.Item
                  label="Mot de passe n8n"
                  name="n8nPassword"
                  extra={isEdit ? 'Laisser vide pour conserver le mot de passe actuel.' : undefined}
                >
                  <Input.Password
                    placeholder={isEdit ? 'Enregistré — non affiché' : 'Le mot de passe de ce compte n8n'}
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
        Tester la connexion
      </Button>
    </Form>
  );
}
