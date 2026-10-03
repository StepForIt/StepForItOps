// L'IA de la démo : des réponses écrites d'avance, reconnues à leur consigne.
//
// Même principe que `apps/web/e2e/fake-anthropic.mjs` — le SDK lit
// `ANTHROPIC_BASE_URL`, rien n'est branché dans l'application —, mais scénarisé :
// une vidéo doit montrer une réponse PERTINENTE, et une vraie clé rendrait la
// capture payante et différente à chaque passage.
import { createServer } from 'node:http';

const PORT = Number(process.env.DEMO_AI_PORT ?? 3923);

const IMPAYES_PROPOSAL = {
  reply:
    'Deux changements : l’appel Pennylane reçoit un délai de 10 s (sans lui, une API lente bloque ' +
    'l’exécution entière), et chaque relance ferme prévient #compta sur Slack, avec le client et le montant.',
  proposal: {
    summary: 'Timeout Pennylane + alerte #compta sur les relances fermes',
    operations: [
      {
        op: 'patch-node-parameters',
        node: 'Factures en retard',
        parameters: { options: { timeout: 10000 } },
      },
      {
        op: 'add-node',
        after: 'Relance ferme',
        node: {
          name: 'Prévenir #compta',
          type: 'n8n-nodes-base.slack',
          typeVersion: 2.2,
          credentials: { slackApi: { id: 'cred-slack', name: 'Slack équipe' } },
          parameters: {
            select: 'channel',
            channelId: { __rl: true, mode: 'list', value: 'C069X', cachedResultName: '#compta' },
            text: '=⚠️ Relance ferme envoyée à {{ $json.customer.name }} — {{ $json.amount }} €',
            otherOptions: {},
          },
        },
      },
    ],
    targets: [],
  },
};

const COMMANDES_PROPOSAL = {
  reply:
    'Le jeton Shopify était écrit en clair dans l’en-tête : il passe par une variable d’environnement. ' +
    'Et la condition visait « Formater commande », un nœud renommé depuis — elle lit maintenant le montant du bon nœud.',
  proposal: {
    summary: 'Jeton hors du workflow, référence de nœud réparée',
    operations: [
      {
        op: 'patch-node-parameters',
        node: 'Enrichir le client',
        parameters: {
          headerParameters: {
            parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.LUMIERE_API_TOKEN }}' }],
          },
        },
      },
      {
        op: 'patch-node-parameters',
        node: 'Grosse commande ?',
        parameters: {
          conditions: {
            conditions: [
              {
                id: 'montant',
                leftValue: "={{ $('Formater la commande').item.json.montant > 500 }}",
                rightValue: 'true',
                operator: { type: 'string', operation: 'equals' },
              },
            ],
          },
        },
      },
    ],
    targets: [],
  },
};

/** Un 401 ne se corrige pas dans le workflow : l'assistant le dit au lieu d'inventer un diff. */
const QONTO_DIAGNOSTIC = {
  reply:
    'Le correctif n’est pas dans le workflow : Qonto refuse le jeton (401), qui a expiré. Il est revenu malgré ' +
    'le renouvellement de la semaine dernière, signe que le nouveau jeton a la même durée de vie courte.\n\n' +
    '1. Régénère un jeton Qonto sans date d’expiration (Paramètres → Intégrations → API).\n' +
    '2. Mets à jour la credential « Qonto » dans n8n.\n' +
    '3. Marque le problème comme traité : s’il revient, il se rouvrira tout seul.',
  proposal: null,
};

const REVIEW_COMMANDES = {
  understood: true,
  summary: 'Enregistre chaque commande Shopify dans Airtable et prévient #ventes des grosses commandes.',
  issues: [
    {
      nodeName: 'Grosse commande ?',
      message:
        'La condition compare un booléen à la chaîne « true » en mode strict : elle ne sera jamais vraie.',
      severity: 'warning',
      evidence: "{{ $('Formater commande').item.json.montant > 500 }}",
      suggestion: 'Utiliser un opérateur booléen « is true » ou comparer le nombre directement.',
    },
  ],
};

/** Quelle réponse pour cette requête : on reconnaît la consigne, jamais le modèle. */
function answer(body) {
  const system = Array.isArray(body.system)
    ? body.system.map((b) => b.text ?? '').join('\n')
    : String(body.system ?? '');
  const all = JSON.stringify(body.messages ?? []);
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    if (all.includes('status code 401')) return JSON.stringify(QONTO_DIAGNOSTIC);
    return JSON.stringify(all.includes('Commandes Shopify') ? COMMANDES_PROPOSAL : IMPAYES_PROPOSAL);
  }
  if (system.includes('On te donne le JSON d')) {
    return JSON.stringify(
      all.includes('Commandes Shopify') ? REVIEW_COMMANDES : { understood: true, summary: '', issues: [] },
    );
  }
  if (system.includes('versionnage sémantique')) {
    return JSON.stringify({
      level: 'minor',
      reason: 'Un résumé Slack s’ajoute en fin de facturation : le workflow fait plus, sans rien retirer.',
    });
  }
  // Tout le reste (renommages, tri des tâches, estimations) : rien à proposer.
  return '[]';
}

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
  if (req.method === 'GET') return send(200, { ok: true });
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
    return send(404, { type: 'error', error: { type: 'not_found_error', message: req.url } });
  }
  const body = JSON.parse((await readBody(req)) || '{}');
  // Le temps d'un vrai modèle : l'indicateur de progression doit avoir le temps de se voir.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return send(200, {
    id: 'msg_demo',
    type: 'message',
    role: 'assistant',
    model: body.model ?? 'claude-sonnet-5',
    content: [{ type: 'text', text: answer(body) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1800, output_tokens: 420 },
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`IA de démo sur http://127.0.0.1:${PORT}`));
