'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Tag } from 'antd';
import { ruleLabel } from '../../../../lib/finding-rules';
import { RemoteSchemaTables, RemoteTableView } from '../../../../components/remote-schema-tables';
import { PromoteCheck } from './promote-checks';
import type { PromotePreview } from './promote-modal';

const list = (items: React.ReactNode[]) => (
  <ul style={{ margin: 0, paddingLeft: 18 }}>
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

/** Ce qui manque sur la cible, nommé : « table X », « colonne Y ». */
function remoteMissingNames(tables: RemoteTableView[]): string[] {
  return tables.flatMap((table) =>
    table.status === 'missing'
      ? [`table « ${table.label ?? table.key} »`]
      : table.columns.filter((column) => column.present === false).map((column) => `« ${column.name} »`),
  );
}

export function buildPromoteChecks(preview: PromotePreview, remoteAvailable: boolean): PromoteCheck[] {
  const { gates } = preview;
  const checks: PromoteCheck[] = [];

  const findings = gates.findings;
  checks.push({
    key: 'findings',
    label: 'Vérification',
    status: findings.ok ? 'ok' : 'error',
    summary: findings.ok ? 'OK' : `${findings.errors} erreur(s)`,
    detail: findings.ok ? undefined : (
      <>
        {list(
          findings.items.map((finding) => (
            <>
              <Tag>{finding.module}</Tag>
              <strong>{ruleLabel(finding.code)}</strong>
              {finding.nodeName && <span style={{ color: '#999' }}> — {finding.nodeName}</span>}
              <div>{finding.message}</div>
              {finding.suggestion && <div style={{ color: '#389e0d' }}>→ {finding.suggestion}</div>}
            </>
          )),
        )}
        {findings.errors > findings.items.length && (
          <p style={{ margin: '4px 0' }}>… et {findings.errors - findings.items.length} autre(s).</p>
        )}
        <Link href="/findings">
          <Button size="small">Ouvrir les findings</Button>
        </Link>
      </>
    ),
  });

  const tests = gates.tests;
  checks.push({
    key: 'tests',
    label: 'Tests',
    status: tests === null ? 'neutral' : tests.ok ? 'ok' : 'error',
    summary:
      tests === null
        ? 'aucun cas de test'
        : tests.ok
          ? `${tests.passed}/${tests.total} OK${tests.neverRun > 0 ? ` · ${tests.neverRun} jamais joué(s)` : ''}`
          : `${tests.failed} en échec (onglet Test)`,
  });

  const subs = gates.subWorkflows;
  const subName = (sub: PromotePreview['subWorkflows'][number]) =>
    sub.targetName ?? sub.sourceName ?? sub.sourceN8nId;
  const blockedSubs = preview.subWorkflows.filter(
    (sub) =>
      (sub.status === 'missing' && !preview.cascade.some((c) => c.targetName === sub.targetName)) ||
      sub.targetArchived,
  );
  checks.push({
    key: 'sub-workflows',
    label: 'Sous-workflows',
    status: subs.total === 0 ? 'neutral' : subs.ok ? 'ok' : 'error',
    summary:
      subs.total === 0
        ? 'aucun'
        : subs.ok
          ? `${subs.mapped}/${subs.total} trouvé(s)${subs.cascade > 0 ? ` · ${subs.cascade} à créer` : ''}`
          : `introuvable(s) : ${blockedSubs.map(subName).join(', ')}`,
    detail:
      preview.subWorkflows.length === 0
        ? undefined
        : list(
            preview.subWorkflows.map((sub) => (
              <>
                « {subName(sub)} »{' '}
                {sub.targetArchived ? (
                  <Tag color="red">archivé sur la cible</Tag>
                ) : sub.status === 'mapped' ? (
                  <Tag color="green">trouvé</Tag>
                ) : sub.status === 'unchanged' ? (
                  <Tag>inchangé</Tag>
                ) : sub.status === 'dynamic' ? (
                  <Tag color="orange">id calculé à l&apos;exécution, à vérifier</Tag>
                ) : preview.cascade.some((c) => c.targetName === sub.targetName) ? (
                  <Tag color="blue">sera créé</Tag>
                ) : (
                  <Tag color="red">à promouvoir d&apos;abord</Tag>
                )}
                <span style={{ color: '#999' }}> — nœud {sub.nodeName}</span>
              </>
            )),
          ),
  });

  if (remoteAvailable) {
    const remote = gates.remoteSchema;
    const missing = remote ? remoteMissingNames(remote.tables) : [];
    checks.push({
      key: 'remote',
      label: 'Tables distantes',
      status:
        remote === null || remote.tables.length === 0
          ? 'neutral'
          : !remote.ok
            ? 'error'
            : remote.unverified.length > 0
              ? 'warning'
              : 'ok',
      summary:
        remote === null
          ? 'non vérifiées'
          : remote.tables.length === 0
            ? 'aucune'
            : !remote.ok
              ? `manquant sur la cible : ${missing.join(', ')}`
              : remote.unverified.length > 0
                ? `${remote.unverified.length} non vérifiée(s)`
                : 'OK',
      detail: remote && remote.tables.length > 0 ? <RemoteSchemaTables tables={remote.tables} /> : undefined,
    });
  }

  const credentials = gates.credentials;
  checks.push({
    key: 'credentials',
    label: 'Credentials',
    status: credentials.ok ? 'ok' : 'warning',
    summary: credentials.ok ? 'OK' : `absents de la cible : ${credentials.missing.join(', ')}`,
  });

  if (preview.unmapped.length > 0) {
    checks.push({
      key: 'unmapped',
      label: 'Ressources non basculées',
      status: 'warning',
      summary: `${preview.unmapped.map((r) => r.label ?? r.key).join(', ')} — resteront sur les mêmes données`,
      detail: (
        <>
          {list(
            preview.unmapped.map((r) => (
              <>
                <Tag>{r.provider}</Tag>
                {r.label ?? r.key} <span style={{ color: '#999' }}>({r.nodes.join(', ')})</span>
              </>
            )),
          )}
          <Link href="/resource-mappings/create">
            <Button size="small" style={{ marginTop: 4 }}>
              Déclarer un mapping
            </Button>
          </Link>
        </>
      ),
    });
  }

  return checks;
}
