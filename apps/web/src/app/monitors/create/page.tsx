'use client';

import React from 'react';
import { Create, useForm } from '@refinedev/antd';
import { MonitorForm } from '../../../components/monitor-form';
import { formFooterButtons } from '../../../components/form-cancel-button';

export default function MonitorCreate() {
  const { formProps, saveButtonProps } = useForm({ resource: 'monitors', action: 'create' });
  return (
    <Create saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <MonitorForm formProps={formProps} />
    </Create>
  );
}
