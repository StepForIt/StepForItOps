import { SetMetadata } from '@nestjs/common';

export const MODULE_ID_KEY = 'nwm:module-id';

/** À poser sur un controller pour lier ses routes à un module désactivable. */
export const ModuleId = (moduleId: string) => SetMetadata(MODULE_ID_KEY, moduleId);
