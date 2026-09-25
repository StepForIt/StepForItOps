'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Popconfirm,
  Radio,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { Table } from '../../components/resizable-table';
import { DownloadOutlined, ImportOutlined, InboxOutlined } from '@ant-design/icons';
import { API_URL, apiGet, apiPost } from '../../lib/api';
import { FieldLabel } from '../../components/field-label';

type ImportStrategy = 'merge' | 'skip-existing';

interface SectionReport {
  created: number;
  updated: number;
  skipped: number;
}

interface ImportReport {
  dryRun: boolean;
  strategy: ImportStrategy;
  sections: Record<string, SectionReport>;
  warnings: string[];
}

interface ConfigBundle {
  kind: string;
  version: number;
  exportedAt: string;
  includesSecrets: boolean;
  [key: string]: unknown;
}

const SECTION_LABELS: Record<string, string> = {
  instances: 'Instances',
  exportTargets: 'Cibles export (GitHub / Drive)',
  resourceMappings: "Mappings d'environnement",
  monitors: 'Monitors',
  monitoringSettings: 'Réglages monitoring (Uptime Kuma)',
  aiSettings: 'Réglages IA',
  moduleStates: 'Modules (activation + réglages)',
  platformSettings: 'Réglages généraux',
  findingIgnores: 'Exclusions de findings',
  workflowGroups: 'Groupes de workflows',
  workflowLinks: 'Liens manuels (carte)',
};

export default function ConfigTransferPage() {
  const [includeSecrets, setIncludeSecrets] = useState(true);
  const [exporting, setExporting] = useState(false);
  // null tant que l'API n'a pas répondu : on n'affiche ni le bouton ni le refus
  // avant de savoir, pour ne pas faire clignoter l'un puis l'autre.
  const [exportEnabled, setExportEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    apiGet<{ exportEnabled: boolean }>('/config-transfer/capabilities')
      .then((c) => setExportEnabled(c.exportEnabled))
      .catch(() => setExportEnabled(false));
  }, []);

  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [fileName, setFileName] = useState('');
  const [strategy, setStrategy] = useState<ImportStrategy>('merge');
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);

  const download = async () => {
    setExporting(true);
    try {
      const response = await fetch(`${API_URL}/config-transfer/export?includeSecrets=${includeSecrets}`);
      if (!response.ok) throw new Error(`Export → ${response.status}`);
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nwm-config-${new Date().toISOString().slice(0, 10)}${includeSecrets ? '' : '-sans-secrets'}.json`;
      link.click();
      URL.revokeObjectURL(url);
      message.success('Configuration exportée');
    } catch (error) {
      message.error(`Échec de l'export : ${(error as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const runPreview = async (nextBundle: ConfigBundle, nextStrategy: ImportStrategy) => {
    try {
      const report = await apiPost<ImportReport>('/config-transfer/import', {
        bundle: nextBundle,
        strategy: nextStrategy,
        dryRun: true,
      });
      setPreview(report);
    } catch (error) {
      setBundle(null);
      setPreview(null);
      message.error(`Fichier refusé : ${(error as Error).message}`);
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as ConfigBundle;
        setResult(null);
        setBundle(parsed);
        setFileName(file.name);
        void runPreview(parsed, strategy);
      } catch {
        message.error("Ce fichier n'est pas un JSON valide");
      }
    };
    reader.readAsText(file);
    return false; // pas d'upload auto : tout passe par l'endpoint d'import
  };

  const changeStrategy = (next: ImportStrategy) => {
    setStrategy(next);
    if (bundle) void runPreview(bundle, next);
  };

  const doImport = async () => {
    if (!bundle) return;
    setImporting(true);
    try {
      const report = await apiPost<ImportReport>('/config-transfer/import', {
        bundle,
        strategy,
        dryRun: false,
      });
      setResult(report);
      setPreview(null);
      setBundle(null);
      message.success('Configuration importée');
    } catch (error) {
      message.error(`Échec de l'import : ${(error as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const reportRows = (report: ImportReport) =>
    Object.entries(report.sections).map(([key, counts]) => ({
      key,
      section: SECTION_LABELS[key] ?? key,
      ...counts,
    }));

  const reportTable = (report: ImportReport) => (
    <Table
      dataSource={reportRows(report)}
      pagination={false}
      size="small"
      columns={[
        { dataIndex: 'section', title: 'Section' },
        {
          dataIndex: 'created',
          title: report.dryRun ? 'À créer' : 'Créés',
          render: (n: number) => (n > 0 ? <Tag color="green">{n}</Tag> : <span>0</span>),
        },
        {
          dataIndex: 'updated',
          title: report.dryRun ? 'À mettre à jour' : 'Mis à jour',
          render: (n: number) => (n > 0 ? <Tag color="blue">{n}</Tag> : <span>0</span>),
        },
        {
          dataIndex: 'skipped',
          title: report.dryRun ? 'Ignorés (existants)' : 'Ignorés',
          render: (n: number) => (n > 0 ? <Tag>{n}</Tag> : <span>0</span>),
        },
      ]}
    />
  );

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="Exporter la configuration">
        <Space direction="vertical">
          <Typography.Text type="secondary">
            Génère un fichier JSON contenant les instances n8n, les cibles d'export, les mappings
            d'environnement, les monitors, les réglages (IA, monitoring, généraux), l'état des modules, les
            exclusions de findings, les groupes de workflows et les liens manuels de la carte — à importer sur
            une autre instance de la plateforme. Les workflows et leurs versions ne font pas partie de
            l'export (ils se resynchronisent depuis n8n).
          </Typography.Text>
          {exportEnabled === false && (
            <Alert
              type="warning"
              showIcon
              message="Export désactivé sur cette installation"
              description="Le fichier sortirait en clair les clés API n8n, les tokens GitHub / Drive, le mot de passe Uptime Kuma, les clés des fournisseurs IA et les jetons de heartbeat. L'export ne s'ouvre qu'en local (CONFIG_EXPORT_ENABLED=1, posé par docker-compose.override.yml), là où le fichier ne quitte pas la machine. L'import ci-dessous reste disponible."
            />
          )}
          {exportEnabled === true && (
            <>
              <Checkbox checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)}>
                Inclure les secrets (clés API n8n, tokens GitHub / Drive)
              </Checkbox>
              {includeSecrets && (
                <Alert
                  type="warning"
                  showIcon
                  message="Le fichier contiendra des secrets en clair : ne le partagez pas et supprimez-le après import."
                />
              )}
              <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={download}>
                Télécharger la configuration
              </Button>
            </>
          )}
        </Space>
      </Card>

      <Card title="Importer une configuration">
        <Space direction="vertical" style={{ width: '100%' }}>
          <FieldLabel htmlFor="config-import-file" required>
            Fichier de configuration
          </FieldLabel>
          <Upload.Dragger
            id="config-import-file"
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={onFile}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Déposez le fichier de configuration ici (ou cliquez)</p>
            <p className="ant-upload-hint">Fichier JSON généré par l'export d'une autre instance</p>
          </Upload.Dragger>

          <Alert
            type="info"
            showIcon
            message="Sur une base vierge, importez en deux passes"
            description="Les monitors, exclusions, groupes et liens manuels pointent vers des workflows : ils ne se rétablissent qu'une fois ceux-ci synchronisés. 1) importez (les instances sont créées), 2) synchronisez les workflows depuis la page Instances, 3) ré-importez le même fichier en « Fusionner » — les références manquantes signalées ci-dessous se recolleront."
          />

          <Radio.Group value={strategy} onChange={(e) => changeStrategy(e.target.value as ImportStrategy)}>
            <Radio.Button value="merge">Fusionner (met à jour l'existant)</Radio.Button>
            <Radio.Button value="skip-existing">Ne pas toucher l'existant</Radio.Button>
          </Radio.Group>

          {bundle && preview && (
            <>
              <Alert
                type="info"
                showIcon
                message={`Prévisualisation de « ${fileName} » (export du ${new Date(bundle.exportedAt).toLocaleString()}${bundle.includesSecrets ? ', avec secrets' : ', sans secrets'})`}
                description="Rien n'a encore été écrit : vérifiez puis confirmez l'import."
              />
              {reportTable(preview)}
              {preview.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="Avertissements"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  }
                />
              )}
              <Popconfirm title="Appliquer cet import ?" okText="Importer" onConfirm={doImport}>
                <Button type="primary" icon={<ImportOutlined />} loading={importing}>
                  Importer
                </Button>
              </Popconfirm>
            </>
          )}

          {result && (
            <>
              <Alert type="success" showIcon message="Import terminé" />
              {reportTable(result)}
              {result.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="Avertissements"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {result.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  }
                />
              )}
            </>
          )}
        </Space>
      </Card>
    </Space>
  );
}
