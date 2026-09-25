/** Libellés et couleurs des statuts de problème et des entrées de leur journal. */

import type { ErrorGroupEventRow, ErrorGroupStatus } from './types';

export const STATUS_META: Record<ErrorGroupStatus, { label: string; color: string }> = {
  open: { label: 'À traiter', color: 'red' },
  resolved: { label: 'Traité', color: 'green' },
  ignored: { label: 'Ignoré', color: 'default' },
};

export const EVENT_META: Record<ErrorGroupEventRow['type'], { label: string; color: string }> = {
  resolved: { label: 'Marqué traité', color: 'green' },
  reopened: { label: 'Rouvert', color: 'orange' },
  regression: { label: 'Rechute', color: 'red' },
  ignored: { label: 'Ignoré', color: 'gray' },
  note: { label: 'Note', color: 'blue' },
};

export function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('fr-FR') : '—';
}
