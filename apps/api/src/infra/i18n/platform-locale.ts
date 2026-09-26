import { Injectable } from '@nestjs/common';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { runWithLocale } from './locale-context';

/**
 * Ce qui est ÉCRIT pour être relu par d'autres (findings persistés) sort dans la langue
 * de la plateforme, même quand un humain a lancé le calcul depuis sa console.
 */
@Injectable()
export class PlatformLocale {
  constructor(private readonly settings: PlatformSettingsService) {}

  run<T>(fn: () => T): T {
    return runWithLocale(this.settings.defaultLocale(), fn);
  }
}
