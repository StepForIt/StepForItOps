-- CreateTable
CREATE TABLE "AssistantLesson" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "nodeTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "recalls" INTEGER NOT NULL DEFAULT 0,
    "lastRecallAt" TIMESTAMP(3),
    "origin" TEXT NOT NULL,
    "originWorkflowId" TEXT,
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantCorrection" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "versionId" TEXT,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "question" TEXT,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantLesson_status_idx" ON "AssistantLesson"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantLesson_content_key" ON "AssistantLesson"("content");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCorrection_proposalId_key" ON "AssistantCorrection"("proposalId");

-- CreateIndex
CREATE INDEX "AssistantCorrection_workflowId_status_idx" ON "AssistantCorrection"("workflowId", "status");

-- AddForeignKey
ALTER TABLE "AssistantCorrection" ADD CONSTRAINT "AssistantCorrection_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

