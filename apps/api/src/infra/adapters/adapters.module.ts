import { Global, Module } from '@nestjs/common';
import {
  AI_PORT,
  DOCS_PORT,
  MODEL_PRICING_PORT,
  MONITOR_ADMIN_PORT,
  MONITOR_PORT,
  N8N_API_PORT,
  NODE_CATALOG_PORT,
  NOTIFICATION_PORT,
  STORAGE_PORT,
  VCS_PORT,
  WORKFLOW_PLATFORM_PORT,
  WORKFLOW_PLATFORM_PORTS,
  WorkflowPlatformPorts,
} from '@nwm/core';
import { N8nApiAdapter, N8nPlatformAdapter } from '@nwm/adapter-n8n-api';
import { MakeApiAdapter } from '@nwm/adapter-make-api';
import { N8nMcpCatalogAdapter } from '@nwm/adapter-node-catalog';
import { LiteLlmPricingAdapter } from '@nwm/adapter-model-pricing';
import { Context7DocsAdapter } from '@nwm/adapter-docs';
import { GithubVcsAdapter } from '@nwm/adapter-github';
import { GdriveStorageAdapter } from '@nwm/adapter-gdrive';
import { AnthropicAiAdapter } from '@nwm/adapter-anthropic';
import { MistralAiAdapter } from '@nwm/adapter-mistral';
import { KumaAdminAdapter, UptimeKumaAdapter } from '@nwm/adapter-uptime-kuma';
import { NotificationAdapter } from '@nwm/adapter-notify';
import { PrismaService } from '../prisma/prisma.service';
import { kumaCredentialsProvider } from './kuma-credentials.provider';
import { activeAiProvider, aiCredentialsProvider } from './ai-credentials.provider';
import { LoggingAiAdapter } from './logging-ai.adapter';
import { SwitchingAiAdapter } from './switching-ai.adapter';

/**
 * Câblage hexagonal : chaque port est fourni par son adapter.
 * Remplacer un système externe = changer une ligne ici.
 */
@Global()
@Module({
  providers: [
    { provide: N8N_API_PORT, useClass: N8nApiAdapter },
    // Le port commun aux plateformes. Une seule implémentation aujourd'hui —
    // c'est le point où un adapter Make se branchera, résolu alors sur
    // `Instance.platform` et non plus en dur.
    {
      provide: WORKFLOW_PLATFORM_PORT,
      inject: [N8N_API_PORT],
      useFactory: (api: N8nApiAdapter) => new N8nPlatformAdapter(api),
    },
    // Les plateformes servies, par id. On résout sur `Instance.platform`.
    {
      provide: WORKFLOW_PLATFORM_PORTS,
      inject: [WORKFLOW_PLATFORM_PORT],
      useFactory: (n8n: N8nPlatformAdapter): WorkflowPlatformPorts => ({
        n8n,
        make: new MakeApiAdapter(),
      }),
    },
    { provide: NODE_CATALOG_PORT, useClass: N8nMcpCatalogAdapter },
    { provide: MODEL_PRICING_PORT, useClass: LiteLlmPricingAdapter },
    { provide: DOCS_PORT, useClass: Context7DocsAdapter },
    { provide: VCS_PORT, useClass: GithubVcsAdapter },
    { provide: STORAGE_PORT, useClass: GdriveStorageAdapter },
    {
      provide: AI_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new LoggingAiAdapter(
          new SwitchingAiAdapter(
            {
              anthropic: new AnthropicAiAdapter(aiCredentialsProvider(prisma, 'anthropic')),
              mistral: new MistralAiAdapter(aiCredentialsProvider(prisma, 'mistral')),
            },
            () => activeAiProvider(prisma),
          ),
        ),
    },
    { provide: MONITOR_PORT, useClass: UptimeKumaAdapter },
    { provide: NOTIFICATION_PORT, useClass: NotificationAdapter },
    {
      provide: MONITOR_ADMIN_PORT,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new KumaAdminAdapter(kumaCredentialsProvider(prisma)),
    },
  ],
  // `@Global()` ne partage que ce qui est EXPORTÉ : un port fourni mais absent
  // d'ici est introuvable partout ailleurs, et l'api meurt au démarrage sans que
  // le typecheck ait rien à redire.
  exports: [
    N8N_API_PORT,
    WORKFLOW_PLATFORM_PORT,
    WORKFLOW_PLATFORM_PORTS,
    NODE_CATALOG_PORT,
    MODEL_PRICING_PORT,
    DOCS_PORT,
    VCS_PORT,
    STORAGE_PORT,
    AI_PORT,
    MONITOR_PORT,
    MONITOR_ADMIN_PORT,
    NOTIFICATION_PORT,
  ],
})
export class AdaptersModule {}
