/** Couleurs des statuts de problème et des entrées de leur journal (libellés : `health.errors.status` / `.event`). */

import type { ErrorGroupEventRow, ErrorGroupStatus } from './types';

export const STATUS_META: Record<ErrorGroupStatus, { color: string }> = {
  open: { color: 'red' },
  resolved: { color: 'green' },
  ignored: { color: 'default' },
};

export const EVENT_META: Record<ErrorGroupEventRow['type'], { color: string }> = {
  resolved: { color: 'green' },
  reopened: { color: 'orange' },
  regression: { color: 'red' },
  ignored: { color: 'gray' },
  note: { color: 'blue' },
};

export function formatDate(value: string | null, locale: string): string {
  return value ? new Date(value).toLocaleString(locale) : '—';
}
