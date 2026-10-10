-- CreateTable
CREATE TABLE "CredentialCheckSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "accessEveryHours" INTEGER NOT NULL DEFAULT 24,
    "paidAccessEveryHours" INTEGER NOT NULL DEFAULT 168,
    "creditEveryHours" INTEGER NOT NULL DEFAULT 168,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialCheckSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialCheckState" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "provider" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "lastAccessAt" TIMESTAMP(3),
    "lastCreditAt" TIMESTAMP(3),
    "alertedVerdict" TEXT,

    CONSTRAINT "CredentialCheckState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CredentialCheckState_instanceId_credentialId_key" ON "CredentialCheckState"("instanceId", "credentialId");

