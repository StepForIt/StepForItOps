'use client';

import React from 'react';
import { Edit, useForm } from '@refinedev/antd';
import { InstanceForm } from '../../../../components/instance-form';
import { formFooterButtons } from '../../../../components/form-cancel-button';

export default function InstanceEdit() {
  const { formProps, saveButtonProps, id } = useForm({ resource: 'instances', action: 'edit' });
  return (
    <Edit saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <InstanceForm formProps={formProps} instanceId={id ? String(id) : undefined} />
    </Edit>
  );
}
