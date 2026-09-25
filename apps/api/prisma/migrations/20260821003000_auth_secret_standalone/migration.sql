-- Le secret de session vit sans compte : la ligne AuthSettings peut n'exister que
-- pour lui (généré au premier passage), le compte /setup arrivant plus tard ou jamais.
ALTER TABLE "AuthSettings" ALTER COLUMN "username" DROP NOT NULL;
ALTER TABLE "AuthSettings" ALTER COLUMN "passwordHash" DROP NOT NULL;
