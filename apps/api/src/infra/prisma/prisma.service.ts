import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { secretCipherFromEnv } from '../secrets/secret-cipher';
import { withSecretEncryption } from '../secrets/secret-encryption';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // Le client injecté partout est celui qui chiffre : aucun service n'a à y penser.
    return withSecretEncryption(this, secretCipherFromEnv(process.env));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
