import { Controller, Delete, Get, Inject, Query } from '@nestjs/common';
import { AppLogEntry, AppLogLevel, APP_LOG_LEVELS, formatAppLogText } from '@nwm/core';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';
import { LOG_BUFFER } from '../../infra/logging/log-buffer.token';
import { LogBuffer } from '../../infra/logging/log-buffer';

/** Ce que l'écran affiche d'un coup ; le tampon en garde davantage. */
const DEFAULT_LIMIT = 500;
/** Borne dure : une page qui demanderait tout ferait un JSON de plusieurs Mo à chaque rafraîchissement. */
const MAX_LIMIT = 2_000;

interface AppLogsPage {
  entries: AppLogEntry[];
  /** Contextes présents dans le tampon (le filtre de l'écran s'y cale). */
  contexts: string[];
  /** État du tampon : ce qu'il tient, ce qu'il a déjà perdu. */
  held: number;
  capacity: number;
  dropped: number;
  /** Dernier rang connu, à renvoyer en `sinceSeq` au rafraîchissement suivant. */
  lastSeq: number;
}

function parseLevels(raw?: string): AppLogLevel[] | undefined {
  if (!raw) return undefined;
  const asked = raw.split(',').map((level) => level.trim());
  const known = asked.filter((level): level is AppLogLevel =>
    (APP_LOG_LEVELS as readonly string[]).includes(level),
  );
  return known.length ? known : undefined;
}

function parseLimit(raw?: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

@ModuleId('app-logs')
@Controller('app-logs')
export class AppLogsController {
  constructor(@Inject(LOG_BUFFER) private readonly buffer: LogBuffer) {}

  /**
   * La queue du journal. `sinceSeq` sert le rafraîchissement : l'écran ne
   * redemande que ce qui est arrivé depuis, plutôt que 500 lignes toutes les
   * deux secondes dont 499 qu'il affiche déjà.
   */
  @Get()
  list(
    @Query('levels') levels?: string,
    @Query('context') context?: string,
    @Query('search') search?: string,
    @Query('sinceSeq') sinceSeq?: string,
    @Query('limit') limit?: string,
  ): AppLogsPage {
    const since = Number(sinceSeq);
    const entries = this.buffer.query({
      levels: parseLevels(levels),
      context: context || undefined,
      search: search || undefined,
      sinceSeq: Number.isFinite(since) && since >= 0 ? since : undefined,
      limit: parseLimit(limit),
    });
    const stats = this.buffer.stats();
    return { entries, contexts: this.buffer.contexts(), ...stats };
  }

  /**
   * Le même extrait en texte, tel qu'on le colle dans un ticket. Rendu en JSON
   * plutôt qu'en `text/plain` : l'appel passe par le même chemin authentifié que
   * le reste de la console, et c'est le navigateur qui en fait un fichier.
   */
  @Get('export')
  export(
    @Query('levels') levels?: string,
    @Query('context') context?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): { text: string; lines: number } {
    const entries = this.buffer.query({
      levels: parseLevels(levels),
      context: context || undefined,
      search: search || undefined,
      limit: parseLimit(limit),
    });
    return { text: formatAppLogText(entries), lines: entries.length };
  }

  /** Vide le tampon — pour repartir d'un journal propre avant de reproduire un bug. */
  @Delete()
  clear(): { cleared: true } {
    this.buffer.clear();
    return { cleared: true };
  }
}
