-- CreateTable
CREATE TABLE "PromotionPublishRun" (
    "id" TEXT NOT NULL,
    "sourceWorkflowId" TEXT NOT NULL,
    "targetWorkflowId" TEXT,
    "status" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionPublishRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionPublishRun_sourceWorkflowId_status_idx" ON "PromotionPublishRun"("sourceWorkflowId", "status");

-- CreateIndex
CREATE INDEX "PromotionPublishRun_targetWorkflowId_status_idx" ON "PromotionPublishRun"("targetWorkflowId", "status");
