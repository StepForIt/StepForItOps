import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { APP_LOG_LEVELS, AppLogLevel } from '@nwm/core';
import { LogBuffer } from './log-buffer';

function isAppLogLevel(level: string): level is AppLogLevel {
  return (APP_LOG_LEVELS as readonly string[]).includes(level);
}

/**
 * Le logger de la plateforme : celui de Nest, plus une copie dans le tampon.
 *
 * On se greffe sur `printMessages` / `printStackTrace` plutôt que sur les six
 * méthodes de niveau : c'est le point où Nest a DÉJÀ démêlé message, contexte et
 * pile (`logger.error(msg, stack)` et `logger.error(msg, context)` ont la même
 * signature, et rejouer cette heuristique ici, c'est la voir diverger au premier
 * changement de version). La sortie console reste intacte — le tampon double la
 * sortie du conteneur, il ne s'y substitue pas.
 */
export class BufferedLogger extends ConsoleLogger {
  constructor(private readonly buffer: LogBuffer) {
    super();
  }

  protected printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
  ): void {
    super.printMessages(messages, context, logLevel, writeStreamType);
    const level: AppLogLevel = isAppLogLevel(logLevel) ? logLevel : 'log';
    for (const message of messages) {
      this.buffer.push(level, context || 'Application', stringify(message));
    }
  }

  /**
   * Nest imprime la pile juste après le message de l'erreur : on la rattache à la
   * ligne qu'on vient de poser plutôt que d'en créer une seconde, sans message.
   */
  protected printStackTrace(stack: string): void {
    super.printStackTrace(stack);
    if (stack) this.buffer.attachStack(stack);
  }
}

/** Nest accepte n'importe quoi comme message ; le tampon, lui, ne garde que du texte. */
function stringify(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}
