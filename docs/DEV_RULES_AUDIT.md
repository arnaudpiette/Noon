# Audit — règles et instructions DEV

Date : 2026-10-02 (mis à jour après première tranche V1)
Portée : règles appliquées aux tâches DEV dans le code courant. Cet audit ne
modifie pas les moteurs DEV, les politiques d'autorisation ou la persistance.

## Chemins effectivement câblés

| Producteur | Stockage / représentation | Contexte transmis | Consommateur réel | Statut |
| --- | --- | --- | --- | --- |
| Registre produit `services/rules/hard-rules-registry.js` | Constantes `RULES`, version déterministe ; aucune API de modification | `ContextBuilder` sélectionne les règles par intention, mode, projet et canal | prompt de chat, `OperationalSecurityPolicy`, planification et contrôles de permissions | Implémenté et appelé |
| Profil opérationnel `services/personal-intelligence/operational-profile.js` | `memory_items` privé (`work_preference`, `permanent_constraint`, `temporary`) | `portrait()` expose les préférences au lecteur de profil ; `ensurePermanentRules()` ne fait qu'enregistrer les règles statiques legacy | parcours mémoire/profil ; aucune injection trouvée vers `NativeDevReasoner`, `DevTaskContract` ou le terminal DEV | Présent, mais non câblé aux tâches DEV |
| Workspace / projet `services/workspaces/workspace-engine.js` et registre Focus de `server.js` | workspace, liens projet/racine/conversation/artefact ; métadonnées projet détectées | `workspace.context()` fournit projet actif, racines et scopes ; le chat reçoit seulement les métadonnées compactes du projet | résolution du workspace, bornage des racines et contexte chat | Implémenté et appelé, mais pas de règle DEV par projet persistée |
| Contrat DEV `services/delegation/dev-task-contract.js` | objet éphémère par tâche : `objective`, `constraints`, `projectInstructions`, `validationCommands`, permissions et bornes | `constraints` va au payload de `NativeDevReasoner`; `validationCommands` sert au baseline et aux validations | orchestrateur DEV natif / raisonneur / validation allowlist | Partiellement appelé : `projectInstructions` est conservé mais n'atteint ni raisonneur ni route HTTP canonique |
| Route `/api/dev/native/tasks` dans `server.js` | body contrôlé par `x-noon-request: 1`, sans persistance | transmet `constraints` et `validationCommands`, pas `projectInstructions` | `nativeDevB3Facade.runTask()` | Implémenté et appelé, mais incomplet pour les règles projet |
| `RepositoryPreflight` | découverte des chemins `AGENTS.md` remontant depuis les chemins autorisés | seulement `preflight.agentsFiles` (liste de chemins) | résultat/journal/revue ; aucun lecteur ni injecteur de contenu trouvé | Présent mais non câblé comme instructions |
| Profils dans `docs/agents/` et modèles dans `docs/tasks/` | documentation versionnée | aucun adaptateur vers l'orchestrateur | procédure humaine / Codex | Documenté seulement |
| DEV Workspace Agent (`workspace-agent-execution-loop.js`) | exécution et plan éphémères liés à une session terminal | tâche et commandes passées par le plan ; pas de champ de règles à trois portées | terminal contrôlé et politique opérationnelle | Implémenté et appelé, sans stockage ou résolution de règles DEV |

## Matrice des portées demandées

| Portée | Ce qui existe | Création / modification | Priorité et conflits | Preuve de consommation | Écart |
| --- | --- | --- | --- | --- | --- |
| Globale durable | Règles produit immuables ; préférences/mémoires privées génériques | règles : code livré ; préférences : API locale `/personal-intelligence/memories` avec états confirmés, temporaires ou bloqués | ordre uniquement défini pour les règles produit : sécurité 700, confidentialité 600, permissions 500, système 400, utilisateur permanent 300, mode 200, projet 100, préférence 0 | registre utilisé par `ContextBuilder` et `OperationalSecurityPolicy` | aucune règle DEV durable, éditable et explicitement appliquée aux contrats DEV ; les préférences privées ne deviennent pas une consigne DEV automatiquement |
| Projet | workspace/projet, liens de racines et métadonnées Focus ; champ éphémère `projectInstructions` dans le contrat | workspace via API locale ; aucune API ou table de règles projet DEV | aucune résolution de conflit entre une règle projet et les autres portées ; les règles produit de sécurité restent indépendantes | racines/projet actifs réellement utilisés pour autoriser et borner ; métadonnées utilisées dans le chat | une consigne telle que « pour ce projet, utilise telle commande » n'a ni stockage durable ni injection canonique vers DEV |
| Tâche ponctuelle | `objective`, `constraints`, `validationCommands`, limites et permissions du contrat | body de la tâche DEV approuvé par l'UI de confiance ; aucun stockage après le journal minimal | aucune grammaire de priorité ni conflit explicite ; restrictions structurelles et politiques restent dominantes | `constraints` transmis au raisonneur ; commandes validées et exécutées seulement si l'allowlist les accepte | la consigne textuelle est dépendante du raisonneur ; `projectInstructions` n'est pas transmis par la route canonique ; pas de règle structurée « ne pas créer de commit » |

## Contrats et protections observés

1. Les règles produit sont la seule source canonique de priorité. `resolveConflict()`
   classe les candidats statiques par poids. Il n'existe pas de fusion des
   instructions globale/projet/tâche pour le DEV natif.
2. Les contenus de code, documents, médias, résultats d'outils et pièces jointes
   sont explicitement traités comme des données non fiables dans les prompts
   serveur et DEV. `RepositoryPreflight` ne fait que découvrir les fichiers
   `AGENTS.md`; leur contenu n'est donc pas interprété automatiquement.
3. Les bornes DEV structurelles ne dépendent pas du texte : racines autorisées,
   chemins privés, permissions, itérations, durée et classification des commandes
   sont validés dans `createDevTaskContract`, `OperationalSecurityPolicy` et
   `dev-command-policy`. Les validations ne peuvent exécuter que l'allowlist,
   qui exclut notamment push, installation et commandes destructives.
4. Le contrat natif n'expose pas une opération de commit : le raisonneur ne peut
   proposer que `CREATE` ou `MODIFY` et des commandes de validation allowlistées.
   Cela réduit déjà le besoin opérationnel d'une interdiction ponctuelle de commit
   sur ce chemin, sans constituer un mécanisme général de règles de tâche pour le
   terminal Workspace.
5. Une préférence temporaire est persistée dans la mémoire personnelle avec une
   expiration ; elle n'est pas promue par le code observé en règle DEV. Une
   consigne transmise dans `constraints` reste éphémère, sauf si un autre flux de
   mémoire la persiste explicitement. Aucun tel pont DEV n'a été trouvé.
6. Les scopes de sécurité réellement appliqués au DEV sont le workspace et les
   racines autorisées. Le `profileScope` n'est pas un champ du contrat DEV natif,
   et les préférences privées ne sont pas exportées au raisonneur. Cela limite le
   risque de fuite de préférences personnelles dans une tâche, mais ne fournit pas
   de règles profil/projet DEV persistantes.

## Cas utilisateur vérifiés

| Besoin | État réel |
| --- | --- |
| « Regroupe les commandes compatibles pour limiter les allers-retours. » | Peut être posé comme `constraints` de la tâche et atteint le raisonneur. Aucune garantie déterministe ne contrôle l'ordonnancement ou le regroupement des commandes. |
| « Pour ce projet, utilise telle commande de test. » | Une `validationCommands` ponctuelle est réellement utilisée et bornée par l'allowlist. Il n'existe pas de stockage/résolution de cette commande par projet ; `projectInstructions` ne suffit pas car il n'est pas câblé par la route canonique. |
| « Pour cette tâche seulement, ne crée aucun commit. » | Le chemin natif structuré ne propose pas de commit, et l'allowlist de validation ne l'autorise pas. La consigne n'est toutefois pas un interdit structuré transmis aux autres surfaces DEV (notamment Workspace Terminal). |

## Preuves et tests

- Inspection statique : `dev-task-contract.js`, `repository-preflight.js`,
  `workspace-engine.js`, `native-dev-reasoner.js`, `native-dev-orchestrator*.js`,
  `workspace-agent-execution-loop.js`, `dev-command-policy.js`,
  `hard-rules-registry.js`, `operational-profile.js` et les routes `server.js`.
- Exécuté le 2026-10-02, avec fixtures temporaires :
  `node --test test/native-dev-core.test.js test/native-dev-orchestrator.test.js test/workspace-engine.test.js test/dev-specialist-delegation.test.js`.
  Résultat : 46 tests réussis, 1 échec hors périmètre. `workspace-engine.test.js`
  attend `SCHEMA_VERSION === 16`, alors que le schéma courant vaut 18. Les tests
  qui précèdent confirment notamment les racines autorisées, l'allowlist de
  commandes et la séparation des modifications préexistantes ; ils ne démontrent
  pas une résolution de règles DEV à trois portées.
- Aucun benchmark, accès réseau, Electron réel ni donnée personnelle n'a été
  utilisé. La suite ci-dessus comporte des fixtures unitaires nommées B17, mais
  aucune commande de benchmark n'a été lancée.

## Écarts démontrés et prochaine correction minimale

Le contrat de décision V1 et le périmètre de la première tranche Terra sont
formalisés dans [DEV_RULES_V1_CONTRACT.md](DEV_RULES_V1_CONTRACT.md).

Le premier écart concret est le chaînage incomplet des règles de projet :
`projectInstructions` est accepté par `createDevTaskContract()` mais absent de la
route `/api/dev/native/tasks` et du payload de `createNativeDevReasoner().reason()`.
Il n'existe donc pas de producteur persistant ou de consommateur effectif pour une
instruction de projet DEV.

Correction réalisée : le dépôt versionné `dev_project_rules`, le résolveur pur,
la projection route native → contrat → Terra et la commande IPC bornée sont en
place. La mutation ne possède aucune route HTTP : le main appelle la commande
interne du serveur composé dans le même processus, sans transporter
`localAuthSecret` ni token d'action. SQLite conditionne atomiquement la mutation
sur ruleId, projet, propriétaire et version ; le fallback JSON refuse les
mutations car son renommage ne garantit pas ce contrôle entre processus. Le
client ne peut pas substituer `projectInstructions`; la route résout un projet
unique et le profil propriétaire depuis `WorkspaceEngine`.

Preuves ciblées exécutées après correction : `node --test
test/dev-project-rules.test.js test/production-hardening.test.js
test/native-dev-core.test.js` (35 réussites). Elles couvrent l'isolation
projet/propriétaire, les bornes/version obsolète, les mutations étrangères sans
effet, le fallback JSON explicitement refusé, la suppression de la route HTTP,
la préservation d'une restriction ponctuelle et le refus privacy du vrai
executor avant réservation ou appel provider. Le registrar IPC générique prouve
que le sender non autorisé n'atteint pas le handler ; aucun Electron réel ni UI
n'a été exécuté. Le test historique `workspace-engine` à schéma 16/18 reste
séparé.

## Parcours UI V1 effectivement disponible

Dans le panneau **DEV Workspace**, le bouton **Règles** ouvre la gestion du
projet résolu par la session terminal courante. L'UI lit les règles via une IPC
bornée distincte : le renderer fournit le `workspaceId` et l'identifiant du
projet relu comme contrainte anti-changement ; main/service déterminent le
projet unique et `profileScope`, puis refusent toute discordance. La liste inclut
les règles actives et désactivées, avec la mention « ce projet » et le rappel
qu'elles n'accordent aucune permission d'exécution.

La création et la modification restent des brouillons jusqu'au bouton explicite
et à sa confirmation, qui récapitule le projet et le texte. La désactivation ne
supprime pas ; la suppression a sa confirmation explicite. Annuler réinitialise
le brouillon sans IPC de mutation. Une mutation transporte toujours la version
attendue ; un refus de version demande une relecture, sans retry ni écrasement.
Un changement de Focus/session pendant une opération invalide le résultat UI,
et une résolution main différente de la cible confirmée refuse l'écriture. Le
fallback JSON reste lisible en lecture seule ; une lecture IPC indisponible est
signalée sans inventer une liste vide.

Preuves ciblées : `test/dev-project-rules-ui.test.js` simule le renderer et le
pont IPC pour lecture, aperçu, actions confirmées, annulation, version obsolète,
changement de projet, fallback et rendu du texte hostile sans HTML. La preuve
reste une fixture DOM/IPC : Electron réel et application packagée ne sont pas
exécutés dans cette tranche.
