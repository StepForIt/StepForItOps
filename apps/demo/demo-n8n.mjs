// Le n8n de la démo : plusieurs instances derrière un seul port (`/i/<instance>`),
// et un ÉTAT en mémoire.
//
// Contrairement au faux n8n des e2e, qui ne sert qu'à lire, celui-ci accepte les
// écritures : la scène de promotion et celle de l'assistant écrivent pour de
// vrai, et l'écran suivant relit ce qui a été écrit — sinon la plateforme
// annoncerait un succès puis montrerait l'état d'avant.
//
// Pas d'`activeVersionId` sur les workflows : la plateforme y lit un n8n 1.x
// (activation directe), sans le modèle de publication des n8n à versions.
import { createServer } from 'node:http';
import { INSTANCES, workflowsOf } from './dataset.mjs';

const PORT = Number(process.env.DEMO_N8N_PORT ?? 3922);

const state = new Map(
  INSTANCES.map((instance) => [
    instance.key,
    {
      workflows: new Map(workflowsOf(instance.key).map((w) => [w.raw.id, structuredClone(w.raw)])),
      tags: new Map(),
      created: 0,
    },
  ]),
);
for (const store of state.values()) {
  for (const wf of store.workflows.values()) for (const tag of wf.tags) store.tags.set(tag.id, tag);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

const now = () => new Date().toISOString();

async function route(store, method, path, req) {
  if (method === 'GET' && path === '/workflows')
    return [200, { data: [...store.workflows.values()], nextCursor: null }];
  if (method === 'POST' && path === '/workflows') {
    const body = await readBody(req);
    const id = `demo-${++store.created}`;
    const wf = {
      ...body,
      id,
      active: false,
      isArchived: false,
      tags: [],
      createdAt: now(),
      updatedAt: now(),
    };
    store.workflows.set(id, wf);
    return [200, wf];
  }
  // Les exécutions : l'historique vit dans la base de démo, n8n n'en a aucune à rendre.
  if (method === 'GET' && path === '/executions') return [200, { data: [], nextCursor: null }];
  if (method === 'GET' && path === '/tags')
    return [200, { data: [...store.tags.values()], nextCursor: null }];
  if (method === 'POST' && path === '/tags') {
    const body = await readBody(req);
    const tag = { id: `tag-${store.tags.size + 1}`, name: body.name };
    store.tags.set(tag.id, tag);
    return [200, tag];
  }

  const match = path.match(/^\/workflows\/([^/]+)(\/[a-z]+)?$/);
  if (!match) return [404, { message: `Route ${path} non servie par le n8n de démo` }];
  const wf = store.workflows.get(match[1]);
  if (!wf) return [404, { message: 'Not Found' }];
  const action = match[2];

  if (method === 'GET' && !action) return [200, wf];
  if (method === 'PUT' && !action) {
    const body = await readBody(req);
    Object.assign(wf, body, { id: wf.id, updatedAt: now() });
    return [200, wf];
  }
  if (method === 'DELETE' && !action) {
    store.workflows.delete(wf.id);
    return [200, wf];
  }
  if (method === 'POST' && (action === '/activate' || action === '/deactivate')) {
    wf.active = action === '/activate';
    return [200, wf];
  }
  if (method === 'PUT' && action === '/tags') {
    const body = await readBody(req);
    wf.tags = body.map(({ id }) => store.tags.get(id)).filter(Boolean);
    return [200, wf.tags];
  }
  return [404, { message: `Route ${method} ${path} non servie par le n8n de démo` }];
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/health') return send(200, { ok: true });
  const scoped = url.pathname.match(/^\/i\/([^/]+)\/api\/v1(\/.*)$/);
  const store = scoped && state.get(scoped[1]);
  if (!store) return send(404, { message: `Instance inconnue : ${url.pathname}` });
  try {
    const [status, body] = await route(store, req.method ?? 'GET', scoped[2], req);
    return send(status, body);
  } catch (error) {
    return send(500, { message: String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`n8n de démo sur http://127.0.0.1:${PORT}`));
