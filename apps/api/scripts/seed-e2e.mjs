// Jeu d'essai des parcours de bout en bout (Playwright).
//
// Il vit ici et non dans `apps/web` parce que c'est ici que Prisma est généré :
// le web n'a aucune raison de connaître le schéma de la base, et lui donner un
// client pour les seuls tests serait une dépendance de plus à entretenir.
//
// La base est VIDÉE d'abord : un parcours qui compte des lignes ne peut pas
// partir d'un état laissé par le précédent. Elle doit s'appeler « …_test »,
// comme celle des tests d'api — même garde-fou, même raison.
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL;
const name = url?.split('/').pop()?.split('?')[0] ?? '';
if (!name.endsWith('_test')) {
  console.error(`Base « ${name} » refusée : le seed e2e la VIDE, elle doit s'appeler « …_test ».`);
  process.exit(1);
}

const prisma = new PrismaClient();

/** Un workflow n8n minimal : le miroir en sert le contenu tel quel. */
function raw(externalId, name, nodes = []) {
  return { id: externalId, name, nodes, connections: {}, active: false };
}

async function main() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Workflow", "Instance", "ResourceMapping", "PlatformSettings" RESTART IDENTITY CASCADE',
  );

  const instance = await prisma.instance.create({
    // Le faux n8n des parcours (`apps/web/e2e/fake-n8n.mjs`) : les chemins qui
    // appellent n8n — une recherche sans résultat déclenche une synchro, un
    // export repart de la source — doivent trouver une réponse, sinon la liste
    // se vide ou se remplit selon le moment.
    data: {
      name: 'Atelier',
      baseUrl: `http://127.0.0.1:${process.env.FAKE_N8N_PORT ?? 3912}`,
      apiKey: 'e2e',
    },
  });

  // Deux exemplaires d'un même workflow métier (la vue groupée les réunit), un
  // troisième sans suffixe, et un archivé que les listes doivent taire.
  const fixtures = [
    { externalId: 'facturation-dev', name: 'Facturation - DEV', tags: ['env:dev'] },
    { externalId: 'facturation-prod', name: 'Facturation - PROD', tags: ['env:prod'] },
    { externalId: 'relances', name: 'Relances clients', tags: [] },
    { externalId: 'vieux-truc', name: 'Vieux truc', tags: ['archived'] },
  ];

  for (const fixture of fixtures) {
    await prisma.workflow.create({
      data: {
        instanceId: instance.id,
        externalId: fixture.externalId,
        name: fixture.name,
        active: false,
        tags: fixture.tags,
        hash: `h-${fixture.externalId}`,
        raw: raw(fixture.externalId, fixture.name, [
          { name: 'Déclencheur', type: 'n8n-nodes-base.manualTrigger', parameters: {}, position: [0, 0] },
        ]),
      },
    });
  }

  console.log(`Seed e2e : instance « ${instance.name} » et ${fixtures.length} workflows.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
