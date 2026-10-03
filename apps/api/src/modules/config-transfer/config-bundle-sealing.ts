import { ExportKey } from '../../infra/secrets/export-key';
import { ConfigBundle } from './config-bundle.types';

/** Clés considérées comme sensibles dans les configs JSON (cibles export). */
export const SECRET_CONFIG_KEYS = [
  'token',
  'accessToken',
  'apiKey',
  'clientSecret',
  'refreshToken',
  'password',
];

/**
 * Les secrets d'un bundle de configuration, et eux seuls : le reste du fichier
 * reste lisible (on doit pouvoir relire un export sans sa clé, et l'aperçu de
 * l'import n'en a pas besoin pour décrire ce qu'il va faire). La liste est
 * celle des champs que l'export vide quand on le demande « sans secrets ».
 */
function mapSecrets(bundle: ConfigBundle, fn: (value: string) => string): ConfigBundle {
  const secret = <T extends string | null | undefined>(value: T): T =>
    (typeof value === 'string' && value ? fn(value) : value) as T;
  return {
    ...bundle,
    instances: bundle.instances.map((i) => ({
      ...i,
      apiKey: secret(i.apiKey),
      n8nPassword: secret(i.n8nPassword),
    })),
    exportTargets: bundle.exportTargets.map((t) => ({
      ...t,
      config: Object.fromEntries(
        Object.entries(t.config ?? {}).map(([k, v]) => [
          k,
          SECRET_CONFIG_KEYS.includes(k) && typeof v === 'string' ? secret(v) : v,
        ]),
      ),
    })),
    monitoringSettings: bundle.monitoringSettings.map((s) => ({
      ...s,
      kumaPassword: secret(s.kumaPassword),
    })),
    aiSettings: bundle.aiSettings?.map((s) => ({ ...s, apiKey: secret(s.apiKey) })),
  };
}

export function sealBundle(bundle: ConfigBundle, key: ExportKey): ConfigBundle {
  return { ...mapSecrets(bundle, (v) => key.seal(v)), sealed: key.header() };
}

/** Rend le bundle tel qu'avant scellement ; un ancien fichier (sans `sealed`) passe tel quel. */
export function unsealBundle(bundle: ConfigBundle, key: ExportKey): ConfigBundle {
  const unsealed = mapSecrets(bundle, (v) => key.unseal(v));
  delete unsealed.sealed;
  return unsealed;
}
