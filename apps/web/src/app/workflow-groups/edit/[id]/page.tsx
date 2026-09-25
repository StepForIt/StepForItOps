'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { Edit, useForm } from '@refinedev/antd';
import { Button, Divider, Space, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { WorkflowGroupForm } from '../../../../components/workflow-group-form';
import { GroupCredentials } from '../../../../components/group-credentials';
import { GroupDuplicateModal } from '../../../../components/group-duplicate-modal';
import { formFooterButtons } from '../../../../components/form-cancel-button';

export default function WorkflowGroupEdit() {
  const params = useParams<{ id: string }>();
  const { formProps, saveButtonProps, queryResult } = useForm({
    resource: 'workflow-groups',
    action: 'edit',
  });
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const groupName = (queryResult?.data?.data as { name?: string } | undefined)?.name ?? 'ce groupe';

  return (
    <Edit saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <WorkflowGroupForm formProps={formProps} />
      <Divider />
      <Typography.Title level={5}>Actions sur tout le groupe</Typography.Title>
      <Space wrap>
        <Button icon={<CopyOutlined />} onClick={() => setDuplicateOpen(true)}>
          Dupliquer vers un env…
        </Button>
      </Space>
      {params?.id && (
        <GroupDuplicateModal
          groupId={params.id}
          groupName={groupName}
          open={duplicateOpen}
          onClose={() => setDuplicateOpen(false)}
        />
      )}
      <Divider />
      <Typography.Title level={5}>Credentials utilisés par le groupe</Typography.Title>
      <Typography.Paragraph type="secondary">
        Récoltés dans les snapshots des workflows membres. Pour découvrir et créer les mappings du groupe,
        utilise « Découvrir depuis un workflow » sur la page Mappings env (mode Groupe).
      </Typography.Paragraph>
      {params?.id && <GroupCredentials groupId={params.id} />}
    </Edit>
  );
}
