-- CreateTable
CREATE TABLE "ReleaseProcedure" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recording',
    "recordedBy" TEXT,
    "sourceEnv" TEXT,
    "targetEnv" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseProcedureStep" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT,
    "familyKey" TEXT,
    "familyName" TEXT,
    "sourceEnv" TEXT,
    "targetEnv" TEXT,
    "options" JSONB,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseProcedureStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReleaseProcedure_status_recordedBy_idx" ON "ReleaseProcedure"("status", "recordedBy");

-- CreateIndex
CREATE INDEX "ReleaseProcedureStep_procedureId_position_idx" ON "ReleaseProcedureStep"("procedureId", "position");

-- AddForeignKey
ALTER TABLE "ReleaseProcedureStep" ADD CONSTRAINT "ReleaseProcedureStep_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "ReleaseProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

