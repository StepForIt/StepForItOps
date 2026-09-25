'use client';

import React from 'react';
import { Edit, useForm } from '@refinedev/antd';
import { MonitorForm } from '../../../../components/monitor-form';
import { formFooterButtons } from '../../../../components/form-cancel-button';

export default function MonitorEdit() {
  const { formProps, saveButtonProps } = useForm({ resource: 'monitors', action: 'edit' });
  return (
    <Edit saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <MonitorForm formProps={formProps} />
    </Edit>
  );
}
