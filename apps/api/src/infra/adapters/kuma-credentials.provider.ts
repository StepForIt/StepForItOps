import { envKumaCredentials, KumaCredentialsProvider } from '@nwm/adapter-uptime-kuma';
import { PrismaService } from '../prisma/prisma.service';

/** Id de la ligne unique de MonitoringSettings portant les credentials Kuma. */
export const KUMA_SETTINGS_ID = 'kuma';

/** Résolution des credentials admin Kuma : réglages en DB d'abord, variables d'env sinon. */
export function kumaCredentialsProvider(prisma: PrismaService): KumaCredentialsProvider {
  return async () => {
    const settings = await prisma.monitoringSettings.findUnique({ where: { id: KUMA_SETTINGS_ID } });
    if (settings?.kumaUrl && settings.kumaUsername && settings.kumaPassword) {
      return { url: settings.kumaUrl, username: settings.kumaUsername, password: settings.kumaPassword };
    }
    return envKumaCredentials();
  };
}
