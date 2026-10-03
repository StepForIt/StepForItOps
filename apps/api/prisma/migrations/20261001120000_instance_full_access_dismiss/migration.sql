-- AlterTable
ALTER TABLE "Instance" ADD COLUMN     "fullAccessDismissedAt" TIMESTAMP(3),
ADD COLUMN     "fullAccessDismissedBy" TEXT;
