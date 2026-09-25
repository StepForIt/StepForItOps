-- CreateTable
CREATE TABLE "N8nInstance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "N8nInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowGroup" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "n8nId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hash" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExportRef" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "remoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowExportRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "message" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'sync',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMP(3),
    "exportedTo" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportTarget" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "nodeName" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingIgnore" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT,
    "module" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nodeName" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingIgnore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceMapping" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "logicalName" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceLabel" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceLabel_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProviderEndpoint" (
    "provider" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderEndpoint_pkey" PRIMARY KEY ("provider","credentialId")
);

-- CreateTable
CREATE TABLE "DepNodeAlias" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepNodeAlias_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WorkflowLink" (
    "id" TEXT NOT NULL,
    "fromWorkflowId" TEXT NOT NULL,
    "toWorkflowId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "kumaPushUrl" TEXT,
    "config" JSONB,
    "state" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionError" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "n8nWorkflowId" TEXT NOT NULL,
    "workflowId" TEXT,
    "workflowName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "mode" TEXT,
    "detailState" TEXT NOT NULL DEFAULT 'pending',
    "failedNode" TEXT,
    "failedNodeType" TEXT,
    "message" TEXT,
    "stack" TEXT,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "n8nWorkflowId" TEXT NOT NULL,
    "workflowId" TEXT,
    "workflowName" TEXT NOT NULL,
    "failedNode" TEXT,
    "failedNodeType" TEXT,
    "pattern" TEXT NOT NULL,
    "sample" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "regressions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorGroupEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "author" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorGroupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringSettings" (
    "id" TEXT NOT NULL,
    "kumaUrl" TEXT,
    "kumaUsername" TEXT,
    "kumaPassword" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "includeArchived" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "apiKey" TEXT,
    "model" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "findingsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDoc" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "mermaid" TEXT NOT NULL,
    "summary" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleState" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowChatSession" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowChatProposal" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sessionId" TEXT,
    "baseHash" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "operations" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowChatProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_WorkflowToWorkflowGroup" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowGroup_instanceId_name_key" ON "WorkflowGroup"("instanceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_instanceId_n8nId_key" ON "Workflow"("instanceId", "n8nId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowExportRef_workflowId_targetId_key" ON "WorkflowExportRef"("workflowId", "targetId");

-- CreateIndex
CREATE INDEX "FindingIgnore_module_code_idx" ON "FindingIgnore"("module", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowLink_fromWorkflowId_toWorkflowId_key" ON "WorkflowLink"("fromWorkflowId", "toWorkflowId");

-- CreateIndex
CREATE UNIQUE INDEX "Monitor_token_key" ON "Monitor"("token");

-- CreateIndex
CREATE INDEX "ExecutionError_instanceId_startedAt_idx" ON "ExecutionError"("instanceId", "startedAt");

-- CreateIndex
CREATE INDEX "ExecutionError_workflowId_startedAt_idx" ON "ExecutionError"("workflowId", "startedAt");

-- CreateIndex
CREATE INDEX "ExecutionError_groupId_startedAt_idx" ON "ExecutionError"("groupId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionError_instanceId_executionId_key" ON "ExecutionError"("instanceId", "executionId");

-- CreateIndex
CREATE INDEX "ErrorGroup_instanceId_status_lastSeenAt_idx" ON "ErrorGroup"("instanceId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ErrorGroup_workflowId_idx" ON "ErrorGroup"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_instanceId_signature_key" ON "ErrorGroup"("instanceId", "signature");

-- CreateIndex
CREATE INDEX "ErrorGroupEvent_groupId_createdAt_idx" ON "ErrorGroupEvent"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_workflowId_module_idx" ON "AnalysisRun"("workflowId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDoc_workflowId_key" ON "WorkflowDoc"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowChatSession_workflowId_updatedAt_idx" ON "WorkflowChatSession"("workflowId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkflowChatMessage_sessionId_createdAt_idx" ON "WorkflowChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowChatProposal_workflowId_createdAt_idx" ON "WorkflowChatProposal"("workflowId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "_WorkflowToWorkflowGroup_AB_unique" ON "_WorkflowToWorkflowGroup"("A", "B");

-- CreateIndex
CREATE INDEX "_WorkflowToWorkflowGroup_B_index" ON "_WorkflowToWorkflowGroup"("B");

-- AddForeignKey
ALTER TABLE "WorkflowGroup" ADD CONSTRAINT "WorkflowGroup_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExportRef" ADD CONSTRAINT "WorkflowExportRef_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExportRef" ADD CONSTRAINT "WorkflowExportRef_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ExportTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingIgnore" ADD CONSTRAINT "FindingIgnore_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLink" ADD CONSTRAINT "WorkflowLink_fromWorkflowId_fkey" FOREIGN KEY ("fromWorkflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLink" ADD CONSTRAINT "WorkflowLink_toWorkflowId_fkey" FOREIGN KEY ("toWorkflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionError" ADD CONSTRAINT "ExecutionError_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionError" ADD CONSTRAINT "ExecutionError_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionError" ADD CONSTRAINT "ExecutionError_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ErrorGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorGroupEvent" ADD CONSTRAINT "ErrorGroupEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ErrorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDoc" ADD CONSTRAINT "WorkflowDoc_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowChatSession" ADD CONSTRAINT "WorkflowChatSession_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowChatMessage" ADD CONSTRAINT "WorkflowChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkflowChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowChatProposal" ADD CONSTRAINT "WorkflowChatProposal_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowChatProposal" ADD CONSTRAINT "WorkflowChatProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkflowChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkflowToWorkflowGroup" ADD CONSTRAINT "_WorkflowToWorkflowGroup_A_fkey" FOREIGN KEY ("A") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkflowToWorkflowGroup" ADD CONSTRAINT "_WorkflowToWorkflowGroup_B_fkey" FOREIGN KEY ("B") REFERENCES "WorkflowGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

