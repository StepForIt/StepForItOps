-- AlterTable
ALTER TABLE "Instance" ADD COLUMN     "apiKeyAlertedTier" TEXT,
ADD COLUMN     "apiKeyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "apiKeyRejectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN     "onApiKey" BOOLEAN NOT NULL DEFAULT true;
