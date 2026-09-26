import { common } from './common';
import { chatTools } from './chatTools';
import { chat } from './chat';
import { edit } from './edit';
import { env } from './env';
import { release } from './release';
import { checks } from './checks';
import { analysis } from './analysis';
import { ops } from './ops';
import { platform } from './platform';
import { learning } from './learning';

/** Un espace par domaine : chacun vit dans son fichier, et les identifiants s'écrivent `<espace>.<clé>`. */
export const MESSAGES = {
  common,
  chatTools,
  chat,
  edit,
  env,
  release,
  checks,
  analysis,
  ops,
  platform,
  learning,
};
