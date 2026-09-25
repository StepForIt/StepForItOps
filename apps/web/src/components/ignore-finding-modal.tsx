'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Input, Modal, Radio, Space, Tag, Typography, message } from 'antd';
import { apiPost } from '../lib/api';
import { ruleLabel } from '../lib/finding-rules';
import { useEnvs } from '../lib/envs';

export interface IgnorableFinding {
  id: string;
  module: string;
  severity: string;
  code: string;
  message: string;
  nodeName?: string | null;
}

type Scope = 'workflow' | 'family' | 'global';

interface Props {
  /** Findings à ignorer (un, ou tout un groupe) ; liste vide / null = modal fermée. */
  findings: IgnorableFinding[] | null;
  onClose: () => void;
  /** Appelé après création des règles (pour recharger la liste). */
  onIgnored: () => void;
}

/**
 * Confirmation « ce finding est normal » : crée une règle d'exclusion durable
 * (les prochaines analyses ne le remonteront plus).
 *
 * Portée par défaut : tous les environnements du workflow. Un finding déclaré
 * normal en dev l'est aussi dans les envs qui suivent — sinon la même règle se
 * recrée à chaque env, et l'oubli d'un seul suffit à faire revenir le bruit.
 */
export function IgnoreFindingModal({ findings, onClose, onIgnored }: Props) {
  const envLabels = useEnvs()
    .envs.map((env) => env.label)
    .join(', ');
  const [scope, setScope] = useState<Scope>('family');
  const [nodeScope, setNodeScope] = useState<'node' | 'any-node'>('node');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const open = !!findings && findings.length > 0;

  useEffect(() => {
    if (open) {
      setScope('family');
      setNodeScope('node');
      setReason('');
    }
  }, [open]);

  // Une règle par (module, code, nœud) : plusieurs findings d'un groupe se
  // ramènent souvent à la même règle, et la créer deux fois ne servirait à rien.
  const rules = dedupeRules(findings ?? []);
  const withNode = rules.some((rule) => rule.nodeName);

  const confirm = async () => {
    if (!findings || findings.length === 0) return;
    setBusy(true);
    try {
      for (const rule of rules) {
        await apiPost(`/finding-ignores/from-finding/${rule.id}`, {
          scope,
          nodeScope: rule.nodeName ? nodeScope : 'any-node',
          reason: reason.trim() || undefined,
        });
      }
      message.success(
        rules.length === 1
          ? 'Finding ignoré — il ne remontera plus dans les analyses'
          : `${rules.length} règles créées — ces findings ne remonteront plus`,
      );
      onIgnored();
      onClose();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={rules.length > 1 ? `Ignorer ces ${rules.length} findings ?` : 'Ignorer ce finding ?'}
      open={open}
      onCancel={onClose}
      onOk={confirm}
      okText="Ignorer définitivement"
      okButtonProps={{ danger: true, loading: busy }}
      cancelText="Annuler"
      width={640}
    >
      {open && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Règle durable"
            description="Le finding est supprimé et ne sera plus recréé par les prochaines analyses. Tu peux le réactiver depuis la page « Findings ignorés »."
          />
          <div>
            {rules.map((rule) => (
              <div key={rule.id} style={{ marginBottom: 8 }}>
                <Space size={4} wrap>
                  <Tag>{rule.module}</Tag>
                  <Tag color="default">{ruleLabel(rule.code)}</Tag>
                  {rule.nodeName && <Tag color="purple">{rule.nodeName}</Tag>}
                </Space>
                <Typography.Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ marginTop: 4, marginBottom: 0 }}
                >
                  {rule.message}
                </Typography.Paragraph>
              </div>
            ))}
          </div>
          <div>
            <Typography.Text strong>Portée</Typography.Text>
            <div style={{ marginTop: 4 }}>
              <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
                <Space direction="vertical" size={2}>
                  <Radio value="family">
                    Ce workflow, dans tous ses environnements{' '}
                    <Typography.Text type="secondary">({envLabels})</Typography.Text>
                  </Radio>
                  <Radio value="workflow">Cet environnement seulement</Radio>
                  <Radio value="global">Tous les workflows</Radio>
                </Space>
              </Radio.Group>
            </div>
          </div>
          {withNode && (
            <div>
              <Typography.Text strong>Nœud</Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Radio.Group value={nodeScope} onChange={(e) => setNodeScope(e.target.value)}>
                  <Radio value="node">Uniquement le nœud visé</Radio>
                  <Radio value="any-node">N&apos;importe quel nœud</Radio>
                </Radio.Group>
              </div>
            </div>
          )}
          <div>
            <Typography.Text strong>Raison (optionnel)</Typography.Text>
            <Input.TextArea
              rows={2}
              style={{ marginTop: 4 }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ex. placeholder remplacé plus tard dans le flux"
            />
          </div>
          <Typography.Text type="secondary">
            {rules.length === 1 ? 'Règle appliquée' : 'Règles appliquées'} : {SCOPE_WORDING[scope]},{' '}
            {withNode && nodeScope === 'node' ? 'nœud visé uniquement' : 'tous les nœuds'}.
          </Typography.Text>
        </Space>
      )}
    </Modal>
  );
}

const SCOPE_WORDING: Record<Scope, string> = {
  family: 'ce workflow dans tous ses environnements',
  workflow: 'cet environnement seulement',
  global: 'tous les workflows',
};

/** Un représentant par (module, code, nœud) : la règle créée serait identique. */
function dedupeRules(findings: IgnorableFinding[]): IgnorableFinding[] {
  const seen = new Map<string, IgnorableFinding>();
  for (const finding of findings) {
    const key = `${finding.module}|${finding.code}|${finding.nodeName ?? ''}`;
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()];
}
