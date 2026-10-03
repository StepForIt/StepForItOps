import { BadRequestException } from '@nestjs/common';
import { msg } from '@nwm/core';
import { ExportKey, ExportKeyError, MIN_EXPORT_KEY_LENGTH } from '../../infra/secrets/export-key';

/**
 * Une clé d'export absente, trop courte ou fausse est une saisie à reprendre,
 * pas une panne : un 400 qui dit laquelle. « Absente » ne dit pas la même chose
 * des deux côtés — à l'export il faut en choisir une, à l'import retrouver celle
 * qu'on avait choisie.
 */
export function exportKeyHttpError(error: unknown, phase: 'export' | 'import'): unknown {
  if (!(error instanceof ExportKeyError)) return error;
  switch (error.reason) {
    case 'missing':
      return new BadRequestException(
        msg(phase === 'export' ? 'platform.exportKeyRequired' : 'platform.exportKeyFileSealed'),
      );
    case 'too-short':
      return new BadRequestException(msg('platform.exportKeyTooShort', { min: MIN_EXPORT_KEY_LENGTH }));
    case 'wrong':
      return new BadRequestException(msg('platform.exportKeyWrong'));
  }
}

/** À l'export : refuse une phrase inutilisable AVANT d'avoir lu ou envoyé quoi que ce soit. */
export function requireExportKey(passphrase: string | undefined): asserts passphrase is string {
  try {
    ExportKey.assertUsable(passphrase);
  } catch (error) {
    throw exportKeyHttpError(error, 'export');
  }
}
