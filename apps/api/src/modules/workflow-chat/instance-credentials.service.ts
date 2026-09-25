import { Injectable } from '@nestjs/common';
import {
  CredentialChoice,
  CredentialRef,
  N8nWorkflow,
  chooseCredential,
  collectCredentials,
  credentialTypesForNode,
  credentialsPatch,
} from '@nwm/core';
import { InstanceCorpusService } from './instance-corpus.service';

/** Un nœud à qui l'on vient de poser des credentials, et ce qu'il reste à arbitrer. */
export interface CredentialFill {
  node: string;
  nodeType: string;
  choices: CredentialChoice[];
}

/**
 * Les credentials d'une instance, relevées dans son miroir.
 *
 * Le miroir garde le JSON n8n verbatim, et c'est la seule source qu'on ait :
 * l'API publique n8n ne liste pas les credentials, et l'API interne exige une
 * session de navigateur que la plateforme n'a pas.
 */
@Injectable()
export class InstanceCredentialsService {
  constructor(private readonly corpus: InstanceCorpusService) {}

  /** Toutes les credentials employées sur l'instance, les plus fréquentes en tête. */
  async list(instanceId: string): Promise<CredentialRef[]> {
    return collectCredentials(await this.corpus.raws(instanceId));
  }

  /** Ce qu'on poserait sur un nœud de ce type, et les autres candidates. */
  async choicesFor(instanceId: string, nodeType: string): Promise<CredentialChoice[]> {
    const raws = await this.corpus.raws(instanceId);
    const available = collectCredentials(raws);
    return credentialTypesForNode(raws, nodeType).map((type) => chooseCredential(available, type));
  }

  /**
   * Complète les nœuds AJOUTÉS à qui il manque des credentials.
   *
   * Un nœud ajouté par l'assistant arrivait nu : n8n l'enregistre, puis refuse de
   * publier le workflow, et rien ne le disait avant la première exécution. On ne
   * touche qu'aux nœuds absents de l'original — reposer une credential sur un nœud
   * existant écraserait un choix humain, qui est justement ce qu'on protège.
   *
   * Le remplissage est rendu, pas seulement appliqué : quand plusieurs credentials
   * du même type existent, l'arbitrage revient à l'humain et doit se lire dans la revue.
   */
  async fillAddedNodes(
    instanceId: string,
    before: N8nWorkflow,
    candidate: N8nWorkflow,
  ): Promise<{ workflow: N8nWorkflow; filled: CredentialFill[] }> {
    const existing = new Set((before.nodes ?? []).map((node) => node.name));
    const added = (candidate.nodes ?? []).filter(
      (node) => !existing.has(node.name) && Object.keys(node.credentials ?? {}).length === 0,
    );
    if (added.length === 0) return { workflow: candidate, filled: [] };

    const raws = await this.corpus.raws(instanceId);
    const available = collectCredentials(raws);
    const filled: CredentialFill[] = [];
    const patches = new Map<string, Record<string, { id: string; name: string }>>();

    for (const node of added) {
      const choices = credentialTypesForNode(raws, node.type).map((type) =>
        chooseCredential(available, type),
      );
      const patch = credentialsPatch(choices);
      // Aucun type connu (nœud sans authentification, ou premier de son espèce sur
      // l'instance) ⇒ rien à poser, et rien à signaler non plus.
      if (Object.keys(patch).length === 0) continue;
      patches.set(node.name, patch);
      filled.push({ node: node.name, nodeType: node.type, choices });
    }
    if (patches.size === 0) return { workflow: candidate, filled: [] };

    return {
      workflow: {
        ...candidate,
        nodes: (candidate.nodes ?? []).map((node) =>
          patches.has(node.name) ? { ...node, credentials: patches.get(node.name) } : node,
        ),
      },
      filled,
    };
  }
}

/** Ce qu'on dit à l'humain de ce remplissage, une ligne par nœud. */
export function describeFills(filled: CredentialFill[]): string[] {
  return filled.map((fill) => {
    const posed = fill.choices
      .filter((choice) => choice.chosen)
      .map((choice) => `${choice.type} → « ${choice.chosen?.name} »`)
      .join(', ');
    const arbitrer = fill.choices.filter((choice) => choice.alternatives.length > 0);
    if (arbitrer.length === 0) {
      return `Credential posée sur « ${fill.node} » : ${posed} (seule de son type sur l'instance).`;
    }
    const autres = arbitrer
      .map((choice) => choice.alternatives.map((alt) => `« ${alt.name} »`).join(', '))
      .join(' ; ');
    return (
      `Credential posée sur « ${fill.node} » : ${posed} — la plus employée. ` +
      `À vérifier, l'instance en connaît d'autres du même type : ${autres}.`
    );
  });
}
