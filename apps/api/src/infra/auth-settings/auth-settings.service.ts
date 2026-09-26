import { ConflictException, Injectable } from '@nestjs/common';
import { msg } from '@nwm/core';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const ROW_ID = 'default';
const KEY_LENGTH = 64;
/** Tentatives de connexion par fenêtre d'une minute : au-delà, refus sec (anti brute force). */
const MAX_ATTEMPTS_PER_MINUTE = 10;

export interface AuthBootstrapView {
  configured: boolean;
  username: string | null;
  /** Secret de signature des cookies — pour le serveur Next uniquement, jamais l'UI. */
  sessionSecret: string | null;
}

/**
 * Compte du premier lancement (page /setup). La plateforme reste sans table
 * utilisateur : un seul compte, haché scrypt, qui complète (sans remplacer)
 * les méthodes d'environnement — APP_PASSWORD et Google restent prioritaires
 * côté front, ce compte existe pour que l'installation ne soit jamais ouverte.
 */
@Injectable()
export class AuthSettingsService {
  private attempts: { windowStart: number; count: number } = { windowStart: 0, count: 0 };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * État du bootstrap — génère au passage le secret de session s'il n'existe
   * pas encore (la ligne peut vivre sans compte) : ainsi les sessions signées
   * par les méthodes d'environnement reposent sur un vrai secret aléatoire au
   * lieu d'un mot de passe court. Un secret existant n'est JAMAIS écrasé.
   */
  async bootstrapView(): Promise<AuthBootstrapView> {
    let row = await this.prisma.authSettings.findUnique({ where: { id: ROW_ID } });
    if (!row) {
      row = await this.prisma.authSettings
        .create({ data: { id: ROW_ID, sessionSecret: randomBytes(32).toString('hex') } })
        .catch(() => this.prisma.authSettings.findUniqueOrThrow({ where: { id: ROW_ID } }));
    }
    return {
      configured: row.passwordHash !== null,
      username: row.username,
      sessionSecret: row.sessionSecret,
    };
  }

  /** Crée LE compte — refuse si déjà configuré : changer de mot de passe passera par une autre voie. */
  async bootstrap(username: string, password: string): Promise<AuthBootstrapView> {
    const existing = await this.prisma.authSettings.findUnique({ where: { id: ROW_ID } });
    if (existing?.passwordHash) throw new ConflictException(msg('platform.alreadyConfigured'));

    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
    const data = {
      username: username.trim(),
      passwordHash: `${salt}:${hash}`,
      // Le secret existant survit : l'écraser invaliderait les sessions en cours.
      sessionSecret: existing?.sessionSecret ?? randomBytes(32).toString('hex'),
    };
    await this.prisma.authSettings.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, ...data },
      update: { username: data.username, passwordHash: data.passwordHash },
    });
    return this.bootstrapView();
  }

  async verify(username: string, password: string): Promise<boolean> {
    if (!this.allowAttempt()) return false;
    const row = await this.prisma.authSettings.findUnique({ where: { id: ROW_ID } });
    if (!row?.passwordHash || !row.username) return false;
    const [salt, expectedHex] = row.passwordHash.split(':');
    if (!salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    // Les deux comparaisons sont évaluées : pas de court-circuit observable au timing.
    const userOk = timingSafeEqual(
      Buffer.from(username.trim().padEnd(64).slice(0, 64)),
      Buffer.from(row.username.padEnd(64).slice(0, 64)),
    );
    const passwordOk = timingSafeEqual(actual, expected);
    return userOk && passwordOk;
  }

  private allowAttempt(): boolean {
    const now = Date.now();
    if (now - this.attempts.windowStart > 60_000) {
      this.attempts = { windowStart: now, count: 0 };
    }
    this.attempts.count++;
    return this.attempts.count <= MAX_ATTEMPTS_PER_MINUTE;
  }
}
