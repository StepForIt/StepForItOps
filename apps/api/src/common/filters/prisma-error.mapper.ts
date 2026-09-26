import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { msg } from '@nwm/core';
import { Prisma } from '@prisma/client';

/**
 * Traduit une erreur Prisma en exception HTTP parlante : une requête mal formée
 * (tri ou filtre inconnu dans la query string) est une faute du client, pas un
 * plantage serveur — elle doit rendre 400 et non 500.
 *
 * Renvoie `undefined` pour tout ce qui n'est pas mappable : au filtre global de
 * conclure (500 + journalisation).
 */
export function httpExceptionFromPrisma(error: unknown): HttpException | undefined {
  if (error instanceof Prisma.PrismaClientValidationError) {
    // Le message Prisma embarque toute la requête : on garde un texte court côté
    // client, le détail complet part dans les logs (cf. AllExceptionsFilter).
    return new BadRequestException(msg('common.invalidQuery'));
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = (error.meta as { target?: string[] } | undefined)?.target;
    switch (error.code) {
      case 'P2025':
        return new NotFoundException(msg('common.notFound'));
      case 'P2002':
        return new ConflictException(
          msg('common.duplicate', { hasTarget: Boolean(target?.length), target: target?.join(', ') }),
        );
      case 'P2003':
        return new BadRequestException(msg('common.missingReference'));
      default:
        return undefined;
    }
  }
  return undefined;
}
