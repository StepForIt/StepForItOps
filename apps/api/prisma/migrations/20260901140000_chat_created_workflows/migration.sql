-- D'où vient un workflow que l'assistant a créé lui-même (create_sub_workflow).
-- Provenance seulement : « à supprimer » se recalcule sur le workflow réel
-- (encore vide, appelé par personne), jamais sur un drapeau posé au refus.
CREATE TABLE "WorkflowChatCreation" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sessionId" TEXT,
    "parentWorkflowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowChatCreation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowChatCreation_workflowId_key" ON "WorkflowChatCreation"("workflowId");
CREATE INDEX "WorkflowChatCreation_parentWorkflowId_idx" ON "WorkflowChatCreation"("parentWorkflowId");

ALTER TABLE "WorkflowChatCreation"
    ADD CONSTRAINT "WorkflowChatCreation_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowChatCreation"
    ADD CONSTRAINT "WorkflowChatCreation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "WorkflowChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowChatCreation"
    ADD CONSTRAINT "WorkflowChatCreation_parentWorkflowId_fkey"
    FOREIGN KEY ("parentWorkflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
