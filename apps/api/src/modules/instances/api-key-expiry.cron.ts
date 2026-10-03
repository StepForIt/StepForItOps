import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiKeyHealthService } from './api-key-health.service';

/** Une passe par matin : les paliers se comptent en jours, et l'alerte arrive aux heures ouvrées. */
@Injectable()
export class ApiKeyExpiryCron {
  constructor(private readonly health: ApiKeyHealthService) {}

  @Cron('0 8 * * *')
  run(): Promise<void> {
    return this.health.checkExpiries();
  }
}
