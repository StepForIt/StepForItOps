-- Trace des outils appelés pour produire une réponse. Elle vivait dans le texte du
-- message (`<sub>…</sub>`), où elle s'affichait balises comprises. Séparée, elle se
-- replie à l'écran et ne pollue plus ni la lecture ni l'export.
ALTER TABLE "WorkflowChatMessage" ADD COLUMN "toolTrace" JSONB;
