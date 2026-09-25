-- Mémoire de l'assistant, portée par le workflow : ce qu'on lui dit une fois ne
-- se redit pas à chaque conversation. `sessionId` en SET NULL — la conversation
-- d'origine peut disparaître, le fait qu'elle a établi doit lui survivre.
CREATE TABLE "WorkflowChatMemory" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowChatMemory_pkey" PRIMARY KEY ("id")
);

-- Le même fait ne se stocke qu'une fois : l'assistant le réécrit volontiers d'un
-- tour à l'autre, et la mémoire se serait remplie de doublons.
CREATE UNIQUE INDEX "WorkflowChatMemory_workflowId_content_key" ON "WorkflowChatMemory"("workflowId", "content");

CREATE INDEX "WorkflowChatMemory_workflowId_createdAt_idx" ON "WorkflowChatMemory"("workflowId", "createdAt");

ALTER TABLE "WorkflowChatMemory" ADD CONSTRAINT "WorkflowChatMemory_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowChatMemory" ADD CONSTRAINT "WorkflowChatMemory_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "WorkflowChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
