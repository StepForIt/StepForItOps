'use client';

import React from 'react';
import { Create, useForm } from '@refinedev/antd';
import { WorkflowGroupForm } from '../../../components/workflow-group-form';
import { formFooterButtons } from '../../../components/form-cancel-button';

export default function WorkflowGroupCreate() {
  const { formProps, saveButtonProps } = useForm({ resource: 'workflow-groups', action: 'create' });
  return (
    <Create saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <WorkflowGroupForm formProps={formProps} />
    </Create>
  );
}
