'use client';

import React, { useState } from 'react';
import { List } from '@refinedev/antd';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { useInvalidate, useUpdate } from '@refinedev/core';
import { Button, Popconfirm, Switch, Tag } from 'antd';
import { Table } from '../../components/resizable-table';
import { RobotOutlined } from '@ant-design/icons';
import { AiSettingsModal } from '../../components/ai-settings-modal';
import { PlatformSettingsCard } from '../../components/platform-settings-card';
import { EnvChainCard } from '../../components/env-chain-card';
import { NodeCatalogCard } from '../../components/node-catalog-card';
import { useEnabledModules } from '../../lib/enabled-modules';

interface ModuleView {
  id: string;
  name: string;
  description: string;
  core: boolean;
  enabled: boolean;
}

/**
 * Ce qui S'ARRÊTE quand on coupe un module — nommé avant le clic, comme le fait
 * déjà l'archivage d'un workflow (workflow-actions.tsx). Couper un module a un
 * effet immédiat côté serveur (crons, écoute d'événements) : l'énoncer évite de
 * l'apprendre après coup. Sans entrée dédiée, on retombe sur un effet générique.
 */
const MODULE_DISABLE_EFFECTS: Record<string, string> = {
  monitoring:
    "La surveillance des erreurs d'exécution et les heartbeats s'arrêtent : plus aucune alerte tant que le module reste coupé.",
  performance:
    "L'historisation des durées et statuts d'exécution s'arrête ; la page Performance et les alertes de dérive ne sont plus alimentées.",
  notifier:
    'Plus aucune alerte ne part vers Slack ou les webhooks (nouveaux problèmes, rechutes, dérives de durée, budget IA).',
  versioning: "Les snapshots de workflows et l'export GitHub / Google Drive s'arrêtent.",
  verifier: 'La vérification structurelle, les checks de fiabilité et la revue logique IA ne tournent plus.',
  'js-checker': "L'analyse des nœuds Code (syntaxe + revue IA) s'arrête.",
  'field-checker': "Le contrôle des champs référencés dans les expressions s'arrête.",
  'remote-schema':
    'La vérification des colonnes des tables distantes (Airtable, NocoDB, Notion, Sheets, PostgreSQL) s’arrête.',
  tester: 'Les tests de workflows et le bouchonnage guidé ne sont plus disponibles.',
  'env-switcher': "La bascule de ressources entre environnements et la promotion inter-instances s'arrêtent.",
  organizer: 'Le plan de rangement / naming (IA) et son application ne sont plus disponibles.',
  'doc-schema': "La génération de schéma Mermaid et de résumé IA s'arrête.",
  'dep-graph': 'La carte des workflows et la page Ressources externes disparaissent.',
  optimizer: "La détection de naming / nœuds inutiles et le renommage sûr s'arrêtent.",
  'model-audit': "L'audit continu des modèles LLM (adéquation, cycle de vie, surdimensionnement) s'arrête.",
  'ai-cost': "Le suivi des coûts LLM s'arrête ; la page Coûts IA n'est plus alimentée.",
  'app-logs': 'La page des logs applicatifs disparaît (la capture des logs, hors du module, continue).',
  'resource-discovery': "La découverte des bases / tables réelles s'arrête.",
  'config-transfer': "L'export / import de la configuration n'est plus disponible.",
  dashboard: 'La home agrégée retombe sur la grille de raccourcis.',
  'assistant-learning': "L'assistant n'apprend plus de tes corrections.",
  'workflow-chat': "L'assistant IA (chat, correctifs, création guidée) n'est plus disponible.",
};

function disableEffect(module: ModuleView): string {
  return MODULE_DISABLE_EFFECTS[module.id] ?? 'Ses fonctions et sa page disparaissent de la console.';
}

export default function ModulesPage() {
  const { tableProps } = useTable<ModuleView>({ resource: 'modules', pagination: { mode: 'off' } });
  const { mutate } = useUpdate();
  const invalidate = useInvalidate();
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const { refresh: refreshMenu } = useEnabledModules();

  const toggle = (record: ModuleView, enabled: boolean) => {
    mutate(
      { resource: 'modules', id: record.id, values: { enabled } },
      {
        onSuccess: () => {
          invalidate({ resource: 'modules', invalidates: ['list'] });
          // le menu se cale sur les modules activés : il doit suivre le basculement
          refreshMenu();
        },
      },
    );
  };

  return (
    <List
      title="Modules de la plateforme"
      headerButtons={
        <Button icon={<RobotOutlined />} onClick={() => setAiModalOpen(true)}>
          Réglages IA
        </Button>
      }
    >
      <PlatformSettingsCard />
      <EnvChainCard />
      <NodeCatalogCard />
      <Table {...tableProps} rowKey="id" pagination={false}>
        <Table.Column<ModuleView>
          dataIndex="name"
          title="Module"
          sorter={(a, b) => a.name.localeCompare(b.name)}
          defaultSortOrder="ascend"
        />
        <Table.Column dataIndex="description" title="Description" />
        <Table.Column
          dataIndex="core"
          title="Type"
          render={(core: boolean) => (core ? <Tag color="purple">core</Tag> : <Tag>optionnel</Tag>)}
        />
        <Table.Column<ModuleView>
          dataIndex="enabled"
          title="Activé"
          render={(enabled: boolean, record) => (
            // Activer est direct ; DÉSACTIVER passe par une confirmation qui nomme
            // l'effet — l'interrupteur reste sur ON tant qu'elle n'est pas validée
            // (onChange ignore la valeur `false`, seul onConfirm coupe vraiment).
            <Popconfirm
              title={`Désactiver « ${record.name} » ?`}
              description={<div style={{ maxWidth: 320 }}>{disableEffect(record)}</div>}
              okText="Désactiver"
              cancelText="Annuler"
              okButtonProps={{ danger: true }}
              disabled={record.core || !enabled}
              onConfirm={() => toggle(record, false)}
            >
              <Switch
                checked={enabled}
                disabled={record.core}
                onChange={(value) => {
                  if (value) toggle(record, true);
                }}
              />
            </Popconfirm>
          )}
        />
      </Table>
      <AiSettingsModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} onChanged={() => undefined} />
    </List>
  );
}
