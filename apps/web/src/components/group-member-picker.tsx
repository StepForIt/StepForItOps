'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, Empty, Input, Space, Spin, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet } from '../lib/api';
import { WorkflowFamily } from '../app/workflows/workflow-row';
import { useEnvColor, useEnvLabel } from '../lib/envs';

/**
 * Choix des membres d'un groupe, une ligne par workflow MÉTIER et non par
 * exemplaire n8n. Un groupe contient des exemplaires (c'est eux qu'on duplique
 * et qu'on scanne), mais les composer un par un obligeait à retrouver « X - DEV »
 * puis « X - PROD » puis « X - PREPROD » dans une liste à plat de plusieurs
 * centaines d'entrées. Ici on coche le workflow, ses environnements suivent.
 */
export function GroupMemberPicker({
  instanceId,
  value = [],
  onChange,
}: {
  instanceId?: string;
  value?: string[];
  onChange?: (ids: string[]) => void;
}) {
  const t = useTranslations('settings.groupMemberPicker');
  const envColor = useEnvColor();
  const envLabel = useEnvLabel();
  const [families, setFamilies] = useState<WorkflowFamily[]>([]);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (!instanceId) {
      setFamilies([]);
      return;
    }
    setLoading(true);
    apiGet<WorkflowFamily[]>(
      `/workflows/families?_start=0&_end=500&_sort=name&_order=asc&instanceId=${encodeURIComponent(instanceId)}`,
    )
      .then(setFamilies)
      .catch(() => setFamilies([]))
      .finally(() => setLoading(false));
  }, [instanceId]);

  const selected = useMemo(() => new Set(value), [value]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return families;
    return families.filter(
      (family) =>
        family.name.toLowerCase().includes(needle) ||
        family.members.some((member) => member.name.toLowerCase().includes(needle)),
    );
  }, [families, term]);

  // Un membre archivé ou supprimé dans n8n ne ressort pas de `/families` : il
  // reste dans la sélection, personne ne l'ayant retiré, et on le dit plutôt que
  // de laisser croire à un compteur faux.
  const listedIds = useMemo(
    () => new Set(families.flatMap((family) => family.members.map((member) => member.id))),
    [families],
  );
  const hiddenCount = loading ? 0 : value.filter((id) => !listedIds.has(id)).length;

  const emit = (next: Set<string>) => onChange?.([...next]);

  const toggleMember = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit(next);
  };

  const toggleFamily = (family: WorkflowFamily, on: boolean) => {
    const next = new Set(selected);
    for (const member of family.members) {
      if (on) next.add(member.id);
      else next.delete(member.id);
    }
    emit(next);
  };

  if (!instanceId) {
    return <Typography.Text type="secondary">{t('chooseInstance')}</Typography.Text>;
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Space wrap>
        <Input.Search
          placeholder={t('filterPlaceholder')}
          allowClear
          style={{ width: 260 }}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <Typography.Text type="secondary">{t('selected', { count: selected.size })}</Typography.Text>
        {hiddenCount > 0 && (
          <Typography.Text type="secondary">{t('hidden', { count: hiddenCount })}</Typography.Text>
        )}
      </Space>
      <div
        style={{
          maxHeight: 380,
          overflowY: 'auto',
          border: '1px solid rgba(5,5,5,0.06)',
          borderRadius: 6,
          padding: 8,
        }}
      >
        {loading ? (
          <Spin size="small" />
        ) : visible.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('empty')} />
        ) : (
          visible.map((family) => (
            <FamilyLine
              key={family.id}
              family={family}
              selected={selected}
              onToggleFamily={(on) => toggleFamily(family, on)}
              onToggleMember={toggleMember}
              envColor={envColor}
              envLabel={envLabel}
            />
          ))
        )}
      </div>
    </Space>
  );
}

function FamilyLine({
  family,
  selected,
  onToggleFamily,
  onToggleMember,
  envColor,
  envLabel,
}: {
  family: WorkflowFamily;
  selected: Set<string>;
  onToggleFamily: (on: boolean) => void;
  onToggleMember: (id: string) => void;
  envColor: (env: string | null | undefined) => string;
  envLabel: (env: string | null | undefined) => string;
}) {
  const t = useTranslations('settings.groupMemberPicker');
  const chosen = family.members.filter((member) => selected.has(member.id)).length;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', flexWrap: 'wrap' }}>
      <Checkbox
        checked={chosen === family.members.length}
        indeterminate={chosen > 0 && chosen < family.members.length}
        onChange={(event) => onToggleFamily(event.target.checked)}
      >
        {family.name}
      </Checkbox>
      {family.members.map((member) => (
        <Tag
          key={member.id}
          color={selected.has(member.id) ? envColor(member.env) : undefined}
          style={{ cursor: 'pointer', opacity: selected.has(member.id) ? 1 : 0.55 }}
          onClick={() => onToggleMember(member.id)}
        >
          {member.env ? envLabel(member.env) : t('unknownEnv')}
        </Tag>
      ))}
    </div>
  );
}
