// Le jeu de démo : une agence fictive et ses deux clients, chacun sur son n8n.
//
// Tout est inventé — noms, bases, montants —, et c'est la condition pour
// publier la vidéo : une capture sur un vrai parc montrerait les workflows d'un
// client. Le même module sert le faux n8n (`demo-n8n.mjs`) et le seed
// (`seed.mjs`), pour que la synchro déclenchée pendant une scène retrouve
// exactement ce que la base connaît déjà.
import { n, workflow } from './nodes.mjs';

export const CLIENTS = [
  { key: 'lumiere', name: 'Maison Lumière' },
  { key: 'verdier', name: 'Cabinet Verdier' },
];

export const INSTANCES = [
  { key: 'lumiere', name: 'n8n Maison Lumière', client: 'lumiere' },
  { key: 'verdier', name: 'n8n Cabinet Verdier', client: 'verdier' },
];

const ENV_SUFFIX = { dev: ' - DEV', prod: ' - PROD' };

/** Les envs déclarés : la démo raconte le saut dev → prod, une preprod vide n'y ajouterait qu'une étape « à créer ». */
export const ENVS = [
  { id: 'dev', label: 'DEV', color: 'cyan', monitored: false, canonicalWebhookPath: false, after: null },
  { id: 'prod', label: 'PROD', color: 'geekblue', monitored: true, canonicalWebhookPath: true, after: 'dev' },
];
const AIRTABLE_CRM = { dev: ['appDevCrm01', 'CRM (dev)'], prod: ['appCrmLumiere', 'CRM Maison Lumière'] };

/** Chaque workflow métier, décliné par env. `variant(env)` rend ses nœuds et ses liens. */
const FAMILIES = [
  {
    instance: 'lumiere',
    id: 'commandes',
    name: 'Commandes Shopify → Airtable',
    envs: ['dev', 'prod'],
    minutes: 6,
    variant: (env) => {
      const base = AIRTABLE_CRM[env === 'prod' ? 'prod' : 'dev'];
      const nodes = [
        n.webhook('Nouvelle commande', `commande-shopify${env === 'prod' ? '' : `-${env}`}`),
        n.set('Formater la commande', {
          client: '={{ $json.customer.email }}',
          montant: '={{ $json.total_price }}',
          articles: '={{ $json.line_items.length }}',
        }),
        n.http('Enrichir le client', 'GET', '=https://api.lumiere-shop.fr/clients/{{ $json.client }}', {
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: 'Authorization', value: 'Bearer sk_live_51NzLumiereQx8vT2aKe9' }],
          },
        }),
        n.airtable('Créer la commande', 'create', base, ['tblCommandes', 'Commandes']),
        n.if('Grosse commande ?', "={{ $('Formater commande').item.json.montant > 500 }}", 'true'),
        n.slack('Prévenir #ventes', '#ventes', '=🎉 Commande de {{ $json.montant }} €'),
      ];
      return {
        nodes,
        flow: [
          ['Nouvelle commande', 'Formater la commande'],
          ['Formater la commande', 'Enrichir le client'],
          ['Enrichir le client', 'Créer la commande'],
          ['Créer la commande', 'Grosse commande ?'],
          ['Grosse commande ?', 'Prévenir #ventes'],
        ],
      };
    },
  },
  {
    instance: 'lumiere',
    id: 'paniers',
    name: 'Relances paniers abandonnés',
    envs: ['dev', 'prod'],
    minutes: 4,
    variant: () => ({
      nodes: [
        n.schedule('Toutes les heures', '0 * * * *'),
        n.http('Paniers abandonnés', 'GET', 'https://api.lumiere-shop.fr/checkouts?status=abandoned'),
        n.agent(
          'Rédiger la relance',
          '=Tu écris un email de relance court et chaleureux pour {{ $json.first_name }}. Articles : {{ JSON.stringify($json.items) }}. 80 mots maximum, pas de remise.',
        ),
        n.openAi('GPT-4.1 mini', 'gpt-4.1-mini'),
        n.gmail('Envoyer la relance', '={{ $json.email }}', 'Vous avez oublié quelque chose ✨'),
      ],
      flow: [
        ['Toutes les heures', 'Paniers abandonnés'],
        ['Paniers abandonnés', 'Rédiger la relance'],
        ['GPT-4.1 mini', 'Rédiger la relance', 'ai'],
        ['Rédiger la relance', 'Envoyer la relance'],
      ],
    }),
  },
  {
    instance: 'lumiere',
    id: 'support',
    name: 'Support client — tri des emails (IA)',
    envs: ['dev', 'prod'],
    minutes: 5,
    variant: () => ({
      nodes: [
        n.schedule('Toutes les 5 minutes', '*/5 * * * *'),
        n.http('Emails non lus', 'GET', 'https://api.lumiere-shop.fr/support/inbox?unread=true'),
        n.agent(
          'Classer la demande',
          '=Classe cet email client dans une catégorie (livraison, retour, produit, autre) et résume-le en une phrase.\nEmail : {{ JSON.stringify($json.body) }}\nRéponds en JSON {"categorie","resume"}.',
        ),
        n.anthropic('Claude Sonnet', 'claude-sonnet-5'),
        n.airtable('Ticket support', 'create', AIRTABLE_CRM.prod, ['tblTickets', 'Tickets']),
      ],
      flow: [
        ['Toutes les 5 minutes', 'Emails non lus'],
        ['Emails non lus', 'Classer la demande'],
        ['Claude Sonnet', 'Classer la demande', 'ai'],
        ['Classer la demande', 'Ticket support'],
      ],
    }),
  },
  {
    instance: 'lumiere',
    id: 'stocks',
    name: 'Synchro stocks fournisseur',
    envs: ['prod'],
    minutes: 10,
    variant: () => ({
      nodes: [
        n.schedule('Toutes les 15 minutes', '*/15 * * * *'),
        n.http('Stocks fournisseur', 'GET', 'https://edi.atelier-bougies.fr/api/stock'),
        n.loop('Par lot de 10'),
        n.http(
          'Mettre à jour Shopify',
          'PUT',
          '=https://lumiere.myshopify.com/admin/api/inventory/{{ $json.sku }}',
        ),
      ],
      flow: [
        ['Toutes les 15 minutes', 'Stocks fournisseur'],
        ['Stocks fournisseur', 'Par lot de 10'],
        ['Par lot de 10', 'Mettre à jour Shopify', 1],
        ['Mettre à jour Shopify', 'Par lot de 10'],
      ],
    }),
  },
  {
    instance: 'lumiere',
    id: 'rapport',
    name: 'Rapport ventes hebdo',
    envs: ['dev', 'prod'],
    minutes: 45,
    variant: () => ({
      nodes: [
        n.schedule('Lundi 8h', '0 8 * * 1'),
        n.airtable('Commandes de la semaine', 'search', AIRTABLE_CRM.prod, ['tblCommandes', 'Commandes']),
        n.code(
          'Calculer les totaux',
          'const total = $input.all().reduce((s, i) => s + Number(i.json.montant), 0);\nreturn [{ json: { total, commandes: $input.all().length } }];',
        ),
        n.slack(
          'Poster dans #direction',
          '#direction',
          '=📈 {{ $json.commandes }} commandes, {{ $json.total }} €',
        ),
      ],
      flow: [
        ['Lundi 8h', 'Commandes de la semaine'],
        ['Commandes de la semaine', 'Calculer les totaux'],
        ['Calculer les totaux', 'Poster dans #direction'],
      ],
    }),
  },
  {
    instance: 'verdier',
    id: 'pdf',
    name: 'Générer PDF facture',
    envs: ['dev', 'prod'],
    minutes: 3,
    variant: () => ({
      nodes: [
        n.subTrigger(),
        n.http('Rendre le PDF', 'POST', 'https://pdf.verdier-conseil.fr/render', {
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json) }}',
        }),
      ],
      flow: [['Appelé par un workflow', 'Rendre le PDF']],
    }),
  },
  {
    instance: 'verdier',
    id: 'facturation',
    name: 'Facturation mensuelle',
    envs: ['dev', 'prod'],
    minutes: 90,
    variant: (env) => {
      const nodes = [
        n.schedule('Le 1er du mois', '0 7 1 * *'),
        n.http('Temps passés du mois', 'GET', 'https://api.verdier-conseil.fr/timesheets?month=previous', {
          options: { timeout: 10000 },
        }),
        n.loop('Par client'),
        n.call('Générer le PDF', `pdf-${env}`, `Générer PDF facture${ENV_SUFFIX[env]}`),
        n.gmail(
          'Envoyer la facture',
          '={{ $json.email }}',
          '=Votre facture {{ $now.toFormat("MMMM yyyy") }}',
        ),
      ];
      const flow = [
        ['Le 1er du mois', 'Temps passés du mois'],
        ['Temps passés du mois', 'Par client'],
        ['Par client', 'Générer le PDF', 1],
        ['Générer le PDF', 'Envoyer la facture'],
        ['Envoyer la facture', 'Par client'],
      ];
      // La dev a pris de l'avance : un résumé à la direction, pas encore en prod.
      if (env === 'dev') {
        nodes.push(n.slack('Résumé à #compta', '#compta', '=✅ Factures du mois envoyées'));
        flow.push(['Par client', 'Résumé à #compta', 0]);
      }
      return { nodes, flow };
    },
  },
  {
    instance: 'verdier',
    id: 'impayes',
    name: 'Relances impayés',
    envs: ['dev', 'prod'],
    minutes: 8,
    variant: () => ({
      nodes: [
        n.schedule('Chaque matin', '0 9 * * 1-5'),
        n.http(
          'Factures en retard',
          'GET',
          'https://app.pennylane.com/api/external/v2/customer_invoices?filter=late',
        ),
        n.if('Plus de 30 jours ?', '={{ $json.days_late > 30 }}', 'true'),
        n.gmail('Relance ferme', '={{ $json.customer.email }}', 'Facture impayée — dernier rappel'),
        n.gmail('Relance courtoise', '={{ $json.customer.email }}', 'Petit rappel concernant votre facture'),
      ],
      flow: [
        ['Chaque matin', 'Factures en retard'],
        ['Factures en retard', 'Plus de 30 jours ?'],
        ['Plus de 30 jours ?', 'Relance ferme', 0],
        ['Plus de 30 jours ?', 'Relance courtoise', 1],
      ],
    }),
  },
  {
    instance: 'verdier',
    id: 'qonto',
    name: 'Import relevés bancaires',
    envs: ['prod'],
    minutes: 20,
    variant: () => ({
      nodes: [
        n.schedule('Chaque nuit', '0 2 * * *'),
        n.http('Transactions Qonto', 'GET', 'https://thirdparty.qonto.com/v2/transactions'),
        n.http('Pousser dans Pennylane', 'POST', 'https://app.pennylane.com/api/external/v2/transactions'),
      ],
      flow: [
        ['Chaque nuit', 'Transactions Qonto'],
        ['Transactions Qonto', 'Pousser dans Pennylane'],
      ],
    }),
  },
  {
    instance: 'verdier',
    id: 'veille',
    name: 'Veille fiscale — résumé IA',
    envs: ['prod'],
    minutes: 30,
    variant: () => ({
      nodes: [
        n.schedule('Chaque vendredi', '0 16 * * 5'),
        n.http('Flux BOFiP', 'GET', 'https://bofip.impots.gouv.fr/bofip/rss'),
        n.agent(
          'Résumer les nouveautés',
          '=Résume pour un cabinet comptable les nouveautés fiscales suivantes en 5 puces maximum : {{ JSON.stringify($json.items) }}',
        ),
        n.anthropic('Claude Opus', 'claude-opus-5-5'),
        n.slack('Poster dans #veille', '#veille', '={{ $json.output }}'),
      ],
      flow: [
        ['Chaque vendredi', 'Flux BOFiP'],
        ['Flux BOFiP', 'Résumer les nouveautés'],
        ['Claude Opus', 'Résumer les nouveautés', 'ai'],
        ['Résumer les nouveautés', 'Poster dans #veille'],
      ],
    }),
  },
];

/** Les exemplaires n8n : un par (workflow métier, env). */
export const WORKFLOWS = FAMILIES.flatMap((family) =>
  family.envs.map((env) => {
    const { nodes, flow } = family.variant(env);
    const multiEnv = family.envs.length > 1;
    const wf = workflow({
      id: `${family.id}-${env}`,
      name: multiEnv ? `${family.name}${ENV_SUFFIX[env]}` : family.name,
      tags: [`env:${env}`],
      active: env === 'prod',
      nodes,
      flow,
      // La dev modifiée après la prod : c'est ce qui la fait lire « à déployer ».
      updatedAt: env === 'dev' ? '2026-09-24T15:20:00.000Z' : '2026-09-12T10:00:00.000Z',
    });
    return { instance: family.instance, family: family.id, env, minutes: family.minutes, raw: wf };
  }),
);

export const workflowsOf = (instanceKey) => WORKFLOWS.filter((w) => w.instance === instanceKey);
