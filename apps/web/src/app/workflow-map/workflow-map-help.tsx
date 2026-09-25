'use client';

import React, { useEffect, useState } from 'react';
import { Collapse, Space, Tag, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

const { Paragraph, Text, Title } = Typography;

/** Documentation intégrée de la carte des workflows : dépliée tant qu'il n'y a aucun lien à voir. */
export function WorkflowMapHelp({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [activeKeys, setActiveKeys] = useState<string[]>(defaultOpen ? ['help'] : []);

  useEffect(() => {
    if (defaultOpen) setActiveKeys(['help']);
  }, [defaultOpen]);

  return (
    <Collapse
      style={{ marginTop: 16 }}
      activeKey={activeKeys}
      onChange={(keys) => setActiveKeys(keys as string[])}
      items={[
        {
          key: 'help',
          label: (
            <Space>
              <QuestionCircleOutlined />
              <Text strong>À quoi sert cette page et comment l&apos;utiliser</Text>
            </Space>
          ),
          children: <HelpContent />,
        },
      ]}
    />
  );
}

function HelpContent() {
  return (
    <div style={{ maxWidth: 900 }}>
      <Paragraph>
        Cette page ne montre <Text strong>que les workflows</Text> et la façon dont ils s&apos;enchaînent —
        pas les bases ni les APIs (c&apos;est le rôle de la page <Text strong>Dépendances</Text>). Elle répond
        à : « qui déclenche qui, et dans quel ordre ça tourne ? »
      </Paragraph>

      <Title level={5}>Liens détectés automatiquement</Title>
      <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
        <div>
          <Tag color="blue">appelle</Tag> nœud <Text code>Execute Workflow</Text> : le workflow en déclenche
          un autre comme sous-workflow.
        </div>
        <div>
          <Tag color="purple">outil IA</Tag> sous-workflow branché comme outil sur un agent IA (nœud{' '}
          <Text code>Call n8n Workflow Tool</Text>).
        </div>
        <div>
          <Tag color="cyan">webhook</Tag> nœud <Text code>HTTP Request</Text> qui tape l&apos;URL de webhook
          d&apos;un autre workflow (rapprochement fait sur le chemin du webhook).
        </div>
      </Space>
      <Paragraph>
        Quand l&apos;appel ne part pas d&apos;un flux ordinaire, la flèche annonce{' '}
        <Text strong>d&apos;où il part</Text> plutôt que sa nature, suivi du nombre de nœuds de ce bout de
        workflow : <Tag>boucle (3)</Tag> le nœud appelant est dans une boucle, l&apos;appel part une fois par
        tour ; <Tag>manuel (2)</Tag> son seul déclencheur est le bouton <Text code>Execute workflow</Text> —
        c&apos;est un bouton de test, pas un enchaînement de production (typiquement le nœud qui tape le
        webhook de son propre workflow, d&apos;où les fausses récursions) ; <Tag>sous-workflow (5)</Tag> la
        branche n&apos;est déclenchée que par un autre workflow, l&apos;appel ne part que si le parent tourne.
      </Paragraph>
      <Paragraph type="secondary">
        La détection est <Text strong>recalculée à chaque ouverture</Text> à partir des workflows synchronisés
        : pas de bouton « reconstruire » ici. Un workflow modifié dans n8n apparaît dès qu&apos;il a été
        resynchronisé depuis la page Workflows.
      </Paragraph>

      <Title level={5}>Liens manuels</Title>
      <Paragraph>
        <Tag color="magenta">lien manuel</Tag> ce que le JSON ne dira jamais : un workflow qui en déclenche un
        autre en passant par un outil tiers (Make, Zapier, un cron externe, une action humaine), deux
        workflows qui doivent tourner dans un ordre précis, ou une dépendance métier que tu veux garder écrite
        quelque part. Bouton <Text strong>« Ajouter un lien »</Text> → workflow de départ, workflow
        d&apos;arrivée, libellé affiché sur la flèche, note. Ces liens sont stockés en base :{' '}
        <Text strong>ils survivent aux resynchros</Text> et suivent le workflow s&apos;il est renommé.
      </Paragraph>

      <Title level={5}>Lire le schéma</Title>
      <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
        <li>Trait plein = lien détecté. Pointillés = lien que tu as posé toi-même.</li>
        <li>Cadre bleu = workflow actif ; gris = workflow désactivé dans n8n ; gris pointillé = archivé.</li>
        <li>
          Sous le nom, la <Text strong>façon de démarrer</Text> : planifié, webhook, formulaire, chat, app
          (Telegram, Gmail…), erreur, sous-workflow — plusieurs si le workflow a plusieurs triggers, les
          triggers désactivés exclus. <Text strong>aucun trigger actif</Text> veut dire que plus rien ne peut
          le lancer. <Text strong>test manuel</Text> est affiché en dernier et ne compte pas dans la nature du
          workflow : un bouton « Execute workflow » sert à tester, pas à faire tourner — un workflow{' '}
          <em>sous-workflow · test manuel</em> reste un sous-workflow (cadre violet).
        </li>
        <li>
          Cadre violet = <Text strong>sous-workflow</Text> : il ne tourne jamais seul, son seul déclencheur
          est <Text code>When Executed by Another Workflow</Text>. S&apos;il n&apos;a aucune flèche entrante,
          plus personne ne l&apos;appelle.
        </li>
        <li>
          Un workflow qui s&apos;appelle <em>lui-même</em> en sous-workflow n&apos;a pas de flèche qui revient
          sur sa boîte : la cible est dessinée à part, en{' '}
          <Text strong>violet pointillé « lui-même, en sous-workflow »</Text>. C&apos;est bien la même fiche,
          relancée par la première — souvent une branche qui traite une liste et rappelle le workflow ligne
          par ligne (l&apos;étiquette de la flèche dit alors <Tag>boucle (n)</Tag>).
        </li>
        <li>
          <Text strong>Masquer les archivés</Text> (activé par défaut) — un workflow archivé dans n8n est
          masqué dans la liste n8n et ne tourne plus, mais son JSON contient toujours ses appels : sans ce
          filtre, il pollue le schéma avec des liens morts. Il reste affiché s&apos;il est <em>appelé</em> par
          un workflow vivant, parce que c&apos;est alors un vrai problème à corriger. Attention aux{' '}
          <Text strong>homonymes</Text> : quand un archivé et un vivant portent le même nom, le nom affiché
          est complété par l&apos;instance ou l&apos;id n8n.
        </li>
        <li>
          Pastille verte pointillée en amont = <Text strong>ce qui met le workflow en route</Text> et qui ne
          vient pas de la carte : l&apos;URL publique quand il est appelable (webhook, formulaire, chat),
          sinon <em>planifié</em>, l&apos;application tierce (Telegram, Gmail…),{' '}
          <em>erreur d&apos;un workflow</em> ou <em>lancé à la main</em>. Une pastille par trigger : un
          workflow à la fois webhook et formulaire en a deux, il n&apos;y a rien à départager. Un workflow
          appelé par un parent n&apos;en a pas — c&apos;est déjà une flèche. Ces pastilles ne comptent pas
          comme des liens : un workflow qui n&apos;a que ça reste « isolé ». Interrupteur{' '}
          <Text strong>Points d&apos;entrée</Text> pour les masquer.
        </li>
        <li>
          Cadre orange pointillé = <Text strong>cible hors périmètre</Text> : un workflow appelé qui
          n&apos;est pas (ou plus) synchronisé, ou qui vit sur une autre instance. C&apos;est souvent le signe
          d&apos;un appel cassé — à vérifier.
        </li>
        <li>
          <Text strong>Masquer les isolés</Text> (activé par défaut) cache les workflows sans aucun lien.
          Décoche-le pour avoir l&apos;inventaire complet.
        </li>
      </ul>

      <Title level={5}>Limites</Title>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          Un <Text code>workflowId</Text> construit par expression n&apos;est pas résolvable : ce lien-là, il
          faut le poser à la main.
        </li>
        <li>
          Les appels webhook sont rapprochés par chemin, mais seulement si l&apos;URL vise une instance connue
          de la plateforme. Un appel vers une autre installation n8n s&apos;affiche avec son{' '}
          <Text strong>URL complète</Text>, en cible hors périmètre. Deux instances connues exposant le même
          chemin peuvent encore être confondues.
        </li>
        <li>Les nœuds désactivés sont ignorés.</li>
        <li>
          Le sélecteur d&apos;instance en haut de l&apos;application restreint la carte à une seule instance ;
          les liens qui la quittent apparaissent alors comme hors périmètre.
        </li>
      </ul>
    </div>
  );
}
