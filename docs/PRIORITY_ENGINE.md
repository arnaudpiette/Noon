# Priority Engine de Noon

## Source de vérité

Le classement des actions est centralisé dans `services/personal-intelligence/priority-engine.js`. Les connecteurs et services transforment leurs données en actions normalisées ; ils ne calculent pas leur propre score final.

Le score est déterministe, borné de 0 à 100 et versionné par `PRIORITY_SCORING_VERSION`. La version actuelle est `1`.

## Facteurs et poids

Facteurs positifs : urgence (0,20), impact (0,20), échéance (0,16), priorité du projet (0,12), compatibilité avec le créneau (0,09), énergie disponible (0,05), risque de blocage (0,08) et confiance (0,08).

Facteurs négatifs : coût d’interruption (-0,08) et répétition sans évolution (-0,10).

Les niveaux visibles restent `critique`, `haute`, `moyenne` et `basse`. L’urgence est décrite séparément par `urgente`, `importante` ou `planifiable` afin de ne pas confondre importance fondamentale et proximité temporelle.

## Forme normalisée

Une action peut notamment porter un identifiant, une source, un titre, une échéance, une durée estimée, un projet, des personnes, un impact, une urgence, une confiance, des dépendances et un statut de planification. Les éléments de type information sont conservables par leur source, mais exclus du classement des actions.

Les adaptateurs connus sont :

- `PersonalInboxService.toPriorityActions()` pour la boîte d’entrée et les projets ;
- `lib/morning-brief.normalizeAction()` pour la compatibilité avec le brief matinal ;
- la route de recommandations, qui appelle le singleton du moteur.

## Score et planification

Le score décide quoi traiter en premier. La planification décide où placer l’action. `scheduleFit()` indique si une durée tient dans un créneau sans modifier l’impact fondamental de l’action. La recherche de créneaux et les protections d’agenda restent donc dans les services de planification.

## Brief matinal

Le brief matinal délègue sa normalisation, sa déduplication et son classement au moteur central. Son ancienne formule locale a été supprimée. Le service conserve uniquement ses responsabilités de collecte, de rédaction et de placement prudent dans l’agenda.

## Orchestrateur

Le Noon Orchestrator appelle le moteur uniquement lorsque le Context Builder classe la demande comme planning, calendrier, brief, projet, organisation, tâches ou priorités. Une conversation ordinaire ne déclenche aucun classement. Les résultats sont ajoutés au contexte d’exécution avant la construction du prompt.

## Inventaire des logiques conservées

Les signaux de santé projet, le calcul de pertinence mémoire, la détection de projets, la déduplication/cooldown des alertes et les tris SQL ne sont pas des scores de priorité d’action. Ils restent séparés et peuvent alimenter un adaptateur sans devenir une seconde formule finale.

## Observabilité et confidentialité

Les traces du moteur contiennent uniquement l’identifiant de l’action, le score, le niveau, les facteurs et la version. Elles n’enregistrent ni titre, ni contenu, ni donnée personnelle. Les explications destinées à l’interface sont dérivées des contributions déterministes du score.
