import { Controller, Get, Inject } from '@nestjs/common';
import { SECRET_CIPHER, SecretCipher } from './secret-cipher';

/** Lu par le serveur de la console pour sa bannière de sécurité : un drapeau, jamais la clé. */
@Controller('security')
export class SecurityStatusController {
  constructor(@Inject(SECRET_CIPHER) private readonly cipher: SecretCipher | null) {}

  @Get('status')
  status(): { secretsEncrypted: boolean } {
    return { secretsEncrypted: this.cipher !== null };
  }
}
