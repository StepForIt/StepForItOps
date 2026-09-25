import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { WORKFLOW_CHAT_MANIFEST } from './manifest';
import { WorkflowChatController } from './workflow-chat.controller';
import { ChatService } from './chat.service';
import { ProposalService } from './proposal.service';
import { ErrorFixService } from './error-fix.service';
import { FindingFixService } from './finding-fix.service';
import { FindingAutoFixService } from './finding-autofix.service';
import { ChatExportService } from './chat-export.service';
import { InstanceCorpusService } from './instance-corpus.service';
import { InstanceCredentialsService } from './instance-credentials.service';
import { InstanceShapesService } from './instance-shapes.service';
import { ExampleCorpusService } from './example-corpus.service';
import { RestorePointService } from './restore-point.service';
import { ChatMemoryService } from './chat-memory.service';
import { ChatHistoryService } from './chat-history.service';
import { ChatProgressService } from './chat-progress.service';
import { ChatCancelService } from './chat-cancel.service';
import { ChatSuggestionsService } from './chat-suggestions.service';
import { DraftRepairService } from './draft-repair.service';
import { LessonRecallService } from './lesson-recall.service';
import { ChatScopeService } from './chat-scope.service';
import { ChatLeftoversService } from './chat-leftovers.service';
import { MakeProposalService } from './make-proposal.service';
import { MakeChatTurnService } from './make-chat-turn.service';

@Module({
  imports: [WorkflowsModule, InstancesModule],
  controllers: [WorkflowChatController],
  providers: [
    ChatService,
    ProposalService,
    ErrorFixService,
    FindingFixService,
    FindingAutoFixService,
    ChatExportService,
    InstanceCorpusService,
    InstanceCredentialsService,
    InstanceShapesService,
    ExampleCorpusService,
    RestorePointService,
    ChatMemoryService,
    ChatHistoryService,
    ChatProgressService,
    ChatCancelService,
    ChatSuggestionsService,
    DraftRepairService,
    LessonRecallService,
    ChatScopeService,
    ChatLeftoversService,
    MakeProposalService,
    MakeChatTurnService,
    manifestProvider(WORKFLOW_CHAT_MANIFEST),
  ],
})
export class WorkflowChatModule {}
