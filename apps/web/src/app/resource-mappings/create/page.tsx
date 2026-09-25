'use client';

import React from 'react';
import { Create, useForm } from '@refinedev/antd';
import { MappingForm } from '../../../components/mapping-form';
import { formFooterButtons } from '../../../components/form-cancel-button';

export default function MappingCreate() {
  const { formProps, saveButtonProps } = useForm({ resource: 'resource-mappings', action: 'create' });
  return (
    <Create saveButtonProps={saveButtonProps} footerButtons={formFooterButtons}>
      <MappingForm formProps={formProps} />
    </Create>
  );
}
