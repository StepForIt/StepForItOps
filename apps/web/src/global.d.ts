import type { Messages } from './i18n/messages';

declare global {
  // Clés de traduction vérifiées par le typecheck : `t('x.y')` doit exister dans messages/fr.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntlMessages extends Messages {}
}
