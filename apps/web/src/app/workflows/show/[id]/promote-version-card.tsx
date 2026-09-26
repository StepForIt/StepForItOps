'use client';

import React from 'react';
import { Descriptions, Radio, Space, Tag, Tooltip, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { useEnvColor, useEnvLabel } from '../../../../lib/envs';

export type BumpLevel = 'major' | 'minor' | 'patch';

/**
 * La reprise (`none`) n'est pas un incrément de zéro : c'est le refus d'en faire
 * un, parce que le contenu qui part est déjà celui que la source porte sous son
 * numéro. Repousser le même workflow d'un env au suivant ne publie rien.
 */
export type ReleaseLevel = BumpLevel | 'none';

export interface PromoteVersionGate {
  ok: boolean;
  current: Array<{ env: string | null; instanceName: string; name: string; version: string | null }>;
  sourceVersion: string | null;
  targetVersion: string | null;
  next: string;
  /** Nom de la cible une fois le numéro reporté dedans, ou null si le nom n'en porte pas. */
  nextName: string | null;
  level: ReleaseLevel;
  reason: string;
  source: 'ai' | 'rules' | 'human';
}

const LEVELS: ReleaseLevel[] = ['major', 'minor', 'patch', 'none'];

/**
 * Le calcul est le même côté API (`nextVersion`), refait ici pour que changer de
 * niveau réponde tout de suite : recharger l'aperçu à chaque clic ferait aussi
 * perdre la raison proposée par l'IA, qui n'est calculée qu'une fois.
 */
export function bumpVersion(base: string, level: BumpLevel): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(base.trim());
  if (!match) return base;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Le numéro que portera la promotion pour un niveau donné. La reprise reporte
 * celui de la SOURCE et non le maximum de la famille : un env resté en avance ne
 * doit pas tirer vers le haut un contenu qui, lui, n'a pas changé.
 */
export function versionForLevel(gate: PromoteVersionGate, level: ReleaseLevel): string {
  if (level === 'none') return gate.sourceVersion ?? gate.next;
  const base = highestVersion(gate);
  return base ? bumpVersion(base, level) : gate.next;
}

/** La plus haute version du workflow métier : c'est elle qu'on incrémente. */
export function highestVersion(gate: PromoteVersionGate): string | null {
  const parsed = gate.current
    .map((row) => /^(\d+)\.(\d+)\.(\d+)$/.exec((row.version ?? '').trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const);
  if (parsed.length === 0) return null;
  const max = parsed.reduce((best, candidate) => {
    const diff = candidate[0] - best[0] || candidate[1] - best[1] || candidate[2] - best[2];
    return diff > 0 ? candidate : best;
  });
  return max.join('.');
}

/**
 * Le nom que portera la cible pour un autre niveau que celui proposé. L'API a
 * déjà situé le numéro dans le nom (`nextName`) : il suffit d'y remplacer le sien.
 */
export function nameForVersion(gate: PromoteVersionGate, version: string): string | null {
  if (!gate.nextName) return null;
  return gate.nextName.replace(gate.next, version);
}

/**
 * Version posée par la promotion. Le numéro n'est pas décoratif : il dit à quel
 * point deux environnements sont d'accord, et c'est le seul endroit où l'on voit
 * qu'une prod a reçu quelque chose que la source n'a pas.
 */
export function PromoteVersionCard({
  gate,
  level,
  onLevel,
  touched,
}: {
  gate: PromoteVersionGate;
  level: ReleaseLevel;
  onLevel: (level: ReleaseLevel) => void;
  /** Exemplaires qui recevront le numéro (par nom), et l'env de la cible si elle est créée. */
  touched?: { names: string[]; createdEnv?: string };
}) {
  const t = useTranslations('workflowShow.promoteVersion');
  const envColor = useEnvColor();
  const envLabel = useEnvLabel();
  const base = highestVersion(gate);
  const next = versionForLevel(gate, level);
  const nextName = nameForVersion(gate, next);

  return (
    <Descriptions size="small" column={1} bordered title={t('title')}>
      <Descriptions.Item label={t('today')}>
        {gate.current.length === 0 ? (
          <Typography.Text type="secondary">{t('noneVersioned')}</Typography.Text>
        ) : (
          <Space size={4} wrap>
            {gate.current.map((row) => (
              <Tooltip key={`${row.instanceName}:${row.name}`} title={`${row.name} — ${row.instanceName}`}>
                <Tag color={row.env ? envColor(row.env) : undefined}>
                  {row.env ? envLabel(row.env) : '?'} {row.version ?? '—'}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t('after')}>
        {!touched ? (
          <Tag color="green">{next}</Tag>
        ) : (
          <Space size={4} wrap>
            {gate.current.map((row) => {
              const changes = touched.names.includes(row.name);
              return (
                <Tag
                  key={`${row.instanceName}:${row.name}`}
                  color={changes && row.env ? envColor(row.env) : undefined}
                  style={changes ? { fontWeight: 600 } : { opacity: 0.6 }}
                >
                  {row.env ? envLabel(row.env) : '?'} {changes ? next : (row.version ?? '—')}
                </Tag>
              );
            })}
            {touched.createdEnv && (
              <Tag color={envColor(touched.createdEnv)} style={{ fontWeight: 600 }}>
                {envLabel(touched.createdEnv)} {next}
              </Tag>
            )}
            {level === 'none' && <Typography.Text type="secondary">{t('keptAsIs')}</Typography.Text>}
          </Space>
        )}
      </Descriptions.Item>
      {nextName && (
        // Le numéro vit AUSSI dans le nom, côté n8n : promouvoir renomme, et c'est
        // la seule moitié de l'opération que l'équipe verra sans ouvrir la plateforme.
        <Descriptions.Item label={t('nameInN8n')}>
          <Typography.Text>{t('quotedName', { name: nextName })}</Typography.Text>{' '}
          <Typography.Text type="secondary">{t('sourceAndTarget')}</Typography.Text>
        </Descriptions.Item>
      )}
      <Descriptions.Item label={t('level')}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Radio.Group
            size="small"
            optionType="button"
            value={level}
            // Sans version existante, le niveau ne change rien au numéro (1.0.0) :
            // le proposer quand même laisserait croire à un choix sans effet.
            disabled={!base}
            onChange={(event) => onLevel(event.target.value)}
            // Rien à reprendre tant que la source ne porte aucun numéro : la
            // reprise reporterait alors un numéro qui n'existe pas.
            options={LEVELS.map((entry) => ({
              value: entry,
              label: t(`levels.${entry}.label`),
              disabled: entry === 'none' && !gate.sourceVersion,
            }))}
          />
          <Typography.Text type="secondary">
            {gate.source === 'human' ? (
              t(`levels.${level}.hint`)
            ) : (
              <>
                <Tag color={gate.source === 'ai' ? 'purple' : 'default'}>
                  {gate.source === 'ai' ? t('byAi') : t('byRule')}
                </Tag>
                {gate.reason}
              </>
            )}
          </Typography.Text>
        </Space>
      </Descriptions.Item>
    </Descriptions>
  );
}
