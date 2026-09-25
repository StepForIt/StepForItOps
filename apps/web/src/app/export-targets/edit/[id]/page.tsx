'use client';

import React from 'react';
import { Edit, useForm } from '@refinedev/antd';
import { ExportTargetForm } from '../../../../components/export-target-form';
import { formFooterButtons } from '../../../../components/form-cancel-button';

export default function ExportTargetEdit() {
  const { formProps, saveButtonProps } = useForm({ resource: 'export-targets', action: 'edit' });
  return (
    <Edit saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <ExportTargetForm formProps={formProps} />
    </Edit>
  );
}
