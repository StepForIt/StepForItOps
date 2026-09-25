-- Une proposition de l'assistant peut désormais toucher plusieurs workflows :
-- celui de la conversation, et les sous-workflows qu'il appelle. La racine reste
-- portée par WorkflowChatProposal ; les annexes vivent ici, chacune avec sa
-- propre empreinte de départ et son propre sort à l'écriture.
CREATE TABLE "WorkflowChatProposalPart" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "baseHash" TEXT NOT NULL,
    "operations" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowChatProposalPart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowChatProposalPart_proposalId_workflowId_key"
    ON "WorkflowChatProposalPart"("proposalId", "workflowId");

ALTER TABLE "WorkflowChatProposalPart"
    ADD CONSTRAINT "WorkflowChatProposalPart_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "WorkflowChatProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowChatProposalPart"
    ADD CONSTRAINT "WorkflowChatProposalPart_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
