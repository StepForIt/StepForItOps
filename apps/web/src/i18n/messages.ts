// Généré à la main : un espace de noms par fichier de messages/<langue>/, les clés de Refine à la racine.
import fr_refine from '../../messages/fr/refine.json';
import fr_common from '../../messages/fr/common.json';
import fr_app from '../../messages/fr/app.json';
import fr_workflowsList from '../../messages/fr/workflowsList.json';
import fr_workflowShow from '../../messages/fr/workflowShow.json';
import fr_chat from '../../messages/fr/chat.json';
import fr_reviewTools from '../../messages/fr/reviewTools.json';
import fr_shell from '../../messages/fr/shell.json';
import fr_settings from '../../messages/fr/settings.json';
import fr_health from '../../messages/fr/health.json';
import fr_inventory from '../../messages/fr/inventory.json';
import fr_misc from '../../messages/fr/misc.json';
import en_refine from '../../messages/en/refine.json';
import en_common from '../../messages/en/common.json';
import en_app from '../../messages/en/app.json';
import en_workflowsList from '../../messages/en/workflowsList.json';
import en_workflowShow from '../../messages/en/workflowShow.json';
import en_chat from '../../messages/en/chat.json';
import en_reviewTools from '../../messages/en/reviewTools.json';
import en_shell from '../../messages/en/shell.json';
import en_settings from '../../messages/en/settings.json';
import en_health from '../../messages/en/health.json';
import en_inventory from '../../messages/en/inventory.json';
import en_misc from '../../messages/en/misc.json';

const fr = {
  ...fr_refine,
  common: fr_common,
  app: fr_app,
  workflowsList: fr_workflowsList,
  workflowShow: fr_workflowShow,
  chat: fr_chat,
  reviewTools: fr_reviewTools,
  shell: fr_shell,
  settings: fr_settings,
  health: fr_health,
  inventory: fr_inventory,
  misc: fr_misc,
};
const en = {
  ...en_refine,
  common: en_common,
  app: en_app,
  workflowsList: en_workflowsList,
  workflowShow: en_workflowShow,
  chat: en_chat,
  reviewTools: en_reviewTools,
  shell: en_shell,
  settings: en_settings,
  health: en_health,
  inventory: en_inventory,
  misc: en_misc,
};

export const MESSAGES = { fr, en };
export type Messages = typeof fr;
