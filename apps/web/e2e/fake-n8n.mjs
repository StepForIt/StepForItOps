// Un n8n de façade, pour que les parcours ne dépendent pas d'un vrai.
//
// Il ne sert pas à tester n8n : il sert à ce que les chemins qui l'appellent
// aient une réponse. La console en emprunte plus qu'il n'y paraît — une
// recherche restée sans résultat déclenche une synchro, l'export d'un workflow
// repart de n8n — et une instance pointée sur un port fermé rend ces
// chemins-là imprévisibles : selon le moment, la liste se vide ou se remplit.
//
// Il sert donc EXACTEMENT les workflows du jeu d'essai (`seed-e2e.mjs`) : une
// synchro déclenchée en cours de parcours doit laisser la base telle qu'elle
// était, sinon c'est le test qui change les données sous ses propres pieds.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_N8N_PORT ?? 3912);

function workflow(id, name, tags = []) {
  return {
    id,
    name,
    active: false,
    isArchived: false,
    nodes: [
      {
        id: `${id}-trigger`,
        name: 'Déclencheur',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      },
    ],
    connections: {},
    tags: tags.map((tag) => ({ id: tag, name: tag })),
  };
}

const WORKFLOWS = [
  workflow('facturation-dev', 'Facturation - DEV', ['env:dev']),
  workflow('facturation-prod', 'Facturation - PROD', ['env:prod']),
  workflow('relances', 'Relances clients'),
  workflow('vieux-truc', 'Vieux truc', ['archived']),
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/api/v1/workflows') {
    return send(200, { data: WORKFLOWS, nextCursor: null });
  }
  const single = url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
  if (single) {
    const found = WORKFLOWS.find((candidate) => candidate.id === single[1]);
    return found ? send(200, found) : send(404, { message: 'Not Found' });
  }
  // Tout le reste est hors du périmètre des parcours : mieux vaut un 404 franc
  // qu'une réponse inventée, qui ferait passer un appel imprévu pour normal.
  return send(404, { message: `Route ${url.pathname} non servie par le faux n8n` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Faux n8n sur http://127.0.0.1:${PORT}`);
});
