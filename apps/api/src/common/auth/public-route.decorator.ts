import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE_KEY = 'nwm:public-route';

/**
 * Marque une route joignable sans jeton d'accès API : elle est appelée par un
 * système tiers (heartbeat d'un workflow n8n), pas par le front.
 */
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
