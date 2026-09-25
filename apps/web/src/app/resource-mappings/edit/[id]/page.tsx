'use client';

import React from 'react';
import { Edit, useForm } from '@refinedev/antd';
import { MappingForm } from '../../../../components/mapping-form';
import { formFooterButtons } from '../../../../components/form-cancel-button';

export default function MappingEdit() {
  const { formProps, saveButtonProps } = useForm({ resource: 'resource-mappings', action: 'edit' });
  return (
    <Edit saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <MappingForm formProps={formProps} />
    </Edit>
  );
}
