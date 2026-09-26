import { defineMessages } from '../catalog';

/** Assistant IA : fil de conversation, propositions, pièces jointes, avancement du tour. */
export const chat = defineMessages(
  {
    progressReadNode: 'Reading a node',
    progressReadWorkflow: 'Reading a called sub-workflow',
    progressCreateSubWorkflow: 'Creating the sub-workflow',
    progressCheckDraft: 'Checking the draft',
    progressListCredentials: 'Reading available credentials',
    progressDescribeNodeType: 'Reading a node type schema',
    progressReadNodeDocs: 'Reading a node user guide',
    progressSearchNodeTypes: 'Searching for a node type',
    progressSyncWorkflow: 'Reloading the workflow from n8n',
    progressRemember: 'Remembering a fact',
    progressListConversations: 'Reading past conversations',
    progressReadConversation: 'Reading a conversation',
    progressFindExamples: 'Searching for examples in other workflows',
    progressReadExampleWorkflow: 'Reading a workflow from the fleet',
    progressSearchDocs: 'Searching the service documentation',
    progressReadDocs: 'Reading the service documentation',
    progressReadModule: 'Reading a module',
    progressUnknownTool: 'Tool {name}',
    exportYou: 'You',
    exportScreenshots:
      '_{count, plural, one {# screenshot attached (not exported)} other {# screenshots attached (not exported)}}._',
    exportFiles:
      '_{count, plural, one {Attached file} other {Attached files}} (content not exported): {names}._',
    exportProposalStatus:
      '{status, select, pending {pending} applied {applied} discarded {discarded} other {{status}}}',
    exportProposal: '> **Proposed change** ({status}): {summary}',
    exportWorkflowLine: 'Workflow: **{name}**',
    exportOpenedAt: 'Conversation opened on {date}',
    exportMessageCount: '{count, plural, one {# message} other {# messages}}',
    exportAllTitle: 'AI conversations — {name}',
    exportConversationCount: '{count, plural, one {# conversation} other {# conversations}}',
    exportInstanceLine: 'Instance: {name}',
    imageEmpty: 'Empty image',
    imageUnsupported: 'Unsupported image format{hasType, select, true { ({mediaType})} other {}}: {accepted}',
    imageUnreadable: 'Unreadable image (invalid base64)',
    imageTooLarge: 'Image too large ({size}): maximum {max}',
    imageTooMany: '{max} images maximum per message',
    sizeB: '{n} B',
    sizeKb: '{n} KB',
    sizeMb: '{n} MB',
    fileEmpty: '{name}: empty file',
    fileUnsupported: '{name}: unsupported file type. Accepted text formats: {accepted}.',
    fileBinary: '{name}: the content is not readable text',
    fileTooLarge: '{name}: file too large ({size}), maximum {max}',
    fileTooMany: '{max} files maximum per message',
    filesTooLargeTotal: 'Files too large in total ({size}): maximum {max} per message',
    proposalDefaultSummary: 'Proposed change',
    replyUnreadable: 'The reply came back in a format I could not read, and nothing was kept from it.',
    repairNoteRepaired:
      '> 🔁 The first version of this change was rejected by the checks; it was fixed and rechecked before being proposed to you ({attempts, plural, one {# pass} other {# passes}}).',
    repairNoteAbandoned:
      '> 🔁 The proposed change was rejected by the checks and the fix did not work: the request was dropped rather than having you review a diff that cannot be applied.',
    repairNoteGaveUp:
      '> 🔁 This change was reworked {attempts, plural, one {# time} other {# times}} and is still rejected by the checks. It is shown as is so you can see what blocks it — rephrase the request.',
    quotedName: '"{name}"',
    proposalNoOperation:
      'the change carries no operation — neither on this workflow nor on the sub-workflows it calls',
    proposalReplayFailed: 'Operations cannot be replayed on the current state: {detail}',
    proposalAlreadyDone: 'Proposal already {status, select, applied {applied} other {rejected}}',
    proposalWorkflowMissing: 'n8n no longer knows this workflow: nothing can be written to it.',
    proposalStale:
      '"{name}" has changed in n8n since this change was prepared — someone edited it, or a previous application went through without you being told. Applying it now would overwrite that change: open the workflow in n8n to see where it stands, then restart the request in the conversation to start again from that state.',
    proposalArchived: 'Workflow archived in n8n: changes are refused.',
    proposalNoteRefused: '**Application refused** — {summary}\n\n{reason}',
    proposalNoteAppliedPartsOnly:
      '**Change applied in n8n** — {summary}\n\n{parts}"{name}" is not modified: the whole change was on the sub-workflows it calls. Everything that follows starts from this state.',
    proposalNoteApplied:
      '**Change applied in n8n** — {summary}\n\n{parts}"{name}" is up to date in n8n{versioned, select, true {, and a new version was saved} other {}}{draft, select, true {. It is saved AS A DRAFT: the workflow is not published, nothing will run until it is} other {}}. Everything that follows starts from this state.{hasRestore, select, true {\n\nIf things go wrong, the previous state is archived (version of {restoredAt}) and can be restored from the review or the Versions page.} other {\n\nNo restore point archived for the previous state: mention it before proposing anything else.}}',
    proposalNoteAppliedSyncFailed:
      '**Change applied in n8n** — {summary}\n\nThe write went through, but the platform could not read "{name}" back right after: its local copy may be behind. Read it again before proposing anything else.',
    proposalSyncError:
      'The change is saved in n8n, but the platform could not read the workflow back right after: no version was archived for this change. The hourly sync will catch up, or run "Synchronize" from the workflow list.',
    proposalPartMissing:
      'n8n no longer knows "{name}": nothing can be written to it, and this change touches it. Restart the request in the conversation.',
    proposalPartArchived:
      '"{name}" is archived in n8n: changes to it are refused. Unarchive it in n8n, then come back to apply.',
    proposalPartStale:
      '"{name}" has changed in n8n since this change was prepared. Applying it now would overwrite that change: restart the request in the conversation to start again from that state.',
    proposalPartBlocked: '"{name}" — {reason}',
    proposalRefusedDefault: 'change refused',
    proposalNoDetail: '(no detail)',
    proposalWriteRejected:
      'n8n refused to save "{name}" (error {status}). Nothing was changed. Its response: {detail}',
    proposalWriteFailed:
      'n8n could not process the write of "{name}" (error {status}). The write may not have gone through: open the workflow in n8n to check its state before retrying. Its response: {detail}',
    proposalWhereRefusals: 'What the platform had flagged and which explains this refusal: {list}',
    proposalWhereItem: '{hasNode, select, true {"{node}" — } other {}}{message}',
    proposalWhereUnknown:
      'n8n does not say which node: a collection sub-key is not among those the node declares. The platform did not find it in its schemas — the catalog only describes one version per node type, and says nothing about the others. Run a check of the workflow, and sync the instance node types so the check covers the versions it actually serves.',
    proposalNotPending: 'This proposal is no longer pending',
    proposalNoteDiscarded:
      '**Change rejected** — {summary}\n\nThe workflow was not modified. Do not propose it again as is: ask what was wrong.',
    proposalNoteDiscardedOrphans:
      'Created for this change and left empty in n8n: {names}. They still exist — reuse them if the request comes back, rather than creating new ones; otherwise they can be deleted from the review or the drawer banner.',
    proposalPartsWritten: 'Sub-workflows written: {list}.',
    proposalPartWritten: '"{name}"{unchanged, select, true { (content unchanged)} other {}}',
    blankWorkflowGreeting:
      'This workflow is empty: it only contains its trigger. **What should it do?**\n\nThe most useful things to tell me:\n- what triggers it (webhook call, schedule, manual action);\n- the data that comes in and where it comes from;\n- what should come out at the end, and where.\n\nI will propose the nodes and their connections; nothing goes to n8n before you have reviewed the diff.',
    defaultImagePrompt: 'Here is a screenshot. What does it show, and what should be done about it?',
    defaultFilePrompt:
      'Here are one or more attached files. What do they contain, and what should be done with them?',
    emptyReplyNote:
      '⚠️ The AI finished its turn without replying anything. Rephrase your request, or split it into several steps.',
    sessionNewTitle: 'New conversation',
    sessionBuildTitle: 'Building the workflow',
    sessionNotFound: 'Conversation {id} not found',
    attachmentNotFound: 'Attachment {id} not found',
    noPendingRequest: 'No pending request in this conversation.',
    emptyMessage: 'Empty message',
    unknownError: 'unknown error',
    turnFailed:
      '⚠️ This turn failed before I could reply: {detail}\n\nYour request is kept as is — restart it from the banner above the input.',
    progressContext: 'Preparing the context',
    progressAnalyse: 'Analysing the workflow',
    progressAnalyseMore: 'Continuing the analysis',
    progressWriting: 'Writing the reply',
    progressRepair: 'Fixing the refused change (pass {attempt})',
    aiCallFailed: '⚠️ The AI call failed: {detail}',
    aiCallFailedSalvaged:
      '⚠️ The assistant did not return a reply ({detail}), but the change it had checked during this turn is proposed below.',
    targetOutOfScope: 'outside the scope of this conversation (scope: {scope})',
    targetReadOnly: 'not editable',
    replyTargetsRejected: '> ⚠️ These workflows were not kept in the change: {list}.',
    rejectedTarget: '"{name}" ({reason})',
    replyTouchesParts:
      '> 🔗 This change also touches {count, plural, one {# sub-workflow} other {# sub-workflows}}: the review shows them one by one, and "Apply" writes them all.',
    replySalvagedDraft:
      '> ℹ️ The reply did not carry the change: the draft checked during this turn is what is proposed below.',
    replyProposalNotKept: '> ⚠️ The platform could not keep the proposed change: {detail}',
    replyProposalUnreadable:
      '> ⚠️ A change was proposed but its format was unreadable: nothing was kept. Ask for it again in several steps, one node at a time.',
    makeScenarioMissing: 'Make no longer knows this scenario: nothing can be written to it.',
    makeStale:
      '"{name}" has changed in Make since this change was prepared. Applying it now would overwrite that change: restart the request in the conversation to start again from that state.',
    makeRestoreHint:
      '{hasRestore, select, true {\n\nIf things go wrong, the previous state is archived (version of {restoredAt}) and can be restored from the review or the Versions page.} other {\n\nNo restore point archived for the previous state: mention it before proposing anything else.}}',
    makeNoteApplied:
      '**Change applied in Make** — {summary}\n\n"{name}" is up to date in Make{versioned, select, true {, and a new version was saved} other {}}. Everything that follows starts from this state.',
    makeNoteAppliedSyncFailed:
      '**Change applied in Make** — {summary}\n\nThe write went through, but the platform could not read "{name}" back right after: read it again before proposing anything else.',
    makeSyncError:
      'The change is saved in Make, but the platform could not read the scenario back right after: no version was archived for this change. The hourly sync will catch up.',
    makeWriteRejected:
      'Make refused to save "{name}" (error {status}). Nothing was changed. Its response: {detail}',
    progressSyncScenario: 'Reloading the scenario from Make',
    progressAnalyseScenario: 'Analysing the scenario',
    makeOnlyOpenScenario: '> ⚠️ On a Make scenario, only the change to the open scenario is kept.',
    makeProposalUnreadable: '> ⚠️ A change was proposed but its format was unreadable: nothing was kept.',
    errorFixGroupNotFound: 'Error group {id} not found',
    errorFixNoWorkflow: 'Workflow not synchronized in the platform: nothing to edit here.',
    fixTitle: 'Fix: {subject}',
    fixTitleCount: 'Fix: {count, plural, one {# finding} other {# findings}}',
    turnStoppedNoReply: 'The turn was stopped before any reply.',
    errorFixSample: '- {at}: {message}{stack}',
    errorFixSampleStack: '\n  stack (start): {stack}',
    errorFixNoMessage: '(no message)',
    errorFixUnknownNode: 'unknown',
    errorFixPurged: '- (detail purged by n8n)',
    errorFixRequest:
      'This workflow fails in production, and I want a fix.\n\nProblem (grouped by the platform):\n- failing node: {node}{nodeType}\n- message shape: {pattern}\n- category: {category}\n- {count, plural, one {# occurrence} other {# occurrences}} between {first} and {last}{regressions, plural, =0 {} other {\n- already marked as fixed # times: the problem comes back, look for the root cause}}\n\nLatest real occurrences:\n{samples}\n\nPropose the MINIMAL change that fixes the cause, or failing that makes the workflow\nrobust to this failure (retry, guard on the data, error output wired) without hiding it.\nIf the real fix is outside the workflow (expired credential, provider quota, data\non the third-party side), say so clearly and do NOT propose a change.',
    findingFixNone: 'No finding to fix',
    findingFixNotFound: 'Findings not found',
    findingFixSameWorkflow: 'The findings must belong to the same workflow',
    findingFixNode: 'node "{name}"',
    findingFixLine: 'line {line}',
    findingFixWhere: 'where: {where}',
    findingFixCode: 'code:',
    findingFixSuggestion: 'fix already identified: {suggestion}',
    findingFixIntro:
      'The analysis of this workflow reported {count, plural, one {this problem, and I want to fix it} other {these problems, and I want to fix them}}.',
    findingFixInstructions:
      'Propose the MINIMAL change that fixes the cause. Do not rewrite what is not targeted,\nand do not "clean up" anything along the way: the diff must be reviewable in a few seconds.\nIf a remark is actually a false positive (value deliberately left as a template,\nin-house convention, intended behaviour), say so and do NOT fix it — I will mark it as normal.',
    credentialFilledOnly: 'Credential set on "{node}": {posed} (the only one of its type on the instance).',
    credentialFilledMostUsed:
      'Credential set on "{node}": {posed} — the most used. To check, the instance knows others of the same type: {others}.',
    autofixStale:
      'The workflow has changed since the analysis: this fix no longer applies. Run the check again.',
    autofixSummary: 'Fix computed by the rule (no AI):',
    memoryEmpty: 'Empty fact',
    memoryTooLong:
      'Fact too long ({length} characters, maximum {max}): keep the constraint, not its context.',
    memoryFull: 'Memory full ({max} facts): ask the user to remove some from the drawer before adding more.',
    memoryDuplicate: 'This fact was already stored.',
    leftoverNotLeftover:
      'This workflow is no longer a leftover: either it was not created by the assistant, or it now has nodes or is being called. Nothing was deleted.',
    scopeArchived: 'archived in n8n: any write is refused until it is no longer archived.',
    manifestName: 'Workflow AI assistant',
    manifestDescription: 'AI assistant: questions and changes reviewed as a diff',
    workflowNotFound: 'Workflow {id} not found',
  },
  {
    progressReadNode: 'Relecture d’un nœud',
    progressReadWorkflow: 'Lecture d’un sous-workflow appelé',
    progressCreateSubWorkflow: 'Création du sous-workflow',
    progressCheckDraft: 'Vérification du brouillon',
    progressListCredentials: 'Lecture des credentials disponibles',
    progressDescribeNodeType: 'Lecture du schéma d’un type de nœud',
    progressReadNodeDocs: 'Lecture du mode d’emploi d’un nœud',
    progressSearchNodeTypes: 'Recherche d’un type de nœud',
    progressSyncWorkflow: 'Relecture du workflow depuis n8n',
    progressRemember: 'Mémorisation d’un fait',
    progressListConversations: 'Relecture des conversations passées',
    progressReadConversation: 'Relecture d’une conversation',
    progressFindExamples: 'Recherche d’exemples dans les autres workflows',
    progressReadExampleWorkflow: 'Lecture d’un workflow du parc',
    progressSearchDocs: 'Recherche de la documentation du service',
    progressReadDocs: 'Lecture de la documentation du service',
    progressReadModule: 'Relecture d’un module',
    progressUnknownTool: 'Outil {name}',
    exportYou: 'Vous',
    exportScreenshots:
      "_{count, plural, one {# capture d'écran jointe (non exportée)} other {# captures d'écran jointes (non exportées)}}._",
    exportFiles:
      '_{count, plural, one {Fichier joint} other {Fichiers joints}} (contenu non exporté) : {names}._',
    exportProposalStatus:
      '{status, select, pending {en attente} applied {appliquée} discarded {écartée} other {{status}}}',
    exportProposal: '> **Modification proposée** ({status}) : {summary}',
    exportWorkflowLine: 'Workflow : **{name}**',
    exportOpenedAt: 'Conversation ouverte le {date}',
    exportMessageCount: '{count, plural, one {# message} other {# messages}}',
    exportAllTitle: 'Conversations IA — {name}',
    exportConversationCount: '{count, plural, one {# conversation} other {# conversations}}',
    exportInstanceLine: 'Instance : {name}',
    imageEmpty: 'Image vide',
    imageUnsupported:
      "Format d'image non supporté{hasType, select, true { ({mediaType})} other {}} : {accepted}",
    imageUnreadable: 'Image illisible (base64 invalide)',
    imageTooLarge: 'Image trop lourde ({size}) : maximum {max}',
    imageTooMany: '{max} images au maximum par message',
    sizeB: '{n} o',
    sizeKb: '{n} ko',
    sizeMb: '{n} Mo',
    fileEmpty: '{name} : fichier vide',
    fileUnsupported: '{name} : type de fichier non supporté. Formats texte acceptés : {accepted}.',
    fileBinary: "{name} : le contenu n'est pas du texte lisible",
    fileTooLarge: '{name} : fichier trop lourd ({size}), maximum {max}',
    fileTooMany: '{max} fichiers au maximum par message',
    filesTooLargeTotal: 'Fichiers trop lourds au total ({size}) : maximum {max} par message',
    proposalDefaultSummary: 'Modification proposée',
    replyUnreadable:
      'La réponse est revenue dans un format que je n’ai pas su relire, et rien n’en a été retenu.',
    repairNoteRepaired:
      "> 🔁 La première version de cette modification était refusée par les contrôles ; elle a été corrigée et revérifiée avant de t'être proposée ({attempts, plural, one {# passe} other {# passes}}).",
    repairNoteAbandoned:
      "> 🔁 La modification proposée était refusée par les contrôles et la correction n'a rien donné : la demande a été abandonnée plutôt que de te faire relire un diff inapplicable.",
    repairNoteGaveUp:
      '> 🔁 Cette modification a été reprise {attempts, plural, one {# fois} other {# fois}} et reste refusée par les contrôles. Elle est affichée telle quelle pour que tu voies ce qui bloque — reformule la demande.',
    quotedName: '« {name} »',
    proposalNoOperation:
      "la modification ne porte aucune opération — ni sur ce workflow, ni sur les sous-workflows qu'il appelle",
    proposalReplayFailed: "Opérations non rejouables sur l'état actuel : {detail}",
    proposalAlreadyDone: 'Proposition déjà {status, select, applied {appliquée} other {rejetée}}',
    proposalWorkflowMissing: 'n8n ne connaît plus ce workflow : rien ne peut y être écrit.',
    proposalStale:
      "« {name} » a changé dans n8n depuis que cette modification a été préparée — quelqu'un l'a édité, ou une application précédente a abouti sans qu'on te l'ait dit. L'appliquer maintenant écraserait ce changement : ouvre le workflow dans n8n pour voir où il en est, puis relance la demande dans la conversation pour repartir de cet état.",
    proposalArchived: 'Workflow archivé côté n8n : les modifications sont refusées.',
    proposalNoteRefused: '**Application refusée** — {summary}\n\n{reason}',
    proposalNoteAppliedPartsOnly:
      "**Modification appliquée dans n8n** — {summary}\n\n{parts}« {name} » n'est pas modifié : tout le changement portait sur les sous-workflows qu'il appelle. Tout ce qui suit repart de cet état.",
    proposalNoteApplied:
      "**Modification appliquée dans n8n** — {summary}\n\n{parts}« {name} » est à jour côté n8n{versioned, select, true {, et une nouvelle version a été enregistrée} other {}}{draft, select, true {. Elle est enregistrée EN BROUILLON : le workflow n’est pas publié, rien ne s’exécutera tant qu’il ne l’est pas} other {}}. Tout ce qui suit repart de cet état.{hasRestore, select, true {\n\nSi ça tourne mal, l'état d'avant est archivé (version du {restoredAt}) et se restaure depuis la revue ou la page Versions.} other {\n\nAucun point de retour archivé pour l'état d'avant : préviens-le avant de proposer autre chose.}}",
    proposalNoteAppliedSyncFailed:
      "**Modification appliquée dans n8n** — {summary}\n\nL'écriture a abouti, mais la plateforme n'a pas réussi à relire « {name} » juste après : sa copie locale est peut-être en retard. Relis-le avant de proposer autre chose.",
    proposalSyncError:
      "La modification est bien enregistrée dans n8n, mais la plateforme n'a pas réussi à relire le workflow juste après : aucune version n'a été archivée pour ce changement. La synchro horaire le rattrapera, ou lance « Synchroniser » depuis la liste des workflows.",
    proposalPartMissing:
      'n8n ne connaît plus « {name} » : rien ne peut y être écrit, et cette modification y touche. Relance la demande dans la conversation.',
    proposalPartArchived:
      '« {name} » est archivé côté n8n : les modifications y sont refusées. Désarchive-le dans n8n, puis reviens appliquer.',
    proposalPartStale:
      "« {name} » a changé dans n8n depuis que cette modification a été préparée. L'appliquer maintenant écraserait ce changement : relance la demande dans la conversation pour repartir de cet état.",
    proposalPartBlocked: '« {name} » — {reason}',
    proposalRefusedDefault: 'modification refusée',
    proposalNoDetail: '(aucun détail)',
    proposalWriteRejected:
      "n8n a refusé d'enregistrer « {name} » (erreur {status}). Rien n'a été modifié. Ce qu'il répond : {detail}",
    proposalWriteFailed:
      "n8n n'a pas pu traiter l'écriture de « {name} » (erreur {status}). L'écriture n'a peut-être pas abouti : ouvre le workflow dans n8n pour voir son état avant de réessayer. Ce qu'il répond : {detail}",
    proposalWhereRefusals: 'Ce que la plateforme avait relevé et qui explique ce refus : {list}',
    proposalWhereItem: '{hasNode, select, true {« {node} » — } other {}}{message}',
    proposalWhereUnknown:
      "n8n ne dit pas quel nœud : une sous-clé de collection ne figure pas parmi celles que le nœud déclare. La plateforme ne l'a pas retrouvée dans ses schémas — le catalogue ne décrit qu'une version par type de nœud, et il se tait sur les autres. Lance une vérification du workflow, et synchronise les types de nœuds de l'instance pour que le contrôle couvre les versions qu'elle sert vraiment.",
    proposalNotPending: 'Cette proposition n’est plus en attente',
    proposalNoteDiscarded:
      "**Modification rejetée** — {summary}\n\nLe workflow n'a pas été modifié. Ne la repropose pas telle quelle : demande ce qui n'allait pas.",
    proposalNoteDiscardedOrphans:
      "Créé(s) pour cette modification et resté(s) vide(s) dans n8n : {names}. Ils existent toujours — réutilise-les si la demande revient, plutôt que d'en créer d'autres ; sinon ils se suppriment depuis la revue ou le bandeau du tiroir.",
    proposalPartsWritten: 'Sous-workflows écrits : {list}.',
    proposalPartWritten: '« {name} »{unchanged, select, true { (contenu inchangé)} other {}}',
    blankWorkflowGreeting:
      'Ce workflow est vide : il ne contient que son déclencheur. **Que doit-il faire ?**\n\nLe plus utile à me dire :\n- ce qui le déclenche (appel webhook, planification, action manuelle) ;\n- les données qui entrent et d’où elles viennent ;\n- ce qui doit sortir à la fin, et où.\n\nJe proposerai les nœuds et leurs connexions ; rien ne part dans n8n avant que tu aies revu le diff.',
    defaultImagePrompt: 'Voici une capture d’écran. Que montre-t-elle, et que faut-il en faire ?',
    defaultFilePrompt: 'Voici un ou plusieurs fichiers joints. Que contiennent-ils, et qu’en faire ?',
    emptyReplyNote:
      '⚠️ L’IA a terminé son tour sans rien répondre. Reformule ta demande, ou découpe-la en plusieurs étapes.',
    sessionNewTitle: 'Nouvelle conversation',
    sessionBuildTitle: 'Construction du workflow',
    sessionNotFound: 'Conversation {id} introuvable',
    attachmentNotFound: 'Pièce jointe {id} introuvable',
    noPendingRequest: 'Aucune demande en attente dans cette conversation.',
    emptyMessage: 'Message vide',
    unknownError: 'erreur inconnue',
    turnFailed:
      '⚠️ Ce tour a échoué avant que je puisse répondre : {detail}\n\nTa demande est conservée telle quelle — relance-la depuis le bandeau au-dessus de la saisie.',
    progressContext: 'Préparation du contexte',
    progressAnalyse: 'Analyse du workflow',
    progressAnalyseMore: 'Poursuite de l’analyse',
    progressWriting: 'Rédaction de la réponse',
    progressRepair: 'Correction de la modification refusée (passe {attempt})',
    aiCallFailed: "⚠️ L'appel à l'IA a échoué : {detail}",
    aiCallFailedSalvaged:
      "⚠️ L'assistant n'a pas rendu de réponse ({detail}), mais la modification qu'il avait vérifiée pendant ce tour est proposée ci-dessous.",
    targetOutOfScope: 'hors du périmètre de cette conversation (périmètre : {scope})',
    targetReadOnly: 'non modifiable',
    replyTargetsRejected: "> ⚠️ Ces workflows n'ont pas été retenus dans la modification : {list}.",
    rejectedTarget: '« {name} » ({reason})',
    replyTouchesParts:
      '> 🔗 Cette modification touche aussi {count, plural, one {# sous-workflow} other {# sous-workflows}} : la revue les montre un par un, et « Appliquer » les écrit tous.',
    replySalvagedDraft:
      "> ℹ️ La réponse ne portait pas la modification : c'est le brouillon vérifié pendant ce tour qui est proposé ci-dessous.",
    replyProposalNotKept: "> ⚠️ La plateforme n'a pas pu retenir la modification proposée : {detail}",
    replyProposalUnreadable:
      "> ⚠️ Une modification était proposée mais son format était illisible : rien n'a été retenu. Redemande-la en plusieurs fois, un nœud à la fois.",
    makeScenarioMissing: 'Make ne connaît plus ce scénario : rien ne peut y être écrit.',
    makeStale:
      "« {name} » a changé dans Make depuis que cette modification a été préparée. L'appliquer maintenant écraserait ce changement : relance la demande dans la conversation pour repartir de cet état.",
    makeRestoreHint:
      "{hasRestore, select, true {\n\nSi ça tourne mal, l'état d'avant est archivé (version du {restoredAt}) et se restaure depuis la revue ou la page Versions.} other {\n\nAucun point de retour archivé pour l'état d'avant : préviens-le avant de proposer autre chose.}}",
    makeNoteApplied:
      '**Modification appliquée dans Make** — {summary}\n\n« {name} » est à jour côté Make{versioned, select, true {, et une nouvelle version a été enregistrée} other {}}. Tout ce qui suit repart de cet état.',
    makeNoteAppliedSyncFailed:
      "**Modification appliquée dans Make** — {summary}\n\nL'écriture a abouti, mais la plateforme n'a pas réussi à relire « {name} » juste après : relis-le avant de proposer autre chose.",
    makeSyncError:
      "La modification est bien enregistrée dans Make, mais la plateforme n'a pas réussi à relire le scénario juste après : aucune version n'a été archivée pour ce changement. La synchro horaire le rattrapera.",
    makeWriteRejected:
      "Make a refusé d'enregistrer « {name} » (erreur {status}). Rien n'a été modifié. Ce qu'il répond : {detail}",
    progressSyncScenario: 'Relecture du scénario depuis Make',
    progressAnalyseScenario: 'Analyse du scénario',
    makeOnlyOpenScenario: '> ⚠️ Sur un scénario Make, seule la modification du scénario ouvert est retenue.',
    makeProposalUnreadable:
      "> ⚠️ Une modification était proposée mais son format était illisible : rien n'a été retenu.",
    errorFixGroupNotFound: "Groupe d'erreurs {id} introuvable",
    errorFixNoWorkflow: 'Workflow non synchronisé dans la plateforme : rien à éditer ici.',
    fixTitle: 'Correctif : {subject}',
    fixTitleCount: 'Correctif : {count} finding(s)',
    turnStoppedNoReply: 'Le tour a été arrêté avant toute réponse.',
    errorFixSample: '- {at} : {message}{stack}',
    errorFixSampleStack: '\n  stack (début) : {stack}',
    errorFixNoMessage: '(sans message)',
    errorFixUnknownNode: 'inconnu',
    errorFixPurged: '- (détail purgé par n8n)',
    errorFixRequest:
      "Ce workflow échoue en production, et je veux un correctif.\n\nProblème (regroupé par la plateforme) :\n- nœud fautif : {node}{nodeType}\n- forme du message : {pattern}\n- catégorie : {category}\n- {count} occurrence(s) entre {first} et {last}{regressions, plural, =0 {} other {\n- déjà marqué corrigé # fois : le problème revient, cherche la cause de fond}}\n\nDernières occurrences réelles :\n{samples}\n\nPropose la modification MINIMALE qui corrige la cause, ou à défaut qui rend le workflow\nrobuste à cet échec (retry, garde sur les données, sortie d'erreur branchée) sans le masquer.\nSi le vrai correctif est hors du workflow (credential expiré, quota du provider, données\ncôté système tiers), dis-le clairement et ne propose PAS de modification.",
    findingFixNone: 'Aucun finding à corriger',
    findingFixNotFound: 'Findings introuvables',
    findingFixSameWorkflow: 'Les findings doivent appartenir au même workflow',
    findingFixNode: 'nœud « {name} »',
    findingFixLine: 'ligne {line}',
    findingFixWhere: 'où : {where}',
    findingFixCode: 'code :',
    findingFixSuggestion: 'piste déjà identifiée : {suggestion}',
    findingFixIntro:
      "L'analyse de ce workflow a remonté {count, plural, one {ce problème, et je veux le corriger} other {ces problèmes, et je veux les corriger}}.",
    findingFixInstructions:
      "Propose la modification MINIMALE qui corrige la cause. Ne réécris pas ce qui n'est pas visé,\net ne « nettoie » rien au passage : le diff doit se relire en quelques secondes.\nSi une remarque est en fait un faux positif (valeur volontairement laissée en gabarit,\nconvention maison, comportement voulu), dis-le et ne la corrige PAS — je la déclarerai normale.",
    credentialFilledOnly: "Credential posée sur « {node} » : {posed} (seule de son type sur l'instance).",
    credentialFilledMostUsed:
      "Credential posée sur « {node} » : {posed} — la plus employée. À vérifier, l'instance en connaît d'autres du même type : {others}.",
    autofixStale:
      'Le workflow a changé depuis l’analyse : ce correctif ne s’applique plus. Relance la vérification.',
    autofixSummary: 'Correctif calculé par la règle (sans IA) :',
    memoryEmpty: 'Fait vide',
    memoryTooLong:
      'Fait trop long ({length} caractères, maximum {max}) : garde la contrainte, pas son contexte.',
    memoryFull:
      "Mémoire pleine ({max} faits) : demande à l'utilisateur d'en retirer depuis le tiroir avant d'en ajouter.",
    memoryDuplicate: 'Ce fait était déjà mémorisé.',
    leftoverNotLeftover:
      "Ce workflow n'est plus un reste : soit il n'a pas été créé par l'assistant, soit il porte désormais des nœuds ou se fait appeler. Rien n'a été supprimé.",
    scopeArchived: 'archivé côté n8n : toute écriture est refusée tant qu’il ne l’est plus.',
    manifestName: 'Assistant IA workflow',
    manifestDescription: 'Assistant IA : questions et modifications revues en diff',
    workflowNotFound: 'Workflow {id} introuvable',
  },
);
