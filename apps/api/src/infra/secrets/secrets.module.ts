import { Module } from '@nestjs/common';
import { SECRET_CIPHER, secretCipherFromEnv } from './secret-cipher';
import { SecretsBootstrapService } from './secrets-bootstrap.service';
import { SecurityStatusController } from './security-status.controller';

/** Secrets au repos : vérification de la clé au démarrage, et état servi à la console. */
@Module({
  controllers: [SecurityStatusController],
  providers: [
    { provide: SECRET_CIPHER, useFactory: () => secretCipherFromEnv(process.env) },
    SecretsBootstrapService,
  ],
})
export class SecretsModule {}
