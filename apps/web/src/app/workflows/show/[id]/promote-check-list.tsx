'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Tag } from 'antd';
import { RemoteSchemaTables, RemoteTableView } from '../../../../components/remote-schema-tables';
import { PromoteCheck } from './promote-checks';
import type { PromotePreview } from './promote-modal';
import { BRAND } from '../../../../lib/brand/colors';
import type { useTranslations } from 'next-intl';

export type PromoteCheckT = ReturnType<typeof useTranslations<'workflowShow.promoteCheckList'>>;

const list = (items: React.ReactNode[]) => (
  <ul style={{ margin: 0, paddingLeft: 18 }}>
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

/** Ce qui manque sur la cible, nommé : « table X », « colonne Y ». */
function remoteMissingNames(tables: RemoteTableView[], t: PromoteCheckT): string[] {
  return tables.flatMap((table) =>
    table.status === 'missing'
      ? [t('remoteTable', { name: table.label ?? table.key })]
      : table.columns
          .filter((column) => column.present === false)
          .map((column) => t('quoted', { name: column.name })),
  );
}

export function buildPromoteChecks(
  preview: PromotePreview,
  remoteAvailable: boolean,
  t: PromoteCheckT,
  /** Libellé d'une règle dans la langue courante (`useRuleLabel`). */
  ruleLabel: (code: string) => string,
): PromoteCheck[] {
  const { gates } = preview;
  const checks: PromoteCheck[] = [];

  const findings = gates.findings;
  checks.push({
    key: 'findings',
    label: t('findings.label'),
    status: findings.ok ? 'ok' : 'error',
    summary: findings.ok ? t('ok') : t('findings.errors', { count: findings.errors }),
    detail: findings.ok ? undefined : (
      <>
        {list(
          findings.items.map((finding) => (
            <>
              <Tag>{finding.module}</Tag>
              <strong>{ruleLabel(finding.code)}</strong>
              {finding.nodeName && <span style={{ color: '#999' }}> — {finding.nodeName}</span>}
              <div>{finding.message}</div>
              {finding.suggestion && <div style={{ color: BRAND.success }}>→ {finding.suggestion}</div>}
            </>
          )),
        )}
        {findings.errors > findings.items.length && (
          <p style={{ margin: '4px 0' }}>
            {t('findings.more', { count: findings.errors - findings.items.length })}
          </p>
        )}
        <Link href="/findings">
          <Button size="small">{t('findings.open')}</Button>
        </Link>
      </>
    ),
  });

  const tests = gates.tests;
  checks.push({
    key: 'tests',
    label: t('tests.label'),
    status: tests === null ? 'neutral' : tests.ok ? 'ok' : 'error',
    summary:
      tests === null
        ? t('tests.none')
        : tests.ok
          ? tests.neverRun > 0
            ? t('tests.okNeverRun', { passed: tests.passed, total: tests.total, neverRun: tests.neverRun })
            : t('tests.ok', { passed: tests.passed, total: tests.total })
          : t('tests.failed', { count: tests.failed }),
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
    label: t('subs.label'),
    status: subs.total === 0 ? 'neutral' : subs.ok ? 'ok' : 'error',
    summary:
      subs.total === 0
        ? t('subs.none')
        : subs.ok
          ? subs.cascade > 0
            ? t('subs.okCascade', { mapped: subs.mapped, total: subs.total, cascade: subs.cascade })
            : t('subs.ok', { mapped: subs.mapped, total: subs.total })
          : t('subs.missing', { names: blockedSubs.map(subName).join(', ') }),
    detail:
      preview.subWorkflows.length === 0
        ? undefined
        : list(
            preview.subWorkflows.map((sub) => (
              <>
                {t('quoted', { name: subName(sub) })}{' '}
                {sub.targetArchived ? (
                  <Tag color="red">{t('subs.archived')}</Tag>
                ) : sub.status === 'mapped' ? (
                  <Tag color="green">{t('subs.mapped')}</Tag>
                ) : sub.status === 'unchanged' ? (
                  <Tag>{t('subs.unchanged')}</Tag>
                ) : sub.status === 'dynamic' ? (
                  <Tag color="orange">{t('subs.dynamic')}</Tag>
                ) : preview.cascade.some((c) => c.targetName === sub.targetName) ? (
                  <Tag color="blue">{t('subs.willCreate')}</Tag>
                ) : (
                  <Tag color="red">{t('subs.promoteFirst')}</Tag>
                )}
                <span style={{ color: '#999' }}> {t('subs.node', { name: sub.nodeName })}</span>
              </>
            )),
          ),
  });

  if (remoteAvailable) {
    const remote = gates.remoteSchema;
    const missing = remote ? remoteMissingNames(remote.tables, t) : [];
    checks.push({
      key: 'remote',
      label: t('remote.label'),
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
          ? t('remote.notChecked')
          : remote.tables.length === 0
            ? t('remote.none')
            : !remote.ok
              ? t('remote.missing', { names: missing.join(', ') })
              : remote.unverified.length > 0
                ? t('remote.unverified', { count: remote.unverified.length })
                : t('ok'),
      detail: remote && remote.tables.length > 0 ? <RemoteSchemaTables tables={remote.tables} /> : undefined,
    });
  }

  const credentials = gates.credentials;
  checks.push({
    key: 'credentials',
    label: t('credentials.label'),
    status: credentials.ok ? 'ok' : 'warning',
    summary: credentials.ok ? t('ok') : t('credentials.missing', { names: credentials.missing.join(', ') }),
  });

  if (preview.unmapped.length > 0) {
    checks.push({
      key: 'unmapped',
      label: t('unmapped.label'),
      status: 'warning',
      summary: t('unmapped.summary', { names: preview.unmapped.map((r) => r.label ?? r.key).join(', ') }),
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
              {t('unmapped.declare')}
            </Button>
          </Link>
        </>
      ),
    });
  }

  return checks;
}
