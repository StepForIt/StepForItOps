'use client';

import React from 'react';
import { BRAND } from '../lib/brand/colors';

/**
 * Libellé de champ pour les formulaires NATIFS (login, setup) qui n'utilisent pas
 * antd `Form.Item` et n'ont donc ni label ni astérisque. Reproduit le marqueur
 * requis d'antd (astérisque rouge) pour que l'obligation se voie AVANT l'envoi.
 */
export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>
      {required && (
        <span aria-hidden="true" style={{ color: BRAND.danger, marginRight: 4 }}>
          *
        </span>
      )}
      {children}
    </label>
  );
}
