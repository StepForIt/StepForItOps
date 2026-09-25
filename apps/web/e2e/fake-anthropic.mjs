// Un fournisseur d'IA de façade, pour que le parcours de l'assistant existe.
//
// Sans lui, le tiroir de l'assistant est le seul écran de la console qu'aucun
// parcours ne traverse : il lui faut une clé et un fournisseur joignable, et
// une vraie clé dans la CI, ce serait un appel facturé — non déterministe — à
// chaque exécution.
//
// Rien n'est branché dans le code applicatif pour cela : le SDK Anthropic lit
// `ANTHROPIC_BASE_URL` de lui-même, et c'est cette variable que la
// configuration Playwright pose sur l'api. Ce qu'on teste ici est le CHEMIN —
// la demande part, la réponse revient, la proposition s'affiche en diff — et
// jamais la qualité d'un modèle, qui n'a rien à faire dans une CI.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 3913);

/**
 * L'enveloppe qu'un tour d'assistant doit rendre. La proposition renomme le
 * déclencheur du workflow servi par le faux n8n : une modification minuscule,
 * mais qui traverse toute la chaîne — opérations, candidat bâti, porte,
 * diff affiché.
 */
const ENVELOPE = JSON.stringify({
  reply:
    'Le déclencheur s’appelle « Déclencheur », ce qui ne dit pas ce qu’il déclenche. ' +
    'Je propose de le renommer en « Départ manuel ».',
  proposal: {
    summary: 'Renommer le déclencheur',
    operations: [{ op: 'rename-node', node: 'Déclencheur', newName: 'Départ manuel' }],
    targets: [],
  },
});

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  // Sonde de démarrage : Playwright attend une réponse 2xx sur une URL avant de
  // déclarer le service prêt, et il la demande en GET.
  if (req.method === 'GET') return send(200, { ok: true });
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
    return send(404, { type: 'error', error: { type: 'not_found_error', message: req.url } });
  }
  const body = JSON.parse((await readBody(req)) || '{}');
  return send(200, {
    id: 'msg_e2e',
    type: 'message',
    role: 'assistant',
    model: body.model ?? 'claude-sonnet-5',
    // Aucun `tool_use` : le tour se conclut du premier coup. La boucle d'outils
    // a ses propres tests, ce parcours-ci regarde l'aller-retour complet.
    content: [{ type: 'text', text: ENVELOPE }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Faux fournisseur IA sur http://127.0.0.1:${PORT}`);
});
