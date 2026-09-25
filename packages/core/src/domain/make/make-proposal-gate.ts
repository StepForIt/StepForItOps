/**
 * La porte d'une proposition sur un scénario Make.
 *
 * La RÈGLE est celle de n8n (`evaluateProposalGate`) — on ne compte que ce que la
 * modification introduit, une `error` introduite bloque dans tous les
 * environnements, et seul un humain la contourne. Ce qui change, ce sont les
 * contrôles : ceux de Make, schéma embarqué compris. Une règle recopiée
 * divergerait au premier ajustement de l'une.
 */
import { GateOptions, GateVerdict, evaluateProposalGate } from '../n8n/proposal-gate';
import { isMakeBlueprint } from './blueprint';
import { runMakeChecks } from './make-checks';

export function evaluateMakeProposalGate(
  before: unknown,
  after: unknown,
  options: Omit<GateOptions, 'breaches'>,
): GateVerdict {
  const findings = (value: unknown) => (isMakeBlueprint(value) ? runMakeChecks(value) : []);
  return evaluateProposalGate(findings(before), findings(after), { ...options, breaches: [] });
}
