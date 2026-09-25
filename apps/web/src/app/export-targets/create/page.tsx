'use client';

import React from 'react';
import { Create, useForm } from '@refinedev/antd';
import { ExportTargetForm } from '../../../components/export-target-form';
import { formFooterButtons } from '../../../components/form-cancel-button';

export default function ExportTargetCreate() {
  const { formProps, saveButtonProps } = useForm({ resource: 'export-targets', action: 'create' });
  return (
    <Create saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <ExportTargetForm formProps={formProps} />
    </Create>
  );
}
