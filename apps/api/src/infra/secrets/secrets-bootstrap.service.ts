import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SECRET_CIPHER, SecretCipher } from './secret-cipher';
import { prepareInstanceSecrets } from './secrets-bootstrap';

/** Chiffre ce qui est encore en clair, et refuse une clé absente ou fausse, avant de servir. */
@Injectable()
export class SecretsBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Secrets');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await prepareInstanceSecrets(this.prisma, this.cipher, this.logger);
  }
}
