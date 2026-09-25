-- CreateTable
CREATE TABLE "CheckProfile" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT NOT NULL DEFAULT '',
    "familyKey" TEXT,
    "disabled" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckProfile_scope_targetId_key" ON "CheckProfile"("scope", "targetId");

-- CreateIndex
CREATE INDEX "CheckProfile_familyKey_idx" ON "CheckProfile"("familyKey");
