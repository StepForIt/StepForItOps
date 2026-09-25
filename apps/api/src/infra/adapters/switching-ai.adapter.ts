import {
  AiAgentParams,
  AiAgentResult,
  AiChatParams,
  AiCredentials,
  AiGenerateParams,
  AiPort,
  AiProvider,
} from '@nwm/core';

/** Le fournisseur actif, relu à chaque appel. */
export type AiProviderResolver = () => Promise<AiProvider>;

/**
 * Aiguille chaque appel vers l'adapter du fournisseur actif. La résolution est
 * faite à l'appel et non à l'injection : la DI ne construit qu'une fois, donc un
 * choix figé au démarrage imposerait de redémarrer l'API pour changer de
 * fournisseur — exactement ce qu'on veut éviter quand l'un des deux est plafonné.
 */
export class SwitchingAiAdapter implements AiPort {
  constructor(
    private readonly adapters: Record<AiProvider, AiPort>,
    private readonly resolve: AiProviderResolver,
  ) {}

  private async active(): Promise<AiPort> {
    return this.adapters[await this.resolve()];
  }

  async isConfigured(): Promise<boolean> {
    return (await this.active()).isConfigured();
  }

  /**
   * Un test porte sur les valeurs d'un formulaire : il vise le fournisseur
   * ANNONCÉ par ces credentials, qui n'est pas forcément celui en service —
   * c'est ainsi qu'on vérifie une clé avant de basculer dessus.
   */
  async testCredentials(credentials?: AiCredentials): Promise<void> {
    const adapter = credentials?.provider ? this.adapters[credentials.provider] : await this.active();
    return adapter.testCredentials(credentials);
  }

  async generate(params: AiGenerateParams): Promise<string> {
    return (await this.active()).generate(params);
  }

  async generateJson<T>(params: AiGenerateParams): Promise<T> {
    return (await this.active()).generateJson<T>(params);
  }

  async chat(params: AiChatParams): Promise<string> {
    return (await this.active()).chat(params);
  }

  async chatWithTools(params: AiAgentParams): Promise<AiAgentResult> {
    return (await this.active()).chatWithTools(params);
  }
}
