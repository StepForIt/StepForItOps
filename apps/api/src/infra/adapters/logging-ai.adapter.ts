import { Logger } from '@nestjs/common';
import {
  AiAgentParams,
  AiAgentResult,
  AiChatParams,
  AiCredentials,
  AiGenerateParams,
  AiPort,
  AiToolLoopError,
  AiToolTrace,
} from '@nwm/core';

/**
 * Décore le port IA pour tracer chaque appel : c'est là que part l'essentiel du
 * temps d'une analyse, et rien n'en apparaissait dans les logs. La ligne rappelle
 * `effort` et `maxTokens`, les deux leviers de cette durée.
 */
export class LoggingAiAdapter implements AiPort {
  private readonly logger = new Logger('Ai');

  constructor(private readonly inner: AiPort) {}

  isConfigured(): Promise<boolean> {
    return this.inner.isConfigured();
  }

  testCredentials(credentials?: AiCredentials): Promise<void> {
    return this.inner.testCredentials(credentials);
  }

  generate(params: AiGenerateParams): Promise<string> {
    return this.trace('generate', describe(params), () => this.inner.generate(params));
  }

  generateJson<T>(params: AiGenerateParams): Promise<T> {
    return this.trace('generateJson', describe(params), () => this.inner.generateJson<T>(params));
  }

  chat(params: AiChatParams): Promise<string> {
    const size = params.messages.reduce((total, message) => total + message.content.length, 0);
    return this.trace('chat', `${params.messages.length} tours · ${describe({ ...params, size })}`, () =>
      this.inner.chat(params),
    );
  }

  async chatWithTools(params: AiAgentParams): Promise<AiAgentResult> {
    const size = params.messages.reduce((total, message) => total + message.content.length, 0);
    const detail = `${params.messages.length} tours · ${params.tools.length} outils · ${describe({ ...params, size })}`;
    try {
      const result = await this.trace('chatWithTools', detail, () => this.inner.chatWithTools(params));
      this.logToolTrace(result.trace);
      return result;
    } catch (error) {
      // La trace vaut SURTOUT quand la boucle s'est arrêtée sans conclure : sans
      // elle, on ne sait pas sur quoi elle a tourné — juste qu'elle a échoué.
      if (error instanceof AiToolLoopError) this.logToolTrace(error.trace);
      throw error;
    }
  }

  /** Le détail de la boucle : sans lui, un agent qui tourne six fois ne se lit
   * dans les logs que comme un appel anormalement long. */
  private logToolTrace(trace: AiToolTrace[]): void {
    for (const step of trace) {
      this.logger.log(`  ↳ ${step.name}(${JSON.stringify(step.input)})${step.failed ? ' → erreur' : ''}`);
    }
  }

  private async trace<T>(operation: string, detail: string, call: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const result = await call();
      this.logger.log(`${operation} ${detail} → ${seconds(started)}`);
      return result;
    } catch (error) {
      // L'appelant décide souvent d'avaler l'erreur (analyse dégradée mais
      // rendue) : sans cette ligne, un modèle qui refuse tout passe inaperçu.
      this.logger.warn(
        `${operation} ${detail} → failed after ${seconds(started)}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}

function describe(params: { maxTokens?: number; effort?: string; prompt?: string; size?: number }): string {
  const chars = params.size ?? params.prompt?.length ?? 0;
  return `effort=${params.effort ?? 'default'} max=${params.maxTokens ?? 'default'} in=${Math.round(chars / 1000)} kchars`;
}

function seconds(started: number): string {
  return `${((Date.now() - started) / 1000).toFixed(1)} s`;
}
