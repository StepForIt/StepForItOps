'use client';

import React from 'react';
import { Alert, Form, Input, Modal, Select, Typography } from 'antd';
import { apiPost } from '../../lib/api';
import { useInstanceScope } from '../../lib/instance-scope';

interface CreatedWorkflow {
  id: string;
  name: string;
}

/**
 * Création d'un workflow neuf : instance et nom, rien de plus. Le contenu se
 * décide dans l'assistant, qui s'ouvre juste après — c'est lui qui demande ce
 * que le workflow doit faire, plutôt qu'un formulaire de plus ici.
 */
export function CreateWorkflowModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (workflow: CreatedWorkflow) => void;
}) {
  const { scope, instances } = useInstanceScope();
  const [name, setName] = React.useState('');
  const [instanceId, setInstanceId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Le scope global fixe l'instance ; sinon, celle-ci s'impose d'elle-même quand il n'y en a qu'une.
  const target = scope ?? instanceId ?? (instances.length === 1 ? instances[0].id : null);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setInstanceId(null);
    setError(null);
  }, [open]);

  const create = async () => {
    if (!target || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const workflow = await apiPost<CreatedWorkflow>('/workflows', {
        instanceId: target,
        name: name.trim(),
      });
      onCreated(workflow);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={create}
      okText="Créer et décrire"
      cancelText="Annuler"
      okButtonProps={{ disabled: !target || !name.trim(), loading: creating }}
      title="Nouveau workflow"
    >
      <Typography.Paragraph type="secondary">
        Créé vide et inactif. L&apos;assistant prend le relais.
      </Typography.Paragraph>
      <Form layout="vertical">
        {!scope && (
          // Champs pilotés par l'état React (pas liés à antd) : `required` sert le
          // marqueur visuel, le bouton « Créer » reste désactivé tant que c'est vide.
          <Form.Item label="Instance" required>
            <Select
              placeholder="Instance n8n"
              value={target}
              onChange={setInstanceId}
              options={instances.map((instance) => ({ value: instance.id, label: instance.name }))}
            />
          </Form.Item>
        )}
        <Form.Item label="Nom" required>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onPressEnter={create}
            placeholder="Ex. Relance devis sans réponse - DEV"
          />
        </Form.Item>
      </Form>
      {error && <Alert type="error" showIcon message="Création refusée" description={error} />}
    </Modal>
  );
}
