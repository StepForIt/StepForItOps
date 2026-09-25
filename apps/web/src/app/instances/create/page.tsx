'use client';

import React from 'react';
import { Create, useForm } from '@refinedev/antd';
import { InstanceForm } from '../../../components/instance-form';
import { formFooterButtons } from '../../../components/form-cancel-button';

export default function InstanceCreate() {
  const { formProps, saveButtonProps } = useForm({ resource: 'instances', action: 'create' });
  return (
    <Create saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <InstanceForm formProps={formProps} />
    </Create>
  );
}
