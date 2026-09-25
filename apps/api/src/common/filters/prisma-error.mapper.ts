import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
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
    return new BadRequestException(
      'Requête invalide : champ de tri ou de filtre inconnu (vérifier _sort / _order).',
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = (error.meta as { target?: string[] } | undefined)?.target;
    switch (error.code) {
      case 'P2025':
        return new NotFoundException('Ressource introuvable');
      case 'P2002':
        return new ConflictException(
          `Doublon${target?.length ? ` sur ${target.join(', ')}` : ''} : cette valeur existe déjà`,
        );
      case 'P2003':
        return new BadRequestException('Référence inexistante (contrainte de clé étrangère)');
      default:
        return undefined;
    }
  }
  return undefined;
}
