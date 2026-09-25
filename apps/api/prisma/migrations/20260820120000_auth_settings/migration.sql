-- Premier login (page /setup) : compte unique haché scrypt + secret de session
-- généré au bootstrap, servi au serveur Next quand aucun secret d'env n'existe.
CREATE TABLE "AuthSettings" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "sessionSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSettings_pkey" PRIMARY KEY ("id")
);
