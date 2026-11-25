# Journal des décisions

Règle 3 de `docs/ROADMAP.md` : toute exception à l'ordre des lots, et toute décision
structurante, est notée ici avec sa date et sa raison.

## 22/11/2026 — Adoption de la Roadmap V3 « Compagnon »

- `docs/ROADMAP.md` remplace la Roadmap Master V2.1, conservée comme archive des idées.
- Démarrage du lot V3-L0 (audit, lint réel, inventaire des services). État mesuré dans
  `docs/CURRENT_STATE.md`.

## 22/11/2026 — Compagnon iPhone gelé (P15)

- Les tranches IP-1 à IP-3 (côté Mac) ont été développées les 21 et 22/11, avant l'adoption de
  la V3 : passerelle LAN, vecteurs d'interopérabilité, section « Compagnon iPhone » du Control
  Center. Tout reste derrière le flag `remote.lan`, OFF par défaut. Rien n'écoute sur le
  réseau sans action explicite.
- Arrêt décidé par Arnaud le 22/11. Le code est conservé ; aucune nouvelle tranche (IP-4,
  app iOS) avant le critère de dégel de la roadmap : L2 et L3 utilisés chaque jour, en
  commençant par un simple canal de capture vers le Mac.
- Design de référence : `docs/IPHONE_COMPANION_V1_DESIGN.md`.

## 22/11/2026 — Gel des raffinements du cycle de vie des réservations (A.2)

- 4C-2 (`1d8e1bb`) et B3 (`316bae1`) sont commités et testés ; les correctifs B4a-B4c issus de
  l'essai du 21/11 aussi.
- On ne retouche plus la plomberie des réservations, du budget et des approbations du Goal
  Mode DEV, sauf si un usage réel révèle une faille.

## 22/11/2026 — Règles du lint (A.3)

- ESLint `recommended` + `no-undef`, `no-unused-vars`, `eqeqeq` ; zéro erreur exigée dans
  `npm run lint`.
- Exceptions assumées : paramètres non utilisés tolérés (signatures d'options des services),
  `catch {}` vide autorisé, `no-control-regex` désactivé (nettoyeurs d'entrées).
- `no-floating-promises` reporté à A.4 (nécessite les informations de types).

## 22/11/2026 — Nettoyage validé par Arnaud

- Suppression des dix fichiers morts listés dans `docs/CURRENT_STATE.md` §5.
- Scénario d'évaluation `voice.identity` aligné sur Cedar, voix canonique.

## 22/11/2026 — Charte de caractère activée par défaut (V3-L1)

- Les dix articles, les garde-fous du §5 et les cinq cadrans (`services/character/`) s'ajoutent
  à la personnalité de base pour le chat et la voix Live. Flag `character.charter` ON ; le
  passer à OFF rétablit la personnalité de base seule.
- Cadrans réglés dans les réglages rapides (section « Caractère »), stockés localement dans
  `character-preferences.json` (aucun secret). Défauts de la roadmap : franchise 4,
  challenge 3, initiative 3, proactivité 3, zone de confort 3.
- Critère de sortie de L1 : `npm run eval:character -- --run` (payant, ~0,24 USD sur
  gpt-5.6-terra), puis notation par Arnaud (`-- --grade`) ; il faut ≥ 90 % sur 30 cas.

## 22/11/2026 — « Je dois faire X » sur le petit modèle (V3-L2c)

- Un seul appel à `gpt-5.6-luna` (`store: false`, 400 jetons de sortie au plus), avec la
  personnalité et la charte ; seule la tâche est envoyée, ni mémoire ni historique. Refusé en
  mode local uniquement. Réponse validée (une action, 2 à 5 minutes), sinon erreur affichée.
- « Enregistrer comme prochaine action » : prochaine action du projet du Focus (nom exact),
  sinon note dans la boîte de réception. Aucun projet deviné.

## 22/11/2026 — Mesure d'usage du Brief (V3-L2d)

- Journal local `brief-usage-log.json` : par jour (Europe/Paris), heure prévue, première
  génération réussie et son déclencheur (planifié ou manuel), échec éventuel, première ouverture
  du Brief du jour. Aucun contenu stocké ; conservation 120 jours.
- « À l'heure » = généré le jour même, au plus 15 minutes après l'heure prévue.
- Bilan : `GET /daily-brief/usage?days=14`. Il sert au critère de sortie de L2 (utilisé chaque jour
  pendant deux semaines). `opens` compte les chargements de la vue, pas des lectures distinctes.

## 22/11/2026 — Exécutant externe dans un worktree isolé (V3-L5a)

- Lot suivant choisi par Arnaud : L5 (DEV par délégation), L3 restant bloqué par les critères de L1
  et de L2.
- `services/delegation/executor-worktree.js` : l'exécutant (Codex CLI) travaille dans un worktree
  Git détaché créé depuis HEAD, hors de tout dépôt (`~/.noon-dev/executor-worktrees` en
  développement, dossier de données sinon). Aucune branche, aucun checkout dans le dossier de
  travail d'Arnaud ; `node_modules` cloné en APFS ; hooks Git désactivés. Le diff est conservé en
  patch, le worktree est supprimé (sauf `keepWorktree`).
- Le dossier d'origine est comparé avant et après (statut, HEAD, contenu des fichiers modifiés) :
  toute modification fait échouer la mission. Un commit de l'exécutant aussi.
- Les changements non commités d'Arnaud ne sont pas visibles de l'exécutant ; le résultat
  l'indique (`sourceUncommittedChanges`).
- Bac à sable des validations : un worktree n'est accepté que s'il appartient à une mission
  active ; l'autorisation est vérifiée sur le dépôt d'origine (`isolatedWorkspaceResolver`). Les
  dossiers autorisés d'Arnaud ne sont pas élargis.
- Module générique distinct du worktree SelfDev (lié au dépôt Noon) ; convergence prévue en D.5.

## 22/11/2026 — Claude Code comme second exécutant (V3-L5b)

- `services/delegation/claude-code-specialist-agent.js` : `claude -p`, sortie stream-json,
  `--permission-mode acceptEdits`, outils limités (lecture, édition, quelques commandes de
  validation) ; commit, push, réseau, installation et `rm` refusés ; environnement sans clés (seule
  la session Claude Code déjà ouverte sur le Mac sert). Absent du Mac au 22/11 : marqué indisponible.
- Choix de l'exécutant par mission (`executor`: `codex-cli` par défaut, ou `claude-code`). Un
  exécutant demandé mais absent fait échouer la mission : aucune bascule silencieuse vers l'autre.

## 22/11/2026 — Missions DEV encadrées par deux approbations (V3-L5c)

- Flag `dev.missions` (OFF par défaut, OFF/LIMITED), distinct de `delegation.engine` qui gouverne la
  délégation d'analyse du chat. Routes `/api/dev-missions` (en-tête `x-noon-request` obligatoire).
- Proposer une mission exige que le dépôt soit une racine en écriture de l'espace de travail.
- Approbation 1, lancement : liée à l'objectif, aux chemins, à l'exécutant et au commit de base ;
  refusée si le dépôt a changé de commit entre-temps.
- Approbation 2, application : liée au SHA-256 exact du patch ; seulement pour une mission PASS ;
  refusée si un fichier du patch est modifié localement ou si le patch ne s'applique plus.
  Application par `git apply` simple : ni index, ni commit, ni push.
- Moteur d'approbation V2 réutilisé (usage unique, expiration 5 min, annulé au redémarrage).
  Ces approbations sont exclues des routes génériques, comme celles du Goal Mode DEV.
- Les missions sont gardées en mémoire : un redémarrage les perd (les approbations le sont déjà).

## 22/11/2026 — Panneau « Missions DEV » (V3-L5d)

- Section du Control Center visible seulement avec `dev.missions` actif. Dépôts proposés : racines
  Git en écriture des espaces de travail (la proposition revérifie l'autorisation).
- Le diff se relit dans le panneau avant l'approbation d'application (`GET …/patch`, texte brut,
  256 Ko affichés au plus). Appliquer demande une confirmation explicite.
- D.2 : chaque mission interdit `benchmark-workspaces/`, `dev-cost-ledger.json` et
  `dev-task-journal/` (fichiers de travail privés) ; y écrire fait échouer la mission.
- D.1 à D.4 cochés dans la roadmap ; D.4 est une règle (le moteur DEV natif n'est plus étendu).
- Un exécutant absent n'est pas sélectionnable. Critère de sortie de L5 : 10 missions réelles
  réussies, lancées par Arnaud.

## 22/11/2026 — « Santé de Noon » (V3-L6, G.1 + G.2 + G.6, première tranche)

- Lot suivant choisi par Arnaud : L6. Pas de nouveau système de mesure : le bilan agrège les traces
  existantes (`noon-observability.jsonl`, 30 jours), le coût mensuel de `usage.json` et le journal
  du Brief. Route `GET /api/noon-health?days=7|14|30`, section du Control Center sans flag
  (lecture seule, locale).
- Coût par jour : à chaque enregistrement de `usage.json`, la hausse du coût estimé est ajoutée au
  jour (Europe/Paris), toutes catégories ; `dailyCostSince` marque le début de la mesure (les jours
  d'avant sont « non mesurés », pas 0 $). Remise à zéro mensuelle comme les compteurs.
- Budgets G.2 affichés : réponse texte < 2 s (médiane), premier son Live < 1 s, coût du jour
  ≤ budget mensuel / 30 (`NOON_DAILY_COST_CAP_USD` pour changer). Plafond affiché, non bloquant :
  le rendre bloquant toucherait au routage et au budget, à décider à part.
- Non mesuré, et affiché comme tel : taux de correction par Arnaud ; justesse et calibration (B3).
- Constat : le profil réel n'a que 3 traces depuis le 20/11 (4 requêtes en novembre) ; les chiffres
  se rempliront à l'usage.

## 22/11/2026 — Cache de prompt (V3-L6, G.3)

- Le préfixe des messages du chat est déjà stable : personnalité puis charte (~1 300 tokens avec la
  charte, au-dessus du seuil de 1 024 du cache automatique d'OpenAI), puis règles permanentes ; le
  contexte variable vient après. Aucun réordonnancement nécessaire.
- Ajout de `prompt_cache_key` (`noon:<canal>`, aucune donnée privée) sur les appels OpenAI de
  l'orchestrateur ; si un modèle refuse le paramètre, l'appel repart sans lui (repli tracé, comme
  pour la compaction). Pas de `prompt_cache_retention` étendue : elle changerait le comportement de
  coût, à décider à part.
- « Santé de Noon » affiche la part des tokens d'entrée servis depuis le cache (période et mois).
- Hors orchestrateur (Brief, première action, voix Live) : inchangé.

## 22/11/2026 — « Plus petit modèle capable » en ombre (V3-L6, G.4)

- Constat (simulation locale du routeur) : par défaut, presque tout part sur gpt-5.6-terra (profil
  équilibré) ; gpt-5.6-luna, 10 fois moins cher, ne sert qu'aux salutations et traductions courtes.
- Choix d'Arnaud : mesurer d'abord. Flag `router.small-first` (SHADOW par défaut, OFF/SHADOW
  seulement : aucune activation possible sans nouvelle décision). `smallFirstDecision` dit si luna
  aurait suffi pour une route par défaut, sinon pourquoi rester sur terra (complexité ≥ 2, contexte
  > 4 000 tokens, pièces jointes, plusieurs outils ou sources, réponse longue, document,
  conséquences, recherche web, qualité maximale demandée).
- La route active n'est jamais modifiée ; la décision va dans la trace (`routing.smallFirst`).
  « Santé de Noon » affiche la part d'échanges éligibles, l'économie estimée et les raisons.
- Prochaine étape, après quelques semaines de mesure : décider d'un mode actif, avec ses propres
  évaluations de qualité.

## 22/11/2026 — eval:life (V3-L6, G.5) et exclusion de `.noon-evals/` du packaging

- `npm run eval:life` : état et coût estimé sans appel ; `-- --add` ajoute un cas (demande réelle,
  bonne réponse, signaux d'échec, catégorie) ; `-- --run` rejoue (payant, `store: false`) ;
  `-- --grade` fait noter par Arnaud puis compare au passage précédent (régressions,
  améliorations) ; une note est reprise si la réponse est identique au caractère près.
- Seule la demande est envoyée, avec la personnalité et la charte (réglages d'Arnaud s'ils
  existent) : ni mémoire, ni historique, ni outils. Le test porte sur la réponse de base.
- Cas dans `.noon-evals/life/cases.json` (mode 0600), hors dépôt (`.gitignore`) et désormais hors
  de l'app packagée : `.noon-evals/` n'était pas exclu par `forge.config.js` (trou corrigé, il
  concernait aussi les passages d'eval:character).
- 30 à 50 cas, fournis par Arnaud ; pas de seuil de réussite fixé : l'indicateur est l'absence de
  régression d'un commit important à l'autre.

## 22/11/2026 — Découpe de `public/app.js` (V3-L7, A.5)

- `public/app.js` (11 718 lignes) devient onze morceaux par écran dans `public/app/` (609 à
  1 442 lignes). Coupures contiguës, aux limites d'instructions de premier niveau ; les marqueurs
  `*_START/_END` restent avec leur section.
- Le serveur recolle les morceaux dans l'ordre (`services/http/app-bundle.js`) et sert toujours un
  seul `/app.js`, identique octet pour octet à l'ancien fichier (vérifié). Raison : entre deux
  balises `<script>`, le navigateur peut traiter des événements ; une fonction asynchrone lancée par
  un morceau pourrait reprendre avant le chargement des suivants. Un seul script garde exactement
  le comportement d'avant. Analyse statique complémentaire (graphe d'appels au chargement) : aucune
  fonction appelée avant son morceau.
- Lint : les morceaux partagent une portée, ESLint les ignore un par un et lint le fichier recollé
  (`scripts/lint-app-bundle.js`, erreurs ramenées au morceau et à la ligne, plafond 1 500 lignes).
- Tests : `test/helpers/app-source.js` reconstitue le texte complet ; 26 tests y lisent l'interface.
- Reste pour le critère de sortie de L7 : `server.js` (≈ 10 900 lignes) et la fusion mémoire (A.6).

## 22/11/2026 — Écritures mémoire derrière MemoryEngine (V3-L7, A.6)

- La lecture était déjà unifiée. `MemoryEngine` porte maintenant aussi les écritures
  (`services/memory/memory-writes.js`) : créer, corriger, confirmer, oublier, bloquer, purger,
  pour la mémoire privée chiffrée comme pour la mémoire structurée.
- Choix : une interface unique, pas de fusion des stockages. Chaque action délègue au service
  existant avec exactement le même comportement ; aucune donnée n'est déplacée ni migrée. La
  migration vers la mémoire privée canonique reste celle de `MEMORY_MIGRATION.md`.
- Une seule invalidation des caches (contexte, recherche, synthèse) : le `onChange` de
  `MemoryEngine`. Les commandes conversationnelles, l'import et la mémoire automatique la
  déclenchent via `notifyChanged`. Avant, elle était recopiée à cinq endroits de `server.js`.
- Routes `/private-memory` et `/personal-intelligence/memories` sorties de `server.js`
  (`services/memory/memory-http-routes.js`), contrats inchangés (codes, corps, limites de taille).
- Reste hors de cette interface : les services de mémoire eux-mêmes (pipeline automatique,
  commandes conversationnelles, import, migration) appellent toujours leurs stockages en interne.
- Constat, non modifié : les POST mémoire n'exigent pas l'en-tête `x-noon-request` (l'interface
  ne l'envoie pas). À durcir dans une tranche dédiée, interface comprise.

## 22/11/2026 — Découpe de `server.js`, première tranche (V3-L7)

- `server.js` passe de 10 831 à 9 423 lignes. Sortis : les fichiers de l'interface (table exacte
  `services/http/static-assets.js`), les routes de l'intelligence personnelle
  (`services/personal-intelligence/personal-intelligence-http-routes.js`) et les routes DEV
  (`services/dev/dev-http-routes.js`, 1 166 lignes).
- Méthode : bloc de routes déplacé **tel quel**, pas réécrit. `scripts/extract-server-routes.js`
  analyse les portées (eslint-scope), liste les dépendances du bloc et refuse le déplacement si le
  bloc réassigne une variable du serveur, dépend d'une variable locale du gestionnaire autre que
  `req`/`res`/`requestPath`, ou déclare quelque chose utilisé après lui. Les dépendances sont passées
  par accesseurs, lus à chaque requête : l'ordre d'initialisation du démarrage ne change pas.
  Un module rend `NOT_HANDLED` si la requête ne le concerne pas ; l'ordre des routes est conservé.
- Seul changement de code hors déplacement : `requireTrustedDevUi` (pure) remonte du gestionnaire
  au niveau du module, car elle sert aussi avant le bloc DEV.
- Vérification avant/après sur serveur isolé (copie `git worktree` de HEAD contre le dossier de
  travail) : 20 fichiers statiques octet pour octet, 18 requêtes intelligence personnelle et 50
  requêtes DEV (avec et sans en-tête de confiance) — mêmes codes, en-têtes et corps, aux
  horodatages, identifiants aléatoires et durées près.
- Tests de câblage : `test/helpers/server-source.js` lit `server.js` puis les modules de routes
  (liste `ROUTE_MODULES` à compléter à chaque nouvelle tranche).
- Limite assumée : un module déplacé tel quel garde la forme d'origine (chaîne de `if`). Le
  regroupement par domaine et les dépendances explicites sont le gain ; la réécriture interne
  viendra, si besoin, route par route avec ses tests.

## 22/11/2026 — Découpe de `server.js`, deuxième tranche (V3-L7)

- `server.js` passe de 9 423 à 7 589 lignes. Sept modules de routes, même méthode :
  `services/workspaces/projects-http-routes.js` (projets, catalogue Focus),
  `services/sessions/conversation-http-routes.js` (conversations, dossiers, historique, activité,
  réinitialisation), `services/voice/voice-http-routes.js` (Realtime, identité vocale, TTS),
  `services/voice/transcription-http-routes.js`, `services/control-center/system-http-routes.js`
  (santé, diagnostics, reprise de session, Control Center, runtime, extensions, contexte ambiant),
  `services/goals/goals-http-routes.js` (objectifs, reprise Goal Mode DEV, décision) et
  `services/planning/day-http-routes.js` (brief, caractère, planning, suivi, revues, intégrations
  Google).
- Valeur périmée : un accesseur lu au début de la requête garderait l'ancienne valeur d'une
  variable `let` réaffectée pendant que la requête attend son corps. L'outil refuse désormais
  toute variable `let` réaffectée tant qu'elle n'est pas déclarée : `live` (chaque usage devient
  `deps.x`, lu au moment de l'usage, comme avant) ou `startupOnly` (affectée une seule fois au
  démarrage). Vérifié pour la tranche 1 : ses quatre `let` sont toutes affectées une fois au
  démarrage.
- Seul changement de code hors déplacement : les quatre écritures de l'index des conversations
  passent par `replaceConversationIndex(store)` (affectation puis sauvegarde, comme avant), et
  `conversationIndex` est lu en direct dans le module.
- Outil : contrôle `this`/`arguments` sur l'arbre syntaxique (le contrôle textuel bloquait sur
  `body.arguments`).
- Vérification avant/après : 74 requêtes couvrant les sept modules (dont refus sans en-tête de
  confiance) — mêmes codes et en-têtes, mêmes corps aux horodatages, identifiants aléatoires et
  durées près. Le seul autre écart (`/integrations/status`) venait du `.env` local absent de la
  copie de référence ; disparu en rejouant la référence avec ce même `.env`.

## 22/11/2026 — Figma MCP et reconnexion Google depuis le Control Center

- Figma en ligne (`mcp.figma.com`) : Figma n'y accepte que les clients de son catalogue MCP (VS
  Code, Cursor, Claude Code, Codex…) ; Noon n'y figure pas. L'entrée du catalogue porte
  `unavailable` (`MCP_CLIENT_NOT_ACCEPTED`) : refus immédiat, sans appel, raison affichée, ni
  « Installer » ni « Connecter ». L'écriture dans Figma n'existe que sur ce serveur : Noon ne peut
  donc que lire, via l'application de bureau. Pistes non engagées : liste d'attente du catalogue
  Figma, ou écriture déléguée à un client du catalogue (Claude Code / Codex) sous approbation.
- Figma bureau : port 3845 fermé → `MCP_LOCAL_SERVER_UNREACHABLE` avec la marche à suivre (Dev
  Mode, « Enable desktop MCP server », siège Dev ou Full) au lieu de « TypeError ».
- Google : « Tester » ne proposait l'autorisation que sans jeton ; un jeton refusé par Google
  (expiré ou révoqué) laissait la carte en UNAUTHORIZED sans issue, la carte « Intégrations » qui
  porte « Reconnecter » étant masquée par la CSS (`.operations-panel{display:none!important}`).
  `services/control-center/connection-check-action.js` propose désormais la reconnexion dans ce
  cas aussi ; le bouton s'appelle « Reconnecter » sur une connexion refusée. Le renouvellement
  raté journalise le code OAuth de Google (`google-oauth.refresh-failed`, ex. `invalid_grant`),
  jamais de jeton. Cause probable d'expiration répétée : application OAuth Google en mode
  « Testing », dont les jetons de renouvellement expirent après 7 jours.

## 23/11/2026 — Compte-rendu vrai de la mémorisation automatique

- La mémorisation automatique tourne après la réponse du modèle, qui ne la voit pas : Noon
  pouvait répondre « je ne peux pas enregistrer » puis ajouter « J'ai conservé… ». La phrase
  générique est remplacée par un compte-rendu factuel, explicitement attribué à la mémorisation
  automatique : nombre d'éléments, nouveaux / mis à jour, destination (générale, privée locale,
  projet) et catégories — jamais le contenu des souvenirs.
- « Qu'as-tu retenu de ce fichier ? » (ou « à l'instant », « tout à l'heure », « dans cette
  conversation ») relit ce dernier compte-rendu, sans rien écrire ; « qu'as-tu retenu » garde
  l'inventaire complet.
- Non traité (choix de l'utilisateur, point A écarté pour l'instant) : un document peut toujours
  créer des souvenirs confirmés sans validation, catégories sensibles comprises.
- Repéré, non corrigé : « oublie ça » supprime les identifiants de la dernière mémorisation,
  qui incluent aussi des souvenirs existants mis à jour ou ignorés comme doublons.

## 23/11/2026 — Plugin Figma « Noon Bridge », tranche 1 (dégel partiel de P12)

- Dégel décidé par l'utilisateur (« lance le plugin Noon figma ») : il veut que Noon lise **et
  écrive** dans Figma Desktop comme Claude ou ChatGPT. Siège Full, compte Pro. Le reste de P12
  (Creative Studio) reste gelé. Interrompt L7 (découpe de `server.js`) le temps de ce chantier.
- Pourquoi un plugin : Figma réserve son serveur MCP en ligne (seul à écrire) aux clients de son
  catalogue, et le serveur de l'application de bureau est en lecture seule. Un plugin de
  développement importé par l'utilisateur a, lui, accès au fichier ouvert (API Plugin Figma).
- Architecture : `figma-plugin/noon-bridge/` (manifeste, `code.js` fil principal avec liste
  blanche de commandes, `ui.html` qui parle à Noon) ⇄ `services/figma-bridge/figma-bridge.js`,
  serveur HTTP sur 127.0.0.1:3856 (attente longue, sans dépendance nouvelle), flag
  `figma.bridge` OFF. Démarré seulement à la génération d'un code, ou au démarrage si déjà jumelé.
- Sécurité : code de jumelage à 6 chiffres affiché dans le Control Center, 5 minutes, usage
  unique, verrouillé après 5 essais ; jeton de 32 octets, seule son empreinte SHA-256 est
  stockée (`figma-bridge.json`) ; le plugin garde le jeton dans `figma.clientStorage` ; CORS `*`
  imposé par l'origine nulle de l'iframe Figma, compensé par le jeton ; dissociation = jeton
  révoqué. Plugin exclu de Noon.app (forge).
- Tranche 1 = lecture seule : `ping`, `get_selection`, `get_page`. Panneau « Figma » du Control
  Center : générer un code, état, test de lecture, dissocier.
- Vérifié : tests unitaires et de contrat ; bout en bout sur serveur Noon isolé avec un faux
  plugin (jumelage, pré-vol CORS, commande, résultat, refus sans jeton, jeton jamais en clair).
  Non vérifié : le vrai plugin dans Figma Desktop (import du manifeste, réseau de l'iframe vers
  127.0.0.1) — à faire par l'utilisateur.
- Suite : tranche 2 = outils Figma pour le modèle de Noon (lecture) ; tranche 3 = écriture
  (créer, modifier, styler) derrière une validation du plan de modifications.

## 23/11/2026 — Plugin Figma « Noon Bridge », tranches 2 et 3 (lecture par le modèle, écriture validée)

- Manifeste : Figma refuse une IP dans `devAllowedDomains` → `http://localhost:3856` seul ; la
  passerelle écoute 127.0.0.1 et, au mieux, ::1 (localhost peut viser IPv6 sous macOS). Le plugin
  ne tourne pas en Dev Mode (`editorType` « figma » seul : Dev Mode n'autorise pas l'écriture).
- Tranche 2 : outils du modèle `ext_figma_get_selection`, `get_page`, `get_node` (profondeur 1–3 :
  couleurs, typographie, mise en page), `get_design_tokens` (styles et variables locaux), niveau
  READ, enregistrés seulement si `figma.bridge` est actif au démarrage. Résultats marqués comme
  données non fiables. Consigne Figma ajoutée aux instructions du modèle.
- Tranche 3 : `ext_figma_apply_changes`, niveau EXTERNAL → ordre explicite puis approbation exacte
  (ApprovalManager / « Confirmer exactement » dans le chat) avant toute écriture. Plan de 1 à 100
  opérations : `create_frame`, `create_rectangle`, `create_text`, `update_node` ; références
  `ref:` pour imbriquer ; validation stricte avant envoi (champs connus, bornes, couleurs
  #RRGGBB, références définies avant usage). Aucune suppression. La passerelle refuse
  `apply_changes` sans `authorizedWrite`, que seul l'outil passe après confirmation. Le plugin
  applique le plan d'un bloc (`commitUndo` : un Cmd+Z), sélectionne le résultat, et signale un
  échec partiel (opérations appliquées + première en échec). Résumé d'approbation lisible.
- `DRY_RUN_EXTERNAL_WRITES` n'est lu nulle part dans le code (documentation seulement) : la
  garde réelle des écritures Figma est l'approbation exacte.
- Vérifié : tests unitaires (validation, niveaux, autorisation, exécution du plan sur une fausse
  API Figma, résumé d'approbation), `npm test` complet. Non vérifié : dans Figma Desktop réel et
  dans le flux d'approbation complet du chat avec le modèle (appels payants).

## 23/11/2026 — Découpe de `server.js`, troisième tranche (V3-L7, reprise après Figma)

- Reprise de L7 une fois le plugin Figma livré (tranches 1–3). L3 et L4 restent bloqués par les
  critères de sortie de L1 (notation `eval:character`) et de L2 (deux semaines d'usage).
- `server.js` passe de 7 619 à 7 091 lignes. Huit modules de routes, même méthode (bloc déplacé
  tel quel, dépendances par accesseurs) : `services/workspaces/workspace-http-routes.js`
  (espaces de travail, `/intents/parse`), `services/search/local-files-http-routes.js`
  (`/browse`, `/search`, `/read`, `/ask`), `services/models/budget-http-routes.js` (`/budget`),
  `services/capture/capture-http-routes.js` (capture rapide, `/resume`, `/first-step`),
  `services/jobs/jobs-http-routes.js` (`/jobs`, `/background-analyses`),
  `services/memory/legacy-memory-http-routes.js` (adaptateur `/memory`),
  `services/daily-brief/brief-http-routes.js` (planification et génération du Brief) et
  `services/approvals/approvals-http-routes.js` (approbations génériques, reprise de
  l'orchestrateur).
- Outil : `scripts/extract-server-routes.js` refuse désormais un bloc qui utilise `__dirname`,
  `__filename`, `require`, `module` ou `exports` (leur sens changerait une fois déplacé). Il a
  bloqué la fenêtre de capture, qui lisait `path.join(__dirname, "public", …)` : seul changement
  de code hors déplacement, la constante `PUBLIC_DIRECTORY` (même chemin, partagée avec
  `staticAssets`).
- `workspaceEngine` (`let`) déclaré `startupOnly` : affecté une seule fois au chargement du module.
- Vérification avant/après sur serveur isolé (copie `git worktree` de HEAD contre le dossier de
  travail) : 57 requêtes couvrant les huit modules, avec et sans en-tête `X-Noon-Request` —
  en-têtes identiques, corps identiques aux horodatages et empreintes d'entrée près. Le seul autre
  écart (Brief sans Rappels dans la référence) venait du binaire natif `resources/native/`
  (ignoré par Git) absent de la copie ; disparu une fois ce binaire fourni à la référence.
  Non rejoué : `GET /workspaces` et `/search?q=` parcourent les dossiers autorisés du Mac et
  restent bloqués sous un serveur lancé hors de l'app (accès macOS) ; leur code est déplacé tel
  quel et couvert par les tests de câblage.
- Reste dans `server.js` : la route `/ai` (≈ 450 lignes, la plus risquée), quelques petites
  routes (`/api/config/status`, `/api/features`, `/api/lifecycle/status`) et ≈ 6 000 lignes de
  fonctions et d'état hors gestionnaire HTTP. L'objectif « aucun fichier > 1 500 lignes » exige
  donc de sortir aussi ces fonctions, par domaine, dans les prochaines tranches.

## 23/11/2026 — Découpe de `server.js`, quatrième tranche : fin des routes (V3-L7)

- `server.js` passe de 7 091 à 6 680 lignes ; le gestionnaire HTTP ne garde que l'authentification
  locale, le garde de validation UI, `/` et la suite ordonnée des modules (≈ 170 lignes).
- Trois modules, même méthode : `services/orchestration/ai-http-routes.js` (`POST /ai` et
  `/ai/stream`, 449 lignes, 32 dépendances, `workspaceEngine` en `startupOnly`),
  `services/config/config-status-http-routes.js` (`/api/config/status`) et
  `services/runtime/runtime-status-http-routes.js` (`/api/features`, `/api/lifecycle/status`).
  Deux modules distincts pour les routes d'état afin de garder leur place de part et d'autre des
  routes DEV, sans réordonner.
- `test/chat-progress-stream.test.js` lit désormais `readServerSource()` (vérifications inchangées).
- Avant/après sur serveur isolé (HEAD contre dossier de travail, sans clé OpenAI) : 21 requêtes
  (`/ai` corps vide, invalide, focus, hors ligne, pièce jointe invalide, commande mémoire,
  `/ai/stream`, `/ai/autre`, `GET /ai`, routes d'état, route inconnue) — en-têtes identiques,
  corps identiques aux identifiants d'exécution, de session, d'intention et horodatages près.
  Non rejoué : une réponse réelle du modèle (aucune clé dans le serveur isolé).
- Reste pour l'objectif « aucun fichier > 1 500 lignes » : ≈ 6 500 lignes de fonctions et d'état
  hors gestionnaire dans `server.js`, à sortir par domaine.

## 23/11/2026 — Découpe de `server.js`, cinquième tranche : `askAI` (V3-L7)

- `askAI` (1 650 lignes, un quart du fichier) sort dans `services/orchestration/ask-ai.js` ;
  `server.js` passe de 6 680 à 5 092 lignes.
- Nouvel outil `scripts/extract-server-function.js`, pendant de l'outil des routes pour les
  fonctions de premier niveau : la déclaration est recopiée telle quelle dans une enveloppe qui lit
  ses 59 dépendances par accesseurs à chaque appel ; `server.js` garde `const askAI = createAskAI(…)`
  à l'emplacement d'origine. Mêmes refus que l'outil des routes, plus : fonction auxiliaire utilisée
  ailleurs, usage pendant le chargement du module (zone morte du `const`). Contrôle : les deux
  versions de la fonction ont les mêmes 9 319 jetons (contenu des gabarits compris).
- `personalSearchEngine`, `multiSourceSynthesisEngine`, `multimodalEngine` et `workspaceEngine`
  déclarés `startupOnly` (une seule affectation, au chargement).
- `test/figma-skills.test.js` lit `readServerSource()`. Les 15 tests qui lisent encore `server.js`
  seul et contiennent des assertions d'absence ont été rejoués contre la source complète
  (server.js + modules extraits) : 141/141, aucune assertion contournée par les tranches 1 à 5.
- Avant/après avec un faux serveur Responses local (`OPENAI_BASE_URL` sur 127.0.0.1, clé de test
  factice, aucune sortie réseau) : 9 requêtes `/ai` (simple, focus, flux, appel d'outil, agenda,
  recherche web, profil approfondi, hors ligne, session) et les 10 requêtes envoyées au modèle
  journalisées. Réponses et requêtes modèle identiques aux identifiants, horodatages et durées près.
  Seul écart : `TARGET_OUT_OF_SCOPE` en plus côté référence pour `list_directory(".")`, dû au
  dossier courant différent (copie sous `/private/tmp`) ; disparu avec un chemin absolu commun.
- Reste ≈ 5 000 lignes : routage de modèles, OAuth Google, suivi d'usage, fichiers locaux, focus,
  mémoire de conversation, démarrage. Prochaine étape : les sortir par domaine avec le même outil.

## 23/11/2026 — Découpe de `server.js`, sixième tranche : suivi d'usage et budgets (V3-L7)

- 19 fonctions (recherche web, voix, modèles, transcription, images, budgets) et leur état
  (`webSearchUsage`, compteur quotidien) sortent dans `services/models/usage-tracking.js` ;
  `server.js` passe de 5 092 à 4 703 lignes. Dix fonctions exportées, neuf privées.
- Nouvel outil `scripts/extract-server-domain.js` pour un domaine (plusieurs fonctions + état
  qu'elles sont seules à utiliser) : fonctions créées une fois ; une `const` déjà déclarée à la
  construction est lue une fois, une `const` déclarée plus loin ou un `let` est lu à chaque usage
  (référence réécrite en `deps.nom`, accesseur — même zone morte qu'avant). Refuse aussi un état ou
  une fonction privée utilisés hors du domaine et une exportée passée au chargement avant la
  construction : il a bloqué le premier essai (`trackUsage` passée à deux services lignes 1548 et
  1599). Construction donc placée avant `createOpenAIMediaAnalyzer` ; seule `metricsService`
  (déclarée plus loin) est lue à chaque usage. Contrôle : 2 253 jetons identiques une fois retirés
  les 5 préfixes `deps.`.
- Effet de bord unique : le compteur de recherche web est lu au chargement ligne 1545 au lieu de
  2716, dans la même évaluation synchrone ; rien entre les deux ne touche `web-search-usage.json`
  (la migration des anciens fichiers se fait dans Electron, avant le chargement du serveur).
- Avant/après (faux serveur Responses local) : `/budget`, `/realtime/budget`, 3 × `/ai`,
  3 × `/realtime/usage` (dont doublon et requête sans en-tête), vue d'ensemble du centre de
  contrôle, `/api/noon-health`, diagnostics de session — fichiers `usage.json`,
  `voice-usage.json`, `web-search-usage.json` identiques, réponses identiques aux horodatages et
  latences près. Écart Gmail/Agenda `NOT_CONFIGURED` → `AUTH_REQUIRED` : dû au `.env` local
  (client OAuth Google) absent de la copie de référence ; identique une fois ce `.env` fourni.
  Les 15 tests à assertions d'absence rejoués contre la source complète : 141/141.

## 23/11/2026 — Découpe de `server.js`, septième tranche : fichiers locaux, projets et Focus (V3-L7)

- 18 fonctions (registre des projets, scan, `listDirectory`, `isPathAllowed`, `searchFiles`,
  `readAllowedFile`, normalisation et résolution du Focus, `handleLocalCommand`…) et leur état
  (`projectsRegistry`, `ALLOWED_NOON_MODES`) sortent dans `services/context/local-projects.js`
  avec `scripts/extract-server-domain.js` ; `server.js` passe de 4 703 à 4 120 lignes. Seize
  fonctions exportées ; `loadProjectsRegistry` et `saveProjectsRegistry` restent privées.
- Construction à l'emplacement de `projectsRegistry` (chargé au même moment qu'avant) ; seule
  `workspaceEngine` (`let` affecté au démarrage) est lue à chaque usage. `uiValidationProjectContexts`
  reste dans `server.js` (affecté et lu hors du domaine). Contrôle : 2 842 jetons identiques une
  fois retirés les préfixes `deps.`.
- Avant/après sur serveurs isolés : `/projects`, `/projects/catalog`, `/focus/catalog`,
  2 × `/projects/scan`, 2 × `/projects/resolve`, `/projects/:id`, `/browse` (autorisé, refusé,
  exclu), `/search`, `/read` (autorisé, refusé), 3 × `/ask` (commandes locales), `/workspaces`,
  `/intents/parse` — réponses et `projects-registry.json` identiques aux horodatages et
  identifiants aléatoires près ; idem en mode UI Validation (espaces synthétiques créés pareil).
  Tests à assertions d'absence rejoués contre la source complète : 245/245.

## 23/11/2026 — Découpe de `server.js`, huitième tranche : historique et index des conversations (V3-L7)

- 16 fonctions (chargement/sauvegarde de l'historique, des résumés et de l'index,
  `rememberConversation`, `getConversationHistory`, `clearConversationSession`…) et leur état
  (`conversationSessions`, `conversationSummaries`, `conversationSummaryCheckpoints`,
  `conversationIndex`, plafonds d'historique) sortent dans `services/sessions/conversation-store.js` ;
  `server.js` passe de 4 120 à 3 863 lignes.
- Seul ajout de code : `conversationIndex` est un `let` réaffecté à chaque mise à jour et lu par
  trois fermetures hors du domaine ; elles passent par un accesseur `getConversationIndex()`
  (ajouté dans `server.js` puis déplacé avec le domaine). Le module de routes des conversations
  reçoit `getConversationIndex` au lieu de lire `deps.conversationIndex` — même lecture à chaque
  requête. L'outil accepte désormais d'exporter un état `const` (même objet des deux côtés :
  la `Map` `conversationSummaries`) et refuse d'exporter un `let`.
- Contrôle : 1 372 jetons identiques une fois retirés les préfixes `deps.`. Le test d'ordre
  UI Validation cherchait la déclaration de l'index dans `server.js` : il vérifie maintenant que le
  module charge l'index à sa construction et que cette construction précède l'initialisation des
  espaces synthétiques (même exigence).
- Avant/après (faux serveur Responses local) : 2 × `/ai` et `/ai/stream` avec historique,
  `/session/history`, `/session/activity`, `/session/clear`, `/conversation/reset`, liste, création,
  modification et suppression de conversations, création de dossier — réponses, requêtes envoyées au
  modèle (historique compris), `conversation-memory.json` et `conversation-summaries.json`
  identiques ; `conversation-index.json` identique aux horodatages et identifiants aléatoires près.
  Tests à assertions d'absence rejoués contre la source complète : 245/245.

## 23/11/2026 — Découpe de `server.js`, neuvième tranche : OAuth Google et recherche Gmail (V3-L7)

- L'OAuth Google en lecture seule sort dans `services/connectors/google-account.js`
  (`createGoogleAccount`). Il comprend :
  - la boucle locale éphémère et la page de retour ;
  - l'échange du code, la vérification du profil et le renouvellement du jeton, partagé entre
    appels simultanés.

  La recherche Gmail autorisée l'accompagne (décodage, normalisation des messages,
  `searchAuthorizedGmail`). Au total, 11 fonctions et leur état ; `server.js` passe de 3 863 à
  3 613 lignes.
- Aucun ajout de code. `gmailConnector` et `calendarConnector` ont besoin de
  `getGoogleAccessToken` pour être construits : ils restent lus par accesseur (`deps.`), comme
  `integrationTokenStore` et `localIntelligenceRuntime`, déclarés plus loin. Les identifiants OAuth
  restent lus dans `process.env` à chaque appel, comme avant.
- Contrôle : 1 984 jetons identiques une fois retirés les préfixes `deps.`. Trois tests de
  `connector-validation` lisaient `server.js` seul ; ils lisent maintenant `server.js` suivi des
  modules extraits. Leurs assertions sont inchangées, à deux détails près :
  - l'assertion sur les scopes accepte le préfixe `deps.` ;
  - la tranche de la page de retour se termine au helper Gmail qui la suit.

  Au passage, la tranche « routes `/integrations/status` » de ce test était vide depuis la
  sortie des routes (tranches 3-4), ce qui rendait vacues ses deux assertions d'absence. Elle
  couvre de nouveau la route.
- Avant/après, avec des identifiants OAuth factices et `fetch` bloqué (aucune tentative
  d'appel sortant n'a eu lieu), 15 requêtes ont donné des réponses identiques :
  - `/integrations/status`, deux fois ;
  - la santé Gmail et Calendar sans jeton ;
  - les callbacks à état inconnu ;
  - la connexion, avec une URL d'autorisation de même forme (scopes lecture seule, PKCE
    `S256`, retour sur `127.0.0.1`) ;
  - sur la boucle locale : un 404, un mauvais état, un refus, puis la fermeture de la boucle ;
  - le rejeu de l'état consommé et la déconnexion.

  Le journal d'audit contient les mêmes 73 entrées, `google-oauth.*` compris ; seules des
  latences en millisecondes diffèrent. Tests à assertions d'absence rejoués contre la source
  complète : 224/224, plus les 21 tests de `connector-validation`, qui lisent désormais la
  source complète.

## 23/11/2026 — Découpe de `server.js`, dixième tranche : application des drapeaux du routeur (V3-L7)

- `legacyRoute` et `selectConfiguredModelRoute` sortent dans
  `services/models/configured-model-route.js`. Ils appliquent :
  - `router.policy.v2` ;
  - Astra ;
  - multi-fournisseur ;
  - small-first et apprentissage adaptatif, en ombre.

  Le routeur (`selectModelRoute`) reste dans `lib`. Ni les modèles, ni l'ordre de repli, ni les
  seuils, ni les drapeaux ne changent. `server.js` passe de 3 613 à 3 510 lignes.
- Aucun ajout de code : `reliabilityEngine` et `adaptiveRoutingService`, déclarés plus loin,
  sont lus par accesseur. Contrôle : 965 jetons identiques une fois retirés les préfixes `deps.`.
  Le test de câblage small-first lit maintenant `server.js` suivi des modules extraits ; son
  assertion est inchangée.
- Avant/après avec le faux serveur Responses local, sur quatre configurations de drapeaux :
  - A : valeurs par défaut ;
  - B : politique v2 en ombre ;
  - C : politique v2 coupée ;
  - D : Astra, adaptatif et small-first coupés.

  Chaque configuration rejoue 9 requêtes `/ai` et `/ai/stream` (salutation, profils économique,
  approfondi et maximum, question d'architecture, recherche web, agenda). Les 8 appels au modèle
  de chaque configuration sont identiques : modèle, effort, verbosité et corps. Les branches
  diffèrent bien d'une configuration à l'autre : la question d'architecture part sur `terra`
  avec la politique v2, sur `sol` en routage historique.

  Les journaux d'audit ont le même nombre d'entrées, dans le même ordre. Les événements de
  routage et de comparaison en ombre sont identiques. Seuls diffèrent des latences et les
  compteurs du cache de contexte, qui varient d'une exécution à l'autre. Tests à assertions
  d'absence rejoués contre la source complète : 220/220, plus les 4 tests small-first.

## 23/11/2026 — Découpe de `server.js`, onzième tranche : assemblage du Brief quotidien (V3-L7)

- L'assemblage du Brief sort dans `services/daily-brief/daily-brief-composition.js`
  (`createDailyBriefComposition`) :
  - le service du matin ;
  - le contexte personnel local ;
  - le moteur du Brief avec ses fournisseurs (planification, suivi, revue) et sa composition
    distante (préflight `REMOTE_REASONING`, budget, politique de confidentialité, puis appel au
    modèle) ;
  - le journal d'usage et la génération.

  `prepareDrafts` reste vide : aucune écriture externe. La « Santé de Noon » reste dans
  `server.js` et lit le journal d'usage exporté. `server.js` passe de 3 510 à 3 395 lignes.
- Aucun ajout de code. Ses 37 dépendances sont déjà déclarées à la construction, qui a lieu à
  la place du service du matin ; les déclarations déplacées étaient contiguës, l'ordre
  d'exécution est donc inchangé. Contrôle : 1 453 jetons identiques.
- Deux tests de câblage lisaient `server.js` seul ; ils lisent maintenant `server.js` suivi
  des modules extraits, avec des assertions inchangées :
  - le Brief ne fait aucune écriture externe ;
  - le préflight local-only passe avant tout appel distant.

  Le second, oublié lors du repérage, a échoué au premier `npm test` puis est passé une fois
  adapté.
- Avant/après dans deux copies isolées (HEAD et HEAD + modification). Le checkout de travail
  contient le helper EventKit Rappels, non versionné, qui aurait lu les vrais Rappels. Le rejeu
  a utilisé :
  - le faux serveur Responses local ;
  - des `osascript` et `shortcuts` factices qui refusent ;
  - `fetch` limité à `127.0.0.1`.

  10 requêtes : brief courant, usage, génération forcée puis non forcée, ouverture, historique,
  planification. Résultats :
  - réponses, requête envoyée au modèle, `personal-brief.json`, `daily-plans.json`,
    `brief-usage-log.json` et journal d'audit identiques une fois normalisés les durées, les
    identifiants aléatoires et les empreintes de clés du cache de contexte (ces empreintes
    varient déjà entre deux exécutions de la même version) ;
  - aucun appel Apple ni réseau sortant n'a été tenté.

  Tests à assertions d'absence rejoués contre la source complète : 208/208, plus les 12 tests
  de fraîcheur du Brief.

## 23/11/2026 — Découpe de `server.js`, douzième tranche : assemblage du Control Center (V3-L7)

- Ce qui sort dans `services/control-center/control-center-composition.js`
  (`createControlCenterComposition`) :
  - le Control Center : ses 20 lecteurs de supervision et ses 3 actions bornées ;
  - ses deux utilitaires, `controlState` et `reliabilityItems`.

  `server.js` passe de 3 395 à 3 291 lignes.
- Aucun ajout de code. `workspaceEngine`, déclaré plus loin, est lu par accesseur. Contrôle :
  3 048 jetons identiques. Aucun test ne lisait ce câblage dans `server.js`.
- Avant/après dans deux copies isolées, avec :
  - faux `osascript` ;
  - identifiants OAuth factices ;
  - `fetch` limité à `127.0.0.1`.

  36 requêtes :
  - la vue d'ensemble, en vues utilisateur et avancée ;
  - les 20 sections ;
  - trois sections en vues avancée et développeur (refusée : drapeau coupé) ;
  - une section inconnue ;
  - les actions : diagnostic rapide, vérification de connexion Gmail et Notes, extension
    inconnue, action inconnue, action sans en-tête de confiance.

  35 réponses sont identiques. La 36ᵉ (vérification Gmail → `AUTH_REQUIRED`) ne diffère que
  par l'état OAuth, le défi PKCE et le port éphémère, tous aléatoires. Le journal d'audit
  contient les mêmes 492 entrées, dans le même ordre. Aucun appel réseau sortant ; un seul
  appel au faux `osascript` de chaque côté. Tests à assertions d'absence rejoués contre la
  source complète : 208/208.

## 23/11/2026 — Découpe de `server.js`, quinzième tranche : orchestration du chat (V3-L7)

Entrée rédigée après coup, lors de l'intégration : tranche faite par Codex (`56fa566`) à partir
de la douzième, en parallèle des tranches 13 et 14.

- Modules créés :
  - `services/models/model-response.js` : fonctions pures de lecture des réponses du modèle
    (sources web citées, appels de recherche, nettoyage d'une sortie, erreur de compatibilité
    `tool_search`) ;
  - `services/intents/intent-context.js` : `buildIntentContext`. Les dépendances déclarées plus
    loin (`workspaceEngine`, historique et clés de conversation) sont lues par accesseur ;
  - `services/delegation/chat-delegation-composition.js` : délégation à des spécialistes bornés ;
  - `services/orchestration/chat-orchestration-composition.js` : orchestrateur et moteur
    d'évaluation des agents.
- `server.js` passe de 3 291 à 3 071 lignes. Le test `responses-api-options` lit désormais
  `server.js` suivi des modules extraits.
- Les modules sont écrits à la main, sans `scripts/extract-server-domain.js`. Contrôle a
  posteriori : les déclarations retirées de `server.js` se retrouvent telles quelles dans les
  modules (seuls les `require` changent de place). Rejeu avant/après (faux serveur Responses,
  copies isolées) : réponses, requêtes au modèle et audit identiques. Une copie de l'autre
  version de cette tranche (Claude) est gardée hors du dépôt ; elle n'a pas été retenue.

## 23/11/2026 — Découpe de `server.js`, seizième tranche : contexte personnel et mémoire (V3-L7)

Entrée rédigée après coup, lors de l'intégration : tranche faite par Codex (`d9ccd6f`,
`7fb7e51`).

- `services/context/personal-context-composition.js` assemble le contexte personnel et la
  continuité de session ; `services/memory/personal-memory-composition.js` assemble le service
  de mémoire privée chiffrée, la migration historique et les invalidations après écriture.
  `docs/CONTEXT_BUILDER.md` décrit ce découpage. `server.js` passe de 3 071 à 2 871 lignes.
- Correctif d'un défaut antérieur (`7fb7e51`). L'ancien import SQLite avait recopié
  `long-term-memory.json` dans `memory_items` avec un statut confirmé. Après la migration
  privée, qui recopie ces souvenirs en « à revoir » et local-only, la copie SQLite continuait à
  alimenter la recherche et le contexte distant. Elle contournait ainsi la revue et pouvait
  faire réapparaître un souvenir oublié. Ces copies sont maintenant exclues de la recherche, du
  contexte et des références une fois la migration terminée ; elles restent visibles dans la
  gestion locale (`docs/MEMORY_MIGRATION.md`).
  - Effet visible : un ancien souvenir n'est plus envoyé au modèle tant que sa version migrée
    n'a pas été revue.
  - Si la mémoire privée est indisponible, rien n'est exclu et rien ne plante.
- Contrôle a posteriori : déclarations retrouvées telles quelles dans les modules ; nouveau test
  `memory-engine` ; rejeu avant/après avec des commandes mémoire (retenir, consulter, oublier)
  identique. La mémoire privée n'est pas couverte par ce rejeu, faute de coffre macOS hors
  Electron.

## 23/11/2026 — Découpe de `server.js`, dix-septième tranche : composition Native DEV et Goal Mode DEV (V3-L7)

- L'assemblage sort dans `services/dev/dev-runtime-composition.js`, en trois frontières explicites :
  - Native DEV (reasoner, journal persistant, coordinateur benchmark, orchestrateur B3 et façade) ;
  - Goal DEV (exécution évaluée et retry runtime) puis Goal Mode DEV (runtime, maintenance du verrou et transport HTTP) ;
  - le bridge Native DEV UI, toujours construit après le Terminal DEV.

  `server.js` passe de 2 871 à 2 671 lignes. SelfDev, les missions DEV et le benchmark restent
  volontairement hors de cette tranche.
- Les autorités ne changent pas : la politique opérationnelle, le sandbox, le journal, le budget,
  les approbations et le verrou exclusif du dossier de données restent les instances canoniques
  créées par le serveur. Le handler Goal Mode DEV conserve l'exigence `X-Noon-Request`, et les
  flags restent réévalués côté serveur.
- Le premier test serveur réel a détecté que `getValidRegisteredProjects` était passé par valeur
  avant son initialisation. La composition reçoit désormais un fournisseur différé, ce qui
  restaure l'ordre d'initialisation historique. Aucun accès projet n'a lieu pendant la composition.
- Les tests de câblage qui lisaient uniquement `server.js` lisent désormais aussi le module extrait.
  Les assertions de sécurité sont conservées : Sandbox B3 seulement, journal réel, trusted UI,
  absence d'accès direct au dispatcher et acquisition du verrou uniquement par sa maintenance.
- Validation avant/après sur les mêmes 18 scénarios serveur et orchestration : 18/18 des deux côtés.
  Ils couvrent le flag Goal Mode DEV coupé/actif, deux processus sur le même dossier de données,
  la reprise d'un verrou périmé, l'orchestrateur B3 et le bridge Native DEV UI. La validation
  élargie couvre également 448 tests DEV ciblés, le lint, le build et les évaluations critical,
  smoke, goals, delegation et feature-flags.

## 23/11/2026 — Découpe de `server.js`, dix-huitième tranche : SelfDev, missions et benchmark (V3-L7)

- L'assemblage sort dans `services/dev/dev-auxiliary-composition.js`, sans réunir les autorités :
  - SelfDev conserve son conteneur de worktrees, sa politique de chemins, son exécuteur sandboxé
    et sa relecture distante soumise à `REMOTE_REASONING` ;
  - les missions DEV conservent l'exécuteur sélectionnable, les deux approbations V2 et la
    revalidation des racines Git en écriture ;
  - le benchmark conserve son runner historique séparé du sandbox B3, son gate et son contrôle
    persistant.

  `server.js` passe de 2 671 à 2 569 lignes.
- Les flags restent réévalués au moment de l'usage. Safe mode et UI validation continuent de
  couper SelfDev et les missions. Le benchmark reste inerte au démarrage : aucune session ni
  exécution n'est créée automatiquement.
- Comparaison avant/après sur les mêmes 59 scénarios : 59/59 des deux côtés. Ils couvrent les
  worktrees isolés, les chemins protégés, l'approbation de lancement puis d'application, l'usage
  unique, les dépôts révoqués ou modifiés, le redémarrage benchmark et les processus concurrents
  Goal Mode DEV.
- Validation complémentaire : lint, build, évaluations critical 54/54, smoke 99/99,
  delegation 10/10 et feature-flags 2/2. Le test SelfDev de reproduction déjà instable sous Linux
  reste le seul échec du sous-ensemble qui l'inclut ; il produit la même sortie avant la tranche.

## 23/11/2026 — Découpe de `server.js`, dix-neuvième tranche : imports statiques des domaines (V3-L7)

- Les modules déjà extraits importent désormais directement leurs constructeurs et utilitaires
  statiques : Brief quotidien, Control Center, projets locaux, conversations, suivi d'usage et
  `askAI`. `server.js` ne leur transmet plus les modules Node, fonctions pures ou fabriques qui
  ne dépendent pas du runtime.
- Les instances et autorités restent injectées : base personnelle, moteurs, connecteurs,
  approbations, politique de sécurité, budget, feature flags, dossiers autorisés et observabilité.
  Aucun singleton runtime n'a été recréé dans un module extrait.
- `server.js` passe de 2 569 à 2 496 lignes. Les contrats `DEPENDENCIES` ont été réduits en même
  temps afin qu'une dépendance statique ne puisse plus être remplacée depuis la composition.
- Validation : 67/67 tests ciblés Brief, Control Center, conversations et recherche ; démarrage
  serveur réel avec Goal Mode DEV actif/inactif ; lint et build ; évaluations critical 54/54,
  smoke 99/99, privacy 3/3 et delegation 10/10. La suite complète conserve uniquement les trois
  échecs Linux déjà connus (SelfDev SD-2 et deux fixtures macOS `/private/tmp`).

## 24/11/2026 — Découpe de `server.js`, treizième tranche : serveur HTTP, démarrage et arrêt (V3-L7)

- Intégrée après les tranches 15 à 19 (faites en parallèle à partir de la douzième). Ce qui
  sort dans `services/http/noon-http-server.js` (`createNoonHttpServer`) :
  - le serveur HTTP local : authentification locale, routes publiques, blocage des accès
    externes en validation UI, aiguillage vers les modules de routes dans le même ordre, 404 ;
  - `startNoonServer` et `stopNoonServer`.

  `server.js` exporte les mêmes objets et `electron/main.js` ne change pas. `server.js` passe
  de 2 496 à 2 255 lignes.
- Deux retouches de `server.js` avant l'extraction, sans effet sur le comportement :
  - les trois drapeaux de démarrage, `localAuthSecret` et `PUBLIC_ROUTES` sont déclarés juste
    avant le serveur (littéraux ou `process.env`, lus seulement au démarrage et par requête) ;
  - les affectations des chargeurs de clés OpenAI/Gemini passent par `setProviderKeyLoaders`,
    une petite fonction de `server.js`, car `getOpenAIClient` et `getGeminiClient` les lisent
    hors du domaine.

  Le module est ainsi construit après tous les modules de routes, et toutes ses dépendances
  sont lues une fois. Contrôle : 1 416 jetons identiques.
- Cinq tests de câblage lisaient `server.js` seul ; ils lisent maintenant `server.js` suivi des
  modules extraits, avec des assertions inchangées : `app-bundle`, `figma-bridge`,
  `http-route-modules`, `production-hardening`, `v1-architecture-freeze`.
- Démarrage vérifié par le mode smoke d'Electron (profil jetable, port isolé, `/health` avec le
  secret local, sortie propre). Avant/après dans des copies isolées (faux serveur Responses,
  faux `osascript`, `fetch` limité à `127.0.0.1`) : 33 requêtes en mode normal, 10 avec secret
  local (serveur démarré comme Electron via `startNoonServer({ authSecret })`), 33 en
  validation UI. Réponses, requêtes au modèle et journaux d'audit identiques une fois
  normalisés.

## 24/11/2026 — Découpe de `server.js`, quatorzième tranche : activité de session et transcription (V3-L7)

- Ce qui sort dans `services/voice/session-activity-and-transcription.js`
  (`createSessionActivityAndTranscription`) :
  - l'activité de session : `sessionActivities`, `setSessionActivity`, `getSessionActivity` ;
  - la transcription audio : `transcribeAudioBuffer` et la limite `MAX_AUDIO_BYTES`.

  `server.js` passe de 2 255 à 2 209 lignes. Le gain est faible (47 lignes) : la construction
  de `voiceHttpRoutes` reste dans `server.js`, car la déplacer remplacerait ses accesseurs par
  une liste de dépendances de même taille.
- Aucun ajout de code, deux dépendances (`getOpenAIClient`, `toFile`). Contrôle : 187 jetons
  identiques. Aucun test ne lisait ce code dans `server.js`.
- Avant/après dans des copies isolées : activité avant et après `/ai` et `/ai/stream`, remise à
  zéro par `/conversation/reset`, `/transcribe` en `audio/webm` et `audio/mp4` (faux serveur)
  et au-delà de 10 Mo (413), budget temps réel. Réponses, requêtes au modèle et journal
  d'audit identiques une fois normalisés.

## 24/11/2026 — Incident disque plein : requêtes bloquées et traces vidées

- Constat : Noon démarré disque plein. Le journal d'audit levait `ENOSPC` dans les routes, et
  le serveur HTTP laissait ces requêtes sans réponse : Control Center, Brief, mémoire et reprise
  de conversation restaient en chargement. Les données (SQLite, mémoires, conversations,
  budget) étaient intactes. La purge des traces au démarrage réécrivait
  `noon-observability.jsonl` en place, et le fichier a été vidé.
- Corrections, défauts antérieurs à la découpe :
  - `services/http/noon-http-server.js` : une exception non rattrapée par une route donne une
    réponse 500 `INTERNAL_ERROR` (`Cache-Control: no-store`). Une réponse déjà commencée est
    terminée. Le journal ne contient que la méthode, le chemin et le code d'erreur.
  - `services/security/audit-log.js` : l'audit devient « au mieux », comme dans ApprovalEngine
    (« une panne d'audit ne rend pas l'action moins sûre »). Un échec d'écriture ne lève plus
    d'exception : `append` renvoie `false`, l'échec est compté, signalé une fois par code
    d'erreur et exposé par `health()`. Les écritures de persistance qui protègent une action
    (approbations, mémoire) restent bloquantes.
  - `services/observability/noon-observability.js` : la purge de démarrage écrit un fichier
    temporaire puis le renomme. Un échec laisse l'ancien fichier intact.
- Tests : `test/disk-full-resilience.test.js` (6 tests). Quatre d'entre eux échouent sur le
  code d'avant : 500 au lieu d'une requête bloquée, audit sans exception, traces intactes.
- Reste ouvert : `health()` n'est pas encore affiché dans le Control Center.

## 24/11/2026 — Découpe de `server.js`, vingtième tranche : construction groupée des modules de routes (V3-L7)

- Les 20 constructions `createXHttpRoutes({ get … })`, éparpillées dans `server.js`, sont
  remplacées par une seule table dans `services/http/route-modules-composition.js`. La table
  associe le nom d'instance, la fabrique et ses `DEPENDENCIES`, dans le même ordre qu'avant.
  - `createHttpRouteModules(source)` construit chaque module avec
    `pickDependencies(source, DEPENDENCIES)` (`services/http/route-dependencies.js`). Chaque
    module reçoit seulement les noms qu'il déclare, par accesseur relu à chaque accès.
  - Une dépendance absente est refusée à la construction, comme avant.
  - Dans `server.js`, un seul objet d'accesseurs, `httpRouteDependencies` (174 noms), est
    placé juste avant le serveur HTTP.
- `remoteLanHttpRoutes`, `figmaBridgeHttpRoutes` et `memoryHttpRoutes` gardent leur
  construction : leur interface est différente (`matches` / `handle`).
- Les fabriques ne lisent leurs dépendances qu'à l'arrivée d'une requête qui correspond, jamais
  à la construction. Construire plus tard ne change donc aucune valeur lue.
- `server.js` passe de 2 209 à 2 078 lignes.
- Tests : le test de câblage vérifie, pour chaque module, que la table utilise la même
  fabrique et les mêmes `DEPENDENCIES`, que chaque nom a son accesseur et que l'aiguillage est
  inchangé. Deux tests nouveaux couvrent `pickDependencies` et la construction groupée.

## 24/11/2026 — Découpe de `server.js`, vingt et unième tranche : imports statiques des routes (V3-L7)

- 42 des 174 dépendances des modules de routes sont de simples imports : des fonctions et des
  constantes issues de `require`, ainsi que `fs`, `path` et `crypto`. La composition des
  routes les importe elle-même (`STATIC_ROUTE_DEPENDENCIES`). Ce sont les mêmes modules, donc
  les mêmes objets grâce au cache de `require`.
  - `server.js` n'expose plus que les 132 dépendances vivantes
    (`HTTP_ROUTE_LIVE_DEPENDENCIES`), par accesseur comme avant.
  - Un nom fourni à la fois en import statique et par `server.js` est refusé à la construction.
- 34 imports de `server.js` ne servaient plus qu'à ces accesseurs ; ils sont supprimés.
  - Les modules concernés n'ont aucun effet de bord au chargement : les charger un peu plus
    tard ne change rien.
  - Le `require` de la composition est placé après tous les imports de `server.js`.
- Le serveur HTTP reçoit les 20 modules par `...httpRouteModules`, au lieu d'une
  déstructuration suivie de 20 noms répétés.
- `server.js` passe de 2 078 à 1 971 lignes.
- Tests : le test de câblage vérifie désormais :
  - que l'objet d'accesseurs expose exactement les dépendances vivantes ;
  - que chaque import statique est le même objet que dans son module d'origine ;
  - que les 20 modules sont construits et passés au serveur HTTP ;
  - qu'une dépendance absente ou fournie deux fois est refusée.
- Deux tests de garde (`dev-task-id-namespace`, `goal-mode-dev-approval-guard`) exigeaient
  l'import écrit `./services/…` dans `server.js`. Ils acceptent désormais aussi `../…` (import
  fait par la composition). Leurs autres assertions sont inchangées : garde appliquée avant
  `runTask` et avant `resume`.
- Avant/après dans des copies isolées (données vierges, faux `osascript`, réseau limité à
  `127.0.0.1`, sans clé) : les 96 routes littérales des modules appelées en GET. Les réponses
  sont identiques une fois normalisées, sauf une latence mesurée et le chemin du dossier
  personnel factice propre à chaque copie.

## 24/11/2026 — Découpe de `server.js`, vingt-deuxième tranche : composants surveillés par Reliability (V3-L7)

- Ce qui sort dans `services/reliability/core-reliability-components.js`
  (`registerCoreReliabilityComponents`) : les 24 enregistrements `reliabilityEngine.register`
  du milieu de `server.js`, déplacés tels quels (1 530 jetons identiques). Ils couvrent :
  - stockage : SQLite, mémoire privée, fichiers ;
  - moteurs : cache de contexte, capacité, artefacts ;
  - connecteurs : Notes, Rappels, Gmail, Agenda ;
  - modèles : OpenAI, Gemini, profils ;
  - voix (Live, wake word), planificateur, multimodal.
- `server.js` l'appelle au même endroit : après les connecteurs, avant la politique de
  sécurité. L'ordre des composants est donc inchangé.
  - Les 12 dépendances sont des constantes déjà initialisées à l'appel, lues une fois.
  - `fs` et `SCHEMA_VERSION` sont importés par le module.
  - Les autres enregistrements (recherche web, runtime local, jobs, exécution
    transactionnelle, spécialistes) restent à leur place, pour la même raison d'ordre.
- `server.js` passe de 1 971 à 1 888 lignes.
- Tests :
  - `test/core-reliability-components.test.js` vérifie :
    - le refus d'une dépendance manquante ;
    - les 24 composants dans l'ordre ;
    - les contrôles de santé : schéma SQLite, repli JSON, clé de mémoire privée, frontière
      d'autorité de capacité, Google non connecté ;
    - la position de l'appel.
  - `connector-validation` lisait `server.js` seul ; il lit maintenant `server.js` suivi des
    modules extraits, avec des assertions inchangées.
- Avant/après dans des copies isolées : 96 routes en GET, réponses identiques une fois
  normalisées. Seul l'ordre des règles permanentes du profil a varié une fois : elles sont
  triées par `updated_at` à la milliseconde et écrites en quelques millisecondes au
  démarrage. Le contenu est identique, et l'écart vient de l'horloge, pas du déplacement.

## 24/11/2026 — Découpe de `server.js`, vingt-troisième tranche : assemblage de la recherche personnelle (V3-L7)

- Ce qui sort dans `services/search/personal-search-composition.js`
  (`createPersonalSearchComposition`) :
  - la construction de `personalSearchEngine` et de ses dix adaptateurs (conversation,
    mémoire, projets, fichiers, documents, médias, notes, rappels, email, agenda) ;
  - la construction de `multiSourceSynthesisEngine` et de son contrôle de permissions.
- Le bloc est déplacé tel quel (493 jetons), avec quatre substitutions :
  - deux `const` au lieu de deux affectations ;
  - `deps.multimodalEngine` aux deux usages. C'est une variable réaffectée de `server.js`, lue
    par accesseur comme le faisaient les fermetures.
- `server.js` affecte les deux `let` au même endroit qu'avant :
  `({ personalSearchEngine, multiSourceSynthesisEngine } = createPersonalSearchComposition(…))`.
  - Les 18 autres dépendances sont déjà initialisées et lues une fois.
  - Les 9 fabriques (moteur, synthèse, adaptateurs) sont importées par le module, et leurs 4
    imports quittent `server.js`.
- `server.js` passe de 1 888 à 1 833 lignes.
- Tests : `test/personal-search-composition.test.js` vérifie :
  - le refus d'une dépendance manquante ;
  - la construction des deux moteurs ;
  - que la recherche média lit le moteur multimodal courant (relu après remplacement) ;
  - la position et les arguments de l'appel.
- Avant/après dans des copies isolées, référence : tranche 22. Requêtes rejouées :
  - les 96 routes en GET ;
  - 2 `POST /personal-search` (toutes sources, recherche globale) ;
  - 2 `POST /personal-synthesis` ;
  - `GET /search`.

  Les réponses sont identiques une fois normalisées, sauf `resultId` : c'est une empreinte qui
  inclut l'horodatage de la règle trouvée, réécrite à chaque démarrage.

## 24/11/2026 — Découpe de `server.js`, vingt-quatrième tranche : assemblage du cycle de vie (V3-L7)

- Ce qui sort dans `services/lifecycle/lifecycle-composition.js`
  (`createLifecycleComposition`) : la construction du registre des stockages durables, des
  sauvegardes, du journal de mise à jour, du gestionnaire de migrations et du moteur de reprise
  après mise à jour.
- Le bloc est déplacé tel quel (595 jetons). Seul le chemin de `package.json` est réécrit
  depuis le nouveau dossier : même module, même cache.
- Le mode reste diagnostic : aucune migration active, l'écriture de schéma est refusée.
- Seul `updateRecoveryEngine` sert ailleurs ; c'est le seul objet renvoyé.
- `server.js` l'appelle au même endroit qu'avant. Ses 14 dépendances sont des constantes déjà
  initialisées, lues une fois.
- Les 5 fabriques du cycle de vie, `SCHEMA_VERSION` et `loadSqlite` sont importés par le
  module. Ces modules n'ont aucun effet de bord au chargement.
- `server.js` passe de 1 833 à 1 801 lignes.
- Tests : `test/lifecycle-composition.test.js` vérifie :
  - le refus d'une dépendance manquante ;
  - le plan et le diagnostic de démarrage : version de l'application, schéma courant, état
    `CLEAN`, aucune sauvegarde ni écriture ;
  - la position et les arguments de l'appel.

## 24/11/2026 — Découpe de `server.js`, vingt-cinquième tranche : services d'intelligence personnelle (V3-L7)

- Ce qui sort dans `services/personal-intelligence/personal-intelligence-composition.js`
  (`createPersonalIntelligenceComposition`) :
  - profil opérationnel, projets, inbox, capture rapide ;
  - « Où j'en étais ? » et premier pas ;
  - déduplication, relances, métriques, créneaux ;
  - planning du jour, proactivité, suivi d'exécution, revues ;
  - migration des anciennes données et analyses de fond ;
  - gestionnaires de jobs `PUBLIC_RESEARCH` et `MAINTENANCE`.
- Le bloc est déplacé tel quel (1 194 jetons), avec une seule substitution :
  `deps.resolveFocusCatalogSelection`. Cette fonction est déclarée plus loin dans `server.js`,
  elle est donc relue par accesseur, comme le faisait la fermeture.
- `server.js` l'appelle au même endroit qu'avant. La migration, `ensurePermanentRules()` et
  l'enregistrement des gestionnaires de jobs ont donc lieu au même moment du démarrage.
  - Les 21 autres dépendances sont déjà initialisées et lues une fois.
  - Les 15 fabriques et 4 utilitaires sont importés par le module (`noonPersonality`,
    `localDayRange`, `inspectGitStatus`, `migrateLegacyPersonalData`). Ces modules n'ont aucun
    effet de bord au chargement.
  - 16 services sont renvoyés ; `deduplicationService` reste interne.
- `server.js` passe de 1 801 à 1 695 lignes.
- Tests :
  - `test/personal-intelligence-composition.test.js` vérifie, sur une base SQLite temporaire :
    - le refus d'une dépendance manquante ;
    - les services renvoyés et les règles permanentes écrites ;
    - les gestionnaires de jobs enregistrés seulement si le moteur de jobs existe ;
    - la fonction de Focus relue après remplacement ;
    - le premier pas refusé en mode local (`FIRST_STEP_REMOTE_FORBIDDEN`, 409) ;
    - la position de l'appel.
  - `review-learning-scope` lisait `server.js` seul ; il lit maintenant `server.js` suivi des
    modules extraits.
  - `resume-briefing` accepte le préfixe `deps.` devant `resolveFocusCatalogSelection`.
  - Les autres assertions de ces tests sont inchangées.

## 24/11/2026 — Découpe de `server.js`, vingt-sixième tranche : extensions et client MCP (V3-L7)

- Ce qui sort dans `services/extensions/extensions-composition.js`
  (`createExtensionsComposition`) :
  - le runtime des extensions et son exécuteur transactionnel ;
  - le registre des extensions et son branchement au runtime ;
  - le client MCP ;
  - l'extension de démonstration, chargée seulement si `NOON_ENABLE_EXAMPLE_SEARCH_EXTENSION`
    vaut `true`.
- Le bloc est déplacé tel quel (516 jetons). Seul le chemin de `package.json` est réécrit
  depuis le nouveau dossier.
- `server.js` l'appelle au même endroit qu'avant.
  - Ses 11 dépendances sont déjà initialisées et lues une fois.
  - Les fabriques et l'extension de démonstration sont importées par le module, qui n'a
    aucun effet de bord au chargement.
  - Seuls `extensionRegistry` et `mcpService` sont renvoyés. Le bloc Figma reste après la
    délégation DEV, pour garder l'ordre de construction.
- `server.js` passe de 1 695 à 1 654 lignes.
- Tests :
  - `test/extensions-composition.test.js` vérifie :
    - le refus d'une dépendance manquante ;
    - le client MCP actif seulement avec le flag, hors validation UI et hors smoke ;
    - l'extension de démonstration absente par défaut ;
    - la position de l'appel.
  - `mcp-client` lisait `server.js` seul ; il lit maintenant `server.js` suivi des modules
    extraits, et vérifie que le bloc est trouvé.

## 24/11/2026 — Découpe de `server.js`, vingt-septième tranche : progression utilisateur (V3-L7)

- Ce qui sort dans `services/observability/progress-composition.js`
  (`createProgressComposition`) :
  - le contexte de requête du chat (`AsyncLocalStorage`) ;
  - le moteur et l'adaptateur de progression ;
  - `publicDevProgress`, la projection publique pour l'API DEV ;
  - l'observabilité de l'orchestrateur.
- Le bloc est déplacé tel quel (143 jetons identiques). `publicDevProgress` était une
  déclaration de fonction, donc hissée en tête du fichier ; elle devient une constante. Toutes
  ses références dans `server.js` se trouvent après l'appel, ce qui rend le changement sans
  effet.
- Seule dépendance : `noonObservability`. Les 5 imports concernés quittent `server.js`.
- `server.js` passe de 1 654 à 1 582 lignes.
- Tests : `test/progress-composition.test.js` vérifie :
  - le refus d'une dépendance manquante ;
  - la progression transmise au flux du chat seulement dans le contexte d'une requête ;
  - qu'un affichage en échec ou absent ne casse pas l'exécution ;
  - la projection DEV tolérante (identifiant vide, nul ou inconnu) ;
  - la position de l'appel.

## 24/11/2026 — Découpe de `server.js`, vingt-huitième tranche : runtime local, notifications et travaux de fond (V3-L7)

- Ce qui sort dans `services/runtime/local-runtime-and-jobs-composition.js`
  (`createLocalRuntimeAndJobsComposition`) :
  - le modèle local et le runtime d'intelligence locale ;
  - l'attention des notifications et son stockage ;
  - le registre, le stockage et le moteur des travaux de fond, avec leur notification de fin ;
  - leurs composants Reliability : runtime local, attention, `job-store`, `job-queue`,
    `job-worker`, `job-scheduler`.
- Le bloc est déplacé tel quel (691 jetons), avec une seule substitution :
  `deps.setSessionActivity`. Cette fonction est déclarée plus loin dans `server.js` et
  utilisée seulement dans la notification de fin de job ; elle est donc relue par accesseur.
- `server.js` l'appelle au même endroit qu'avant, donc l'ordre des composants Reliability est
  inchangé.
  - Les 7 autres dépendances sont déjà initialisées et lues une fois.
  - Les 7 imports concernés quittent `server.js`. Ces modules n'ont aucun effet de bord au
    chargement.
- `server.js` passe de 1 582 à 1 512 lignes.
- Tests : `test/local-runtime-and-jobs-composition.test.js` vérifie :
  - le refus d'une dépendance manquante ;
  - avec SQLite, la création du moteur de jobs et les composants Reliability dans l'ordre ;
  - avec le repli JSON, l'absence de moteur et de composant de jobs ;
  - que `setSessionActivity` n'est jamais lue à la construction ;
  - la position de l'appel.

## 24/11/2026 — Découpe de `server.js`, vingt-neuvième tranche : clients des fournisseurs (V3-L7)

- Ce qui sort dans `services/models/provider-clients.js` (`createProviderClients`) :
  `getOpenAIClient`, `getGeminiClient` et `setProviderKeyLoaders`, avec leur état : clients
  créés au premier appel et chargeurs de clés fournis par Electron.
- Le bloc est déplacé tel quel (269 jetons identiques). Le comportement reste le même :
  - refus en validation UI isolée ;
  - clé lue dans `process.env` et chargée à la demande ;
  - 503 si la clé est absente.
- Les trois fonctions étaient des déclarations hissées en tête du fichier. Elles deviennent des
  constantes créées au même endroit, et rien ne les utilise avant.
- Les imports `OpenAI` et `GoogleGenAI` suivent le code.
- `server.js` passe de 1 512 à 1 479 lignes, sous l'objectif de 1 500.
- Tests : `test/provider-clients.test.js` vérifie, sans appel réseau ni vraie clé :
  - clé absente → 503 ;
  - refus en validation UI ;
  - chargeurs appelés seulement à la demande ;
  - client créé une fois puis réutilisé ;
  - chargeurs invalides ignorés ;
  - création avant tout usage.
- Avant/après dans des copies isolées : réponses identiques une fois normalisées. Comme à la
  vingt-deuxième tranche, seul l'ordre des règles permanentes du profil a varié. Elles sont
  triées par `updated_at` à la milliseconde, et leur contenu est identique.
- **Bilan de la découpe** : `server.js` est passé de 10 831 à 1 479 lignes en 29 tranches. Le
  critère de sortie de V3-L7 (« aucun fichier > 1 500 lignes ») n'est pas encore atteint pour
  tout le dépôt. Huit fichiers de code le dépassent :
  - `services/dev/workspace-terminal-service.js` (2 294) ;
  - `services/dev/native-dev-implementation-engine.js` (2 179) ;
  - `services/goals/goal-mode-run-state.js` (1 975) ;
  - `services/orchestration/ask-ai.js` (1 728) ;
  - `services/goals/goal-mode-next-step-planner.js` (1 695) ;
  - `services/security/dev-process-runner.js` (1 667) ;
  - `services/orchestration/noon-orchestrator.js` (1 643) ;
  - `services/decision/decision-support-engine.js` (1 613).

  Plusieurs fichiers de tests dépassent aussi ce seuil.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `workspace-terminal-service.js` (2 294 → 1 397)

- Méthode, reprise pour les sept autres fichiers :
  - des fonctions internes de la fabrique sont déplacées telles quelles, avec leurs commentaires ;
  - les fonctions qui ne lisent aucun état de la fabrique deviennent des fonctions de module ;
  - les autres passent dans une petite fabrique qui reçoit exactement les noms qu'elles
    utilisaient ;
  - une analyse de portée (eslint-scope) liste ces dépendances avant le déplacement ;
  - une comparaison des jetons vérifie le résultat : 17 déclarations déplacées identiques, et
    les 14 fonctions restées dans le service inchangées.
- Nouveaux modules dans `services/dev/` :
  - `workspace-terminal-shared.js` : `DevWorkspaceError` et `clean`. Le service réexporte la
    même classe.
  - `workspace-terminal-projections.js` : projections publiques (problèmes, diff git,
    terminal, session), `refreshExecutionState`, `terminalFor`, `assertTerminalOrigin`.
  - `workspace-terminal-completions.js` : complétions du terminal (entrées autorisées, chemins
    réels dans le dépôt, scripts `package.json`).
  - `workspace-terminal-git-diff.js` : `inspectGitDiff` et `readGitDiff`, construits avec les
    `emit`, `gitDiffService` et `requireSession` du service.
- Les fonctions internes étaient hissées dans la fabrique. Les imports sont disponibles dès le
  chargement, et les opérations de diff sont construites juste après `iso`, avant tout usage
  (uniquement dans l'objet renvoyé).
- L'API publique du service et ses exports sont inchangés.
- Tests :
  - suites existantes du terminal et du diff git inchangées : 50/50 ;
  - `test/workspace-terminal-modules.test.js` vérifie la même classe d'erreur, des projections
    sans état partagé et l'absence d'inspection si la session est refusée.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `native-dev-implementation-engine.js` (2 179 → 1 364)

- Même méthode : déplacements à l'identique, avec 18 déclarations comparées jeton par jeton,
  toutes identiques. Les déclarations restées dans le moteur sont `applyEdits` et
  `runImplementation`.
- Nouveaux modules dans `services/dev/` :
  - `native-dev-implementation-helpers.js` : tout le niveau module situé entre les imports et
    la fabrique (phases autorisées, `safeError`, `normalizeReasoning`, `unique`, bornes et
    candidats de dépendances locales, `isBlockingValidationFailure`), plus `modelFiles`.
    Fonctions pures et constantes. Le moteur réexporte les mêmes `normalizeReasoning` et
    `isBlockingValidationFailure`.
  - `native-dev-implementation-inspection.js` : `inspect` et `inspectLocalDependencies`,
    construits avec le `journal` du moteur.
  - `native-dev-implementation-skills.js` : `authorize`, `executeSkill` et `validate`,
    construits avec la politique de sécurité, le registre de skills, l'exécution
    transactionnelle, le journal et le `validationRunner` du moteur.
- Les opérations sont construites juste après les contrôles de dépendances du moteur.
  - Une dépendance manquante est donc toujours refusée avant toute construction.
  - Ces dépendances sont des paramètres jamais réaffectés.
- Tests :
  - `dev-sandbox-v1-wiring` cherchait l'appel à `validationRunner` dans le texte du moteur. Il
    lit maintenant le moteur suivi du module des skills, avec la même expression.
  - Les suites Native DEV concernées passent : 59/59.
  - `test/native-dev-implementation-modules.test.js` vérifie :
    - les mêmes exports publics ;
    - les aides pures ;
    - la construction des opérations ;
    - le refus d'une dépendance manquante.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `goal-mode-run-state.js` (1 975 → 1 343)

- Fichier plat, composé de fonctions et de constantes de module. Le bloc qui va de `VERSION`
  à `normalizeUsage` part dans `services/goals/goal-mode-run-state-rules.js`. Il contient :
  - la version et les statuts ;
  - les transitions autorisées et les bornes ;
  - les primitives de validation ;
  - les validateurs d'exécution, de réservation, de planification, de contrat et d'usage.
- `goal-mode-run-state.js` garde la création, les transitions, l'usage, les réservations et
  `assertGoalModeRunForward`. Il réexporte les mêmes constantes.
- Contrôle : 59 déclarations comparées jeton par jeton, toutes identiques.
- **Piège rencontré, et désormais contrôlé** : le bloc utilisait `crypto.createHash`. Node
  expose aussi un `crypto` global (Web Crypto, sans `createHash`), donc le lint ne signalait
  aucune variable manquante. 36 tests ont échoué tant que le module n'importait pas
  `node:crypto`.
  - Correction : import explicite.
  - Tous les modules créés pendant V3-L7 ont été vérifiés : aucun autre n'utilise
    `crypto.` sans l'importer.
- Tests :
  - suites existantes de l'état des runs : 87/87 ;
  - `test/goal-mode-run-state-modules.test.js` vérifie les mêmes constantes réexportées, des
    constantes figées et une empreinte de réservation stable.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `orchestration/ask-ai.js` (1 728 → 1 358)

- `askAI` est une seule fonction de 1 650 lignes, faite de branches successives à retour
  anticipé. Deux branches en sortent vers `services/orchestration/ask-ai-deterministic-reads.js` :
  - la lecture déterministe de l'agenda (218 lignes) ;
  - la lecture des emails récents (155 lignes).
- Conditions vérifiées avant le déplacement :
  - chaque branche se termine par un `return` sur tous ses chemins (analyse du flot de
    contrôle) ;
  - aucune n'écrit dans une variable de `askAI` ;
  - aucune n'utilise `this` ni `arguments`.
- Chaque branche devient une fonction asynchrone. `askAI` l'appelle à la même place par
  `return handle…({ … })`, en lui passant exactement ses captures :
  - Agenda : `calendarConnector`, `calendarNormalized`, `sessionId`, `setSessionActivity` ;
  - Email : `gmailConnector`, `sessionId`, `setSessionActivity`.
- Contrôle des jetons : les deux corps sont identiques, et le reste de `ask-ai.js` aussi, à ces
  deux appels et à un import près.
- `skillContext` (214 lignes, 33 captures) et l'appel à l'orchestrateur restent dans `askAI`.
  Les déplacer aurait demandé de longues listes d'arguments pour un faible gain.
- Tests :
  - le nouveau module est ajouté aux sources lues par les tests de câblage ;
  - suites du chat, de l'agenda et de Gmail : 815/815 ;
  - `test/ask-ai-deterministic-reads.test.js` vérifie :
    - qu'un connecteur en échec donne une réponse, sans exception ;
    - la boîte vide ;
    - l'activité attribuée à la bonne session ;
    - l'appel à la même place.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `goal-mode-next-step-planner.js` (1 695 → 1 400)

- Le bloc qui va de `VERSION` à `assertRunSnapshot` part dans
  `services/goals/goal-mode-next-step-primitives.js`. Il contient :
  - la version, les statuts de jalons et les clés de proposition ;
  - `fail`, `deepFreeze`, `canonical`, `fingerprint`, `requiredString`, `strictObject` ;
  - le contrôle de l'instantané de run.
- Le planificateur garde la sélection de cible, la validation des propositions et la fabrique.
  Il réexporte les mêmes constantes.
- Contrôle : 28 déclarations comparées jeton par jeton, toutes identiques.
- L'empreinte utilise `crypto` sur deux lignes (`crypto` puis `.createHash`). Le contrôle des
  imports par expression régulière ne voyait pas ce cas : il est maintenant fait sur les
  jetons, pour tous les modules créés pendant V3-L7. Seuls deux modules de routes semblaient
  en faute ; ils reçoivent `crypto` par leurs dépendances, fourni par la composition des
  routes (`node:crypto`).
- Tests :
  - suites du planificateur : 47/47 ;
  - `test/goal-mode-next-step-modules.test.js` vérifie :
    - les mêmes constantes ;
    - une forme canonique stable ;
    - une empreinte `sha256` déterministe ;
    - le gel profond.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `security/dev-process-runner.js` (1 667 → 1 278)

- Le bloc qui va de `SANDBOX_LEVELS` à `deepFreeze` part dans
  `services/security/dev-process-sandbox-primitives.js`. Il contient :
  - les niveaux, les statuts et les capacités OS ;
  - les limites par défaut et maximales, et les clés de contrat ;
  - `DevProcessRunnerError`, les contrôles de clés et l'empreinte ;
  - la racine existante canonique et la résolution d'exécutable ;
  - l'environnement minimal ;
  - la normalisation des limites, des capacités et de l'autorité ;
  - le gel profond.
- Aucune règle du bac à sable n'est modifiée.
  - Le contrat d'exécution (`createSandboxExecutionContractV1`) et le runner restent dans
    `dev-process-runner.js`.
  - Celui-ci réexporte les mêmes valeurs : les identités sont vérifiées.
- Contrôle : 24 déclarations comparées jeton par jeton, toutes identiques.
- Tests :
  - suites du runner et du bac à sable : 67/67 ;
  - `test/dev-process-sandbox-primitives.test.js` vérifie :
    - les mêmes identités exportées ;
    - un environnement minimal sans variable secrète ;
    - des limites figées ;
    - l'erreur typée.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `orchestration/noon-orchestrator.js` (1 643 → 1 475)

- Trois fonctions internes de `createNoonOrchestrator` sont déplacées telles quelles. Chacune
  passe dans une petite fabrique qui reçoit exactement ce qu'elle utilisait :
  - `orchestrator-intervention.js` : `applyInterventionDecision`, avec
    `interventionPermissionEngine` ;
  - `orchestrator-results.js` : `specialistProposalResult` et `finalResult`, avec `now`,
    `observability` et `trace`.
- `trace` reste dans l'orchestrateur. C'est une déclaration hissée : la passer à la
  construction est sûr.
- Les opérations sont construites juste après `const pending = new Map()`, après les contrôles
  de dépendances et avant tout usage. Les paramètres concernés ne sont jamais réaffectés.
- Contrôle : 25 déclarations comparées jeton par jeton, toutes identiques. Aucun usage de
  `crypto` dans les nouveaux modules.
- Tests :
  - suites de l'orchestrateur : 55/55 ;
  - `test/orchestrator-modules.test.js` vérifie :
    - les opérations attendues ;
    - qu'aucune fonction n'est partagée entre deux constructions ;
    - le refus d'une dépendance manquante.

## 24/11/2026 — V3-L7, fichiers > 1 500 lignes : `decision/decision-support-engine.js` (1 613 → 1 187)

- Ce qui part dans `services/decision/decision-evidence-v2.js` :
  - `stable` et `fingerprint` ;
  - les autorités d'attestation et le rang des preuves ;
  - `sameScope`, `evidenceAttested`, `evidenceEligibilityV2` ;
  - l'éligibilité liée aux dépendances et la fusion des preuves.
- Le bloc ne dépendait que de `fingerprint` : le déplacer avec elle évite tout import
  circulaire.
- Le moteur garde les conflits, les contraintes, la comparaison V2 et la fabrique. Il réexporte
  les mêmes `fingerprint`, `evidenceAttested` et `evidenceEligibilityV2` : les identités sont
  vérifiées.
- Contrôle : 26 déclarations comparées jeton par jeton, toutes identiques. Le module importe
  `node:crypto`.
- Tests :
  - suites du moteur de décision : 145/145 ;
  - `test/decision-evidence-v2-modules.test.js` vérifie les mêmes identités et une empreinte
    indépendante de l'ordre des clés.
- **Bilan V3-L7** : plus aucun fichier de code au-delà de 1 500 lignes, que ce soit dans
  `services/`, `lib/`, `electron/`, `public/` ou `server.js`. Des fichiers de tests dépassent
  encore ce seuil.

## 24/11/2026 — V3-L7, fichiers de tests > 1 500 lignes

- Six fichiers de tests concernés :
  - `native-dev-core` : 2 744 lignes → trois fichiers ;
  - `workspace-terminal-service` : 2 123 → deux fichiers ;
  - `goal-mode-next-step-planner` : 2 121 → deux fichiers ;
  - `goal-dev-retry-chain-persistence` : 2 036 → deux fichiers ;
  - `goal-mode-dev-dispatch-service` : 1 694 → deux fichiers ;
  - `goal-mode-planning-call-service` : 1 632 → un seul fichier, son en-tête part dans les
    fixtures.
- Méthode, identique pour les six :
  - l'en-tête (imports, fonctions de préparation) part tel quel dans
    `test/helpers/<nom>-fixtures.js`. Seuls les chemins `require("../…")` deviennent
    `"../../…"` ;
  - les appels `test(...)` sont répartis dans l'ordre d'origine entre `<nom>.test.js`,
    `<nom>-2.test.js` et, pour `native-dev-core`, `<nom>-3.test.js` ;
  - chaque fichier recopie les `require` simples qu'il utilise et importe le reste des
    fixtures.
- Contrôle :
  - les 182 tests sont identiques jeton par jeton, dans le même ordre ;
  - chaque instruction d'en-tête est identique à l'original ;
  - aucune variable `let`/`var` au premier niveau, aucun `__dirname`, dossiers temporaires
    créés par `mkdtemp`. Les fichiers peuvent donc tourner dans des processus séparés.
- Aucune assertion n'a été modifiée.
- Documentation : `SANDBOX_V1_DESIGN.md` et `GOAL_MODE_DEV_EXECUTION.md` désignent désormais ces
  suites par un motif `*.test.js`. Les audits datés (`DEV_RULES_AUDIT.md`,
  `CODE_CONTEXT_AUDIT.md`) restent inchangés : ils rapportent des exécutions passées.
- **Critère V3-L7 « aucun fichier > 1 500 lignes »** : atteint pour le code et les tests.

## 24/11/2026 — V3-L0, A.4 (tranche 1) : `// @ts-check` sur la frontière IPC Electron

- Nouvelles dépendances de développement, en version exacte :
  - `typescript` 6.0.3 (Apache-2.0) : seule la 6.0 est compatible avec `typescript-eslint`,
    qui accepte `<6.1.0` ;
  - `typescript-eslint` 8.74.0 (MIT).
  - Installées par Arnaud le 24/11. Hors de `Noon.app` : Forge élague les devDependencies.
  - Jusqu'ici, TypeScript n'arrivait qu'en dépendance transitive de l'outillage Forge.
  - `@types/node` vient d'`electron`, qui en dépend directement.
- `tsconfig.check.json` (strict, `checkJs`, `noEmit`) liste les fichiers vérifiés. Il est lancé
  par `npm run typecheck`, branché à la fin de `npm run lint`.
- Même liste dans `eslint.config.js` : `@typescript-eslint/no-floating-promises` y est activée
  avec les informations de types. C'est la règle reportée par A.3.
  - Contrôle : une promesse non attendue ajoutée temporairement à `preload.js` est bien signalée.
  - Limite : l'analyse typée lit le fichier sur disque, donc `eslint --stdin` ne la déclenche
    pas.
- Fichiers de cette tranche :
  - `electron/preload.js` : type `NoonBridge` décrivant toute l'API `window.noon`, appliqué par
    `@satisfies`, et types des charges utiles (règles DEV, mémoire privée, aperçu DEV,
    partage, permissions locales). Ces types documentent le contrat ; `main.js` continue de
    revalider chaque entrée comme non fiable ;
  - `electron/production-hardening.js` : JSDoc du registraire IPC de confiance, des bornes de
    charge et du marqueur de démarrage.
- Aucun changement d'exécution : jetons identiques à HEAD, sauf deux parenthèses autour de
  l'objet passé à `Object.freeze`, nécessaires pour `@satisfies`.
- Nouveau `test/preload-bridge-contract.test.js` : il exécute le preload avec un module
  `electron` simulé et vérifie :
  - que l'API publiée est gelée et a exactement les clés de `NoonBridge` ;
  - que les 39 méthodes visent chacune un canal `noon:*` enregistré dans `electron/main.js` ;
  - les formes historiques des charges utiles ;
  - le filtrage de l'événement et le désabonnement des trois écouteurs.
- Reste à faire pour A.4 :
  - `electron/main.js`, avec ses handlers IPC (221 erreurs en mode strict) ;
  - les connecteurs, la sécurité, la mémoire.

## 24/11/2026 — V3-L0, A.4 (tranche 2) : `// @ts-check` sur `electron/main.js`

- Configuration (`tsconfig.check.json`) :
  - `checkJs: false` : seuls les fichiers portant `// @ts-check` sont vérifiés. Avec
    `checkJs: true`, `main.js` aurait entraîné `server.js` et tous les services ;
  - `useUnknownInCatchVariables: false` : convention JS du dépôt, où `catch (error)` lit
    `error.code`.
- Configuration ESLint : `ecmaFeatures.globalReturn` pour le parseur typé. Sinon, le premier
  niveau du fichier était lu comme une portée globale (`no-redeclare` sur `crypto`).
- `main.js` : de 153 erreurs en mode strict à 0.
  - Variables de module typées : fenêtres, contrôleurs, minuteries, secret local, journal.
  - Nouveau type `NoonServerController` : la surface de `server.js` utilisée par le main.
  - Paramètres des fonctions utilitaires typés.
  - Assertions ciblées, chacune avec sa justification :
    - fenêtre présente dans les écouteurs de `createWindow()` et dans les handlers IPC ;
    - secret local attribué avant toute requête locale ;
    - profil UI présent quand le mode UI est actif.
- JSDoc des signatures appelées par `main.js`, sans activer `@ts-check` sur ces fichiers :
  - `applyUiValidationProfile`, `createDevPreviewController`, `normalizeDevPreviewUrl` ;
  - `executeBenchmarkControlCommand`, `startOptionalStartupPhase` ;
  - constructeur de `WakeWordService`, `localPermissionStore.roots` ;
  - tuples de `FOCUS_CATALOG`.
- `no-floating-promises` a trouvé 6 promesses non attendues dans `main.js`. Elles sont
  désormais marquées `void` : le comportement est inchangé, ces promesses étaient déjà ignorées.
  - `startOptionalStartupPhase` (×2) : rejets déjà traités par `onRejected`.
  - `app.whenReady().then(...)`, dans la branche « commande benchmark invalide ».
  - `app.dock.show()`.
  - `mainWindow.loadURL` et `captureWindow.loadURL` : un échec de chargement n'est toujours
    pas journalisé. Point traité depuis : voir « Échecs de chargement des fenêtres journalisés ».
- Contrôle : jetons identiques à HEAD pour les 8 fichiers touchés, à trois ajouts près
  (24 paires de parenthèses d'assertion de type, les 6 `void`, des commentaires).
- Non couvert par le smoke Electron, qui s'arrête après `/health` : la création de la fenêtre,
  de la fenêtre de capture et de la barre de menus. Ces chemins reposent sur l'équivalence
  des jetons.
- Reste à faire pour A.4 : connecteurs, sécurité, mémoire.

## 24/11/2026 — V3-L0, A.4 (tranche 3) : `// @ts-check` sur les politiques de sécurité

- Sept fichiers de `services/security/` sont vérifiés en mode strict, puis par
  `no-floating-promises` : 219 erreurs au départ, 0 à l'arrivée.
  - Primitives : `audit-log`, `local-password-verifier`, `redaction`, `token-store`.
  - Politiques : `provider-privacy-policy`, `intervention-permission-engine`,
    `operational-security-policy`.
- Contrats désormais écrits en JSDoc :
  - `operational-security-policy` :
    - `ActionRequestInput` : la demande brute, chaque champ étant revalidé ;
    - `ActionRequest` : la demande normalisée, classification comprise ;
    - `SkillPolicy`, `PathDecision`, `PermissionResult`, `EvaluateInput` ;
    - les dépendances de la fabrique : règles dures, fiabilité, permissions, racines,
      observabilité ;
  - `provider-privacy-policy` : `ContextFragmentInput` et la requête d'accès fournisseur ;
  - `intervention-permission-engine` : `InterventionActionRequest` et l'entrée de `evaluate` ;
  - `token-store` : `SafeStorageLike`, le sous-ensemble de `safeStorage` utilisé ;
  - `local-password-verifier` : `PasswordVerifier`.
- Assertions ciblées, toutes commentées :
  - la demande littérale reçoit le type `ActionRequest`, puis la classification la complète ;
  - une demande déjà porteuse d'une empreinte est réutilisée telle quelle ;
  - `includes` sur des tableaux d'énumérations figées : 7 conversions vers
    `ReadonlyArray<string | undefined>` ;
  - `safeStorage` est présent quand `persistent` est vrai ;
  - `filter(Boolean)` retire bien les `null`.
- Les variables `outcome` et `riskLevel` sont annotées `string` : TypeScript les figeait sur
  leur valeur initiale (`"ALLOW"`, `"LOW"`).
- Aucune règle, aucun seuil, aucune décision ni aucun message n'a changé. Les jetons sont
  identiques à HEAD, à 16 paires de parenthèses d'assertion près.
- Validation :
  - tests : 2 978/2 978 ;
  - évaluations : `eval:critical` 54/54, `eval:privacy` 3/3, `eval:smoke` 99/99,
    `eval:delegation` 10/10.
- Reste à faire pour A.4 :
  - sécurité, tranche 4 : `dev-process-runner`, `dev-process-sandbox-primitives`,
    `dev-validation-runner` (131 erreurs) ;
  - connecteurs ;
  - mémoire.

## 24/11/2026 — V3-L0, A.4 (tranche 4) : `// @ts-check` sur les exécuteurs de processus DEV

- Trois fichiers vérifiés en mode strict, puis par `no-floating-promises` : 131 erreurs au
  départ, 0 à l'arrivée.
  - `dev-process-sandbox-primitives` ;
  - `dev-process-runner` ;
  - `dev-validation-runner`.
- `fail()` est annoté `@returns {never}`. TypeScript sait ainsi qu'il interrompt le flux,
  sans aucun changement de code. Les contrôles d'erreur restent ceux d'avant.
- Contrats désormais écrits en JSDoc :
  - `SandboxContractInput` : l'entrée de construction, revalidée ;
  - `SandboxExecutionContract`, déduit de `createSandboxExecutionContractV1` ;
  - `BoundedStream`, `WorkspaceContextSnapshot` ;
  - les dépendances du runner (`spawnProcess`, `resolveContext`, `revalidate`) ;
  - les options de `run` (`signal`, `onOutput`, `onSpawn`) ;
  - `DevProcessOutcome`, `ValidationContext`, `ValidationExecutor`, et les dépendances de
    l'exécuteur de validation.
- `isThenable` devient une garde de type (`value is PromiseLike<any>`), sans changement de code.
- Assertions ciblées, toutes commentées :
  - `resolveContext` et `revalidate` sont vérifiés à la construction ;
  - `pid` est entier quand `Number.isInteger` le confirme ;
  - index sur les limites figées ;
  - `includes` sur une liste de codes.
- Aucune règle du bac à sable n'a changé, pas plus que les limites, les codes d'erreur ou
  l'environnement minimal. Les jetons sont identiques à HEAD, à 6 paires de parenthèses près.
- Nouveau contrôle, appliqué à tous les fichiers typés depuis le début de A.4 : aucun
  commentaire multi-ligne placé juste après `return`, `throw` ou `yield`. Un tel commentaire
  déclencherait l'insertion automatique d'un point-virgule, que la comparaison des jetons ne
  voit pas.
- Validation :
  - tests : 2 978/2 978 ;
  - évaluations : `eval:critical` 54/54, `eval:privacy` 3/3, `eval:smoke` 99/99,
    `eval:delegation` 10/10.
- Reste à faire pour A.4 : connecteurs, mémoire.

## 24/11/2026 — V3-L0, A.4 (tranche 5) : `// @ts-check` sur les connecteurs

- Les neuf fichiers de `services/connectors/` sont vérifiés en mode strict, puis par
  `no-floating-promises` : 274 erreurs au départ, 0 à l'arrivée.
  - `base-connector`, `figma`, `github`, `gmail`, `google-calendar` ;
  - `google-auth`, `google-account` ;
  - `apple-notes`, `apple-reminders`.
- Nouveau fichier `types/noon-error.d.ts`, pour la vérification de types seulement (rien n'est
  chargé à l'exécution). Il déclare la convention du dépôt : un `Error` peut porter `code` et
  `status`. Cela évite d'annoter chaque `error.code = …`.
  - `eslint.config.js` ne retient que les fichiers `.js` de la liste de `tsconfig.check.json` :
    sans ce filtre, `npm run lint` analysait le `.d.ts`.
  - Le fichier est embarqué dans l'ASAR, car il n'est pas exclu du packaging. Il est inerte.
- Contrats désormais écrits en JSDoc :
  - `ConnectorDefinition` et `ConnectorDependencies` (le stockage des tokens, la fiabilité,
    les approbations, le runtime, `getGoogleAccessToken`) ;
  - `ProcessRunner` : un exécuteur au format `execFile`, injectable dans les tests ;
  - `providerFetch` ;
  - pour Google OAuth : `GoogleAuthError` (`reasonCode`, `oauthDiagnostic`,
    `profileDiagnostic`), `PendingGoogleState` (la transaction PKCE en mémoire),
    `GoogleClientConfig`, `OAuthFailure`.
  - `rejectGoogleAuthorization` est annoté `@returns {never}`.
- `google-account` reçoit ses dépendances de `server.js`, contrôlées à l'exécution par
  `DEPENDENCIES`. Elles sont typées `Record<string, any>`.
- Assertions ciblées, toutes commentées :
  - réponses JSON du fournisseur (`Record<string, any>`) ;
  - `req.url` présent sur une requête serveur ;
  - `signal` présent quand l'écouteur d'abandon est enregistré.
- Aucun scope OAuth n'a changé, ni l'approbation des écritures, ni le refus des écritures
  distantes (`REMOTE_WRITE_NOT_ENABLED`), ni l'exécution AppleScript ou EventKit. Les jetons
  sont identiques à HEAD, à 5 paires de parenthèses près. Aucun risque de point-virgule
  implicite.
- Validation :
  - tests : 2 978/2 978 ;
  - évaluations : `eval:critical` 54/54, `eval:privacy` 3/3, `eval:smoke` 99/99,
    `eval:remote` 8/8, `eval:offline` 7/7.
- Reste à faire pour A.4 : la mémoire.

## 24/11/2026 — V3-L0, A.4 (tranche 6) : `// @ts-check` sur la frontière mémoire — A.4 terminé

- Quatre fichiers, ceux de la frontière d'accès à la mémoire, sont vérifiés en mode strict puis
  par `no-floating-promises` : 261 erreurs au départ, 0 à l'arrivée.
  - `services/memory/memory-engine.js` : la façade `MemoryEngine` (A.6) ;
  - `services/memory/memory-writes.js` : le point d'écriture unique ;
  - `services/personal-memory/private-memory-service.js` : la mémoire privée chiffrée ;
  - `services/personal-memory/crypto.js` : AES-256-GCM et la clé maîtresse `safeStorage`.
- Contrats désormais écrits en JSDoc :
  - `PrivateMemoryServiceLike` et `StructuredRepositoryLike` : les méthodes utilisées, les
    enregistrements restant `Record<string, any>` ;
  - `OperationalProfileLike`, `MemoryChangeListener` ;
  - les dépendances de `createMemoryEngine` ;
  - les entrées de `search`, `getRelevantContext`, `proposeCandidate` et
    `resolveContextSource` ;
  - `ContextOptions`, les options normalisées, et `ReadCounts` ;
  - `SqliteDatabaseLike`, `PrivateMemoryInput` (revalidé par `validate()`) et
    `MemoryCipher`.
- `privateStatus()` renvoie une union discriminée (`available: true | false`). La raison
  d'indisponibilité est ainsi connue sans assertion.
- Assertions ciblées, toutes commentées :
  - service privé disponible après `privateStatus()` ;
  - `cipher` présent dans les fonctions internes, car le service s'est sinon déclaré
    indisponible (9 sites) ;
  - lignes SQLite décodées non nulles dans `listMemories`.
- Aucune règle de confidentialité n'a changé, pas plus que le filtrage des profils familiaux,
  la politique d'envoi distant, le chiffrement, l'audit, l'oubli ou la purge. Les jetons sont
  identiques à HEAD, à 11 paires de parenthèses près. Aucun risque de point-virgule implicite.
- Hors périmètre, non typés : le pipeline autonome, l'extracteur de candidats, les commandes
  conversationnelles, l'import de documents, la migration legacy, les routes HTTP mémoire et
  la composition.
- Validation :
  - tests : 2 978/2 978 ;
  - évaluations : `eval:critical` 54/54, `eval:privacy` 3/3, `eval:smoke` 99/99,
    `eval:migration`, `eval:recovery` et `eval:search` 1/1.
- **Bilan A.4** : `// @ts-check` est actif sur les quatre frontières, IPC, sécurité,
  connecteurs et mémoire, soit 26 fichiers JavaScript vérifiés par `npm run typecheck`. La règle
  `no-floating-promises`, reportée par A.3, est active sur ces mêmes fichiers.

## 24/11/2026 — Clé maîtresse de la mémoire privée : plus jamais régénérée par-dessus une clé existante

- Correction demandée par Arnaud.
- Le défaut, relevé pendant A.4 dans `loadOrCreateProtectedMasterKey`
  (`services/personal-memory/crypto.js`) : tout échec de lecture ou de déchiffrement générait
  une nouvelle clé et écrasait l'ancienne. Un trousseau verrouillé, une application re-signée ou
  un fichier corrompu rendaient donc définitivement illisibles les souvenirs privés déjà
  chiffrés.
- Nouveau comportement :
  - clé absente (`ENOENT`) : création comme avant, mais par écriture atomique (fichier
    temporaire `wx` en 0600, puis lien). Un arrêt brutal ne laisse plus de clé tronquée, et une
    clé apparue entre-temps n'est pas écrasée ;
  - clé présente mais illisible ou indéchiffrable, vide comprise : erreur
    `PRIVATE_MEMORY_KEY_UNREADABLE` (`stage` : `read` ou `decrypt`). Le fichier n'est jamais
    modifié.
  - La composition (`personal-memory-composition.js`) intercepte déjà cette erreur. La mémoire
    privée reste alors indisponible, comme lorsque le coffre macOS manque. L'audit
    `private-memory.unavailable` enregistre désormais `PRIVATE_MEMORY_KEY_UNREADABLE` et
    l'étape en cause, au lieu du seul `KEYSTORE_UNAVAILABLE`.
- Conséquence assumée : si la clé redevient lisible (trousseau déverrouillé, bonne signature),
  la mémoire privée revient au lancement suivant avec toutes ses données. Sinon, elle reste
  indisponible. Supprimer la clé, et perdre les souvenirs chiffrés, est une décision qui revient
  à Arnaud, jamais à Noon.
- Message affiché : `createPrivateMemoryService` accepte une raison facultative,
  `unavailableReason`, que la composition fournit quand la clé est illisible. L'interface affiche
  donc « Clé de la mémoire privée illisible : vos souvenirs sont conservés mais inaccessibles.
  Déverrouillez le trousseau macOS, puis relancez Noon. » au lieu de « Le coffre macOS est
  indisponible. ». Ce dernier message reste celui par défaut. Cas de test ajouté ; suite
  complète : 2 985/2 985.
- Tests : nouveau `test/private-memory-master-key.test.js`, 6 cas :
  - création, relecture et droits 0600 ;
  - clé indéchiffrable ;
  - clé corrompue ou vide ;
  - erreur de lecture ;
  - coffre indisponible ;
  - composition de bout en bout.
  - Lancés sur l'ancien code, 4 cas sur 6 échouent : l'ancien code écrasait bien la clé.
- Validation :
  - tests : 2 984/2 984 ;
  - évaluations : `eval:critical` 54/54, `eval:privacy` 3/3, `eval:smoke` 99/99,
    `eval:recovery` et `eval:migration` 1/1 ;
  - smoke Electron OK, sans clé créée dans le profil jetable.
- Non vérifié :
  - le vrai trousseau macOS, verrouillé ou avec une application re-signée ;
  - l'application packagée.

## 24/11/2026 — Échecs de chargement des fenêtres journalisés

- Point ouvert pendant A.4, tranche 2. `mainWindow.loadURL` et `captureWindow.loadURL` étaient
  marqués `void` : un échec de chargement n'était ni attendu ni journalisé. Cela arrive par
  exemple quand le serveur local est injoignable ou qu'une navigation est interrompue.
- Correction demandée par Arnaud :
  - chaque appel se termine par `.catch(logWindowLoadFailure("main" | "capture"))` ;
  - l'événement `window-load-failed` est écrit dans le journal local
    (`logs/noon.log`, avec masquage existant) ;
  - le détail contient seulement le type de fenêtre et le code d'erreur, sans URL ni message ;
  - le formatage est fait par `describeWindowLoadFailure` (`electron/app-core.js`, module
    pur, testé).
- Comportement inchangé par ailleurs : la fenêtre reste ouverte. Aucun message n'est affiché,
  et il n'y a ni nouvelle tentative ni fermeture. La rejection est désormais traitée au lieu
  d'être ignorée.
- Tests : deux cas ajoutés à `test/electron-app-core.test.js` :
  - le contenu du détail, et l'absence d'URL ou de jeton ;
  - le fait que chaque `loadURL` de `main.js` est suivi de ce journal.
- Validation :
  - tests : 2 987/2 987 ;
  - évaluations : `eval:critical` 54/54, `eval:smoke` 99/99, `eval:privacy` 3/3 ;
  - smoke Electron OK.
- Non vérifié : un échec réel de chargement dans Electron. Le smoke s'arrête avant la création
  des fenêtres.

## 24/11/2026 — Les tests ne remplissent plus le disque temporaire

- Le constat :
  - le disque était à 100 %, avec 1,2 Go libres, ce qui bloquait le build packagé ;
  - `$TMPDIR` contenait 116 077 dossiers `noon-*` (24,3 Go), laissés par les tests ;
  - mesuré avec un `TMPDIR` dédié, chaque `npm test` en laissait environ 950 (≈ 200 Mo),
    sur 135 préfixes. Il s'agit de dossiers `mkdtemp` jamais supprimés, créés par les tests
    ou par le code testé : worktrees de mission, journaux DEV, copies de benchmark.
  - C'est la cause probable des incidents « disque plein ».
- Nettoyage, avec l'accord d'Arnaud : suppression des dossiers `noon-*` du dossier temporaire
  modifiés depuis plus d'une heure. Résultat : 25 Go libres.
- Correctif : `test/helpers/temp-dir-cleanup.js`, préchargé par
  `node --require … --test` dans le script `npm test`.
  - `node --test` transmet ce `--require` à chaque processus de test.
  - Le module retient les dossiers créés par `fs.mkdtemp`, `fs.mkdtempSync` et
    `fs.promises.mkdtemp` directement sous `os.tmpdir()`, puis les supprime à la sortie du
    processus.
  - Les nettoyages explicites des tests restent en place. Aucune assertion n'a été modifiée.
- Mesure, sur une suite complète avec un `TMPDIR` dédié : 950 dossiers restants avant, 0 après.
  Seul subsiste `node-compile-cache`, le cache de Node lui-même. Tests : 2 988/2 988, le module
  compte pour une entrée vide.
- Limites :
  - un processus de test tué par un délai dépassé ne nettoie pas ;
  - un dossier créé autrement que par `mkdtemp` n'est pas suivi.
- Observation hors tests : `copySnapshot` laissait aussi une copie dans `os.tmpdir()` à chaque
  benchmark. Traitée depuis : voir « Copie témoin du benchmark supprimée ».

## 24/11/2026 — Build packagé validé ; fichiers locaux exclus de Noon.app

- Le disque libéré a permis de reconstruire `out/Noon-darwin-x64/Noon.app` avec
  `npm run package:mac:x64`. `/Applications/Noon.app` n'a pas été touché.
- Constat à l'inventaire de l'ASAR, que `verify:mac` ne signalait pas : `forge.config.js`
  n'excluait pas plusieurs fichiers locaux non suivis par Git, qui étaient donc embarqués.
  Le problème existait avant ce jour.
  - Fichiers de développement que la roadmap D.2 classe « interdits » :
    `benchmark-workspaces/` (48 entrées), `dev-task-journal/` (4 journaux),
    `dev-cost-ledger.json`, `.claude/launch.json` ;
  - état d'une exécution depuis le dépôt : `runtime-config.json` et `.lkg` (les réglages de
    flags locaux), `voice-identity.json`. L'application lit les siens dans `DATA_DIRECTORY`,
    c'est-à-dire dans userData ;
  - dossiers vides `.noon-data/` et `artifact-previews/` ;
  - outillage de typage d'A.4 : `types/`, `tsconfig.check.json`.
- Correctif : ces chemins ont été ajoutés à `packagerConfig.ignore`. `Workspace/` reste
  embarqué, puisque seul `Workspace/Temp` était déjà exclu volontairement.
  - Nouveau test dans `test/release-packaging.test.js` : il passe de vrais chemins aux règles.
    Les fichiers locaux doivent être exclus ; `server.js`, les services homonymes
    (`voice-identity.js`, `runtime-config-service.js`), `electron/` et `Workspace/` doivent
    rester embarqués.
- Validation du build reconstruit :
  - inventaire de l'ASAR : aucun chemin exclu présent ; les modules extraits pendant V3-L7,
    `crypto.js` corrigé et la journalisation des `loadURL` sont bien là ;
  - `npm run verify:mac` : PASS. Aucun bloquant, seul l'avertissement de signature
    attendu (build local non signé) ;
  - `npm run release:smoke` : PASS. Vrai binaire, profil `release`, userData isolé, serveur
    prêt en 1,07 s, `/health` en 2,05 s, sortie propre ;
  - `npm run lint` OK ; `npm test` 2 989/2 989.
- Ce que le smoke packagé ne couvre pas : il s'arrête après `/health`, sans fenêtre, sans
  modèle et avec le profil isolé. Restent à faire à la main :
  - installer ce build dans `/Applications` ;
  - ouvrir l'interface avec le vrai profil et obtenir une réponse à « Bonjour » (A.1).
- Note : lancé depuis le dépôt, le smoke charge le `.env` du dossier courant (4 variables
  injectées). Une application lancée depuis `/Applications` n'a pas ce dossier courant.

## 24/11/2026 — Copie témoin du benchmark supprimée

- Le défaut : dans `services/dev/dev-benchmark-service.js`, quand la fabrique d'espace de
  travail renvoie un simple chemin, le service crée une copie témoin
  (`copySnapshot` → `noon-benchmark-*` dans `os.tmpdir()`).
  - Cette copie ne sert qu'à l'empreinte de départ (`preparedWorkspace`) et n'était jamais
    supprimée : un dossier de plus par run de benchmark.
  - Cela ne concerne que le flag `dev.benchmark`, OFF par défaut.
- Correctif : la copie est supprimée juste après l'empreinte, y compris en cas d'échec
  (`try … finally`), et seulement si le service l'a créée lui-même. Une copie fournie par la
  fabrique (`{ workspace, peer }`) reste sous la responsabilité de celle-ci.
- Tests : deux cas dans `test/benchmark-workspace-lifecycle.test.js`, l'un pour un run normal,
  l'autre pour un workspace refusé. Chacun utilise un `TMPDIR` privé. Les deux échouent sur
  l'ancien code.
- Validation :
  - tests : 2 991/2 991 ;
  - évaluations : `eval:critical` 54/54, `eval:smoke` 99/99, `eval:delegation` 10/10.

## 24/11/2026 — Interface V3, étape 1 : barre de titre, pictos unifiés, Control Center plein écran

- Décisions d'Arnaud (24/11) :
  - interface simple et fonctionnelle, inspirée de Claude, en gardant l'esprit Noon ;
  - le mode DA/DEV suit le projet ;
  - l'accueil reste l'Assistant vocal ;
  - le Control Center s'ouvre en plein écran.
  - Découpage en 4 étapes : barre de titre et Réglages, regroupement du Control Center,
    colonne de gauche, mode DEV en panneaux.
- Système visuel commun (bloc « Interface V3 » à la fin de `public/style.css`) :
  - variables : encres, filets, survols, vert citron Noon ;
  - échelle d'espacements de 4 à 48 px ;
  - échelle typographique (11,5 · 12,5 · 13,5 · 15 · 22 px) et graisses d'interface 500 et 600,
    Montserrat conservée ;
  - pictos de 18 px dans des boutons de 32 px ; rayons de 8 px (contrôles) et 14 px (cartes) ;
  - focus visible homogène.
- Pictos : un seul jeu SVG (`<symbol>` en tête de `index.html`), au trait de 1,6 avec bouts
  arrondis, sur une grille de 24.
  - Ils remplacent l'engrenage pointillé, la flèche « ↥ », le « ＋ », le « ↑ », les symboles
    « ◎ » et « ☷ » du menu du champ de saisie, l'image de la pièce jointe et le chevron de la
    barre latérale.
  - Les barres audio animées sont gardées, affinées au même trait.
- Barre de titre : 52 px, fond légèrement dépoli, un filet.
  - Onglet actif en vert citron doux.
  - À droite, trois pictos : activité audio, partager, Control Center.
  - L'ancien bouton d'état (pastille) est masqué. Son état s'affiche désormais en pastille sur
    le picto du Control Center : vert prêt, ambre dégradé, orange arrêté.
- Le picto ouvre **directement** le Control Center sur l'onglet « Réglages ». Plus de menu
  déroulant.
  - Le contenu de l'ancien menu (`#quickSettings`, identifiants inchangés) a été déplacé dans
    l'onglet, avec deux nouvelles sections : « Voix et audio » et « Réponses ».
  - Mise en forme : sections en cartes, une ligne par réglage, interrupteurs, listes et
    champs homogènes.
  - `NoonControlCenter.open(section)` ouvre une section donnée. L'entrée « Réglages » du
    champ de saisie et le lien `noon://settings` y mènent ; `noon://diagnostic` mène à la
    section Diagnostics.
  - La fermeture au clic extérieur de l'ancien menu est supprimée. Échap est géré par la
    fenêtre du Control Center.
- Control Center plein écran, comme les réglages de Claude : en-tête de 60 px, navigation de
  248 px, contenu sur fond blanc.
- Champ de saisie : envoi noir à flèche vert citron, sélecteur de qualité neutre.
- Tests :
  - `test/top-menu-ui.test.js` adapté : il supposait que les réglages étaient un menu
    déroulant, ce qui n'est plus le cas ;
  - deux tests ajoutés : le picto ouvre l'onglet Réglages ; un seul jeu de pictos au trait ;
  - les tests qui figent l'ancien CSS (bleu du bouton d'envoi) restent : les nouvelles règles
    sont des surcharges placées après, comme dans le reste du fichier.
- Vérification visuelle :
  - aperçu local servant `public/` et le vrai `/app.js` ;
  - captures Electron 1440×900 de l'accueil et des Réglages (haut, milieu, bas) ;
  - comportements testés dans le navigateur intégré : ouverture directe, navigation,
    interrupteur, menu du champ de saisie, menu de partage ;
  - aucune erreur JavaScript.
- Validation :
  - lint OK ; tests 2 993/2 993 ;
  - évaluations : `eval:critical` 54/54, `eval:smoke` 99/99.
- Non vérifié : l'application réelle avec ses données (préférences chargées, vue d'ensemble
  du serveur) et l'application packagée.
- Relevé : deux réglages de brouillons Gmail se recoupaient. Traité à l'étape 2 : voir ci-dessous.

## 24/11/2026 — Interface V3, étape 2 : Control Center en groupes

- Navigation : « Réglages » en tête, puis cinq groupes titrés (`NAVIGATION_GROUPS` dans
  `public/control-center.js`) :
  - Aujourd'hui : vue d'ensemble, validations, travaux, objectifs, notifications ;
  - Intégrations : connexions, MCP, Figma, iPhone, appareils, synchronisation, extensions ;
  - Mémoire et confidentialité : mémoire, règles, permissions, confidentialité ;
  - DEV : Goal Mode DEV, missions, SelfDev, espaces de travail ;
  - Système : santé, fiabilité, capacité, hors ligne, configuration, sauvegardes, évaluations,
    diagnostics.
  - Une section non listée tombe dans « Système » : aucune n'est perdue.
  - Les sections restent celles que le serveur déclare disponibles. La vue « Avancée » garde
    son rôle.
- Vue d'ensemble : cartes rangées par les mêmes groupes, avec un titre par groupe.
  - Cartes, en-tête, pastilles et sections aux échelles de l'étape 1.
  - Les états sont affichés en français (Opérationnel, Dégradé, Indisponible, À configurer,
    Non autorisé, Connexion requise, Réussi…). L'état technique reste dans `data-state` et
    dans l'infobulle.
- Réglage mort retiré : « Créer automatiquement les brouillons Gmail » (`gmailAutoDrafts`).
  - Il n'était écrit que dans `localStorage` (`noonGmailAutoDrafts`) et relu nulle part :
    il ne commandait rien.
  - Le seul réglage effectif reste « Création automatique de brouillons Gmail »
    (`autoDraftsEnabled`, section Organisation). Il alimente `createGmailDrafts` du brief
    matinal.
  - La valeur existante dans `localStorage` n'est pas effacée.
- Tests :
  - les harnais de `goal-mode-dev-panel-visibility`, `mcp-connectors-ui` et `selfdev-sd4`
    ne lisent plus que les boutons de navigation, les titres de groupe étant intercalés ;
  - l'ordre attendu dans `mcp-connectors-ui` est adapté : MCP (Intégrations) précède désormais
    Goal Mode DEV (DEV) ;
  - nouveau `test/control-center-navigation-groups.test.js` (3 cas) : groupes et ordre,
    section inconnue rangée dans Système, picto ouvrant l'onglet Réglages actif.
- Vérification :
  - captures Electron de la vue d'ensemble (haut et bas), avec un instantané fictif servi par
    l'aperçu local uniquement ;
  - comportements testés dans le navigateur intégré.
- Validation :
  - lint OK ; tests 2 996/2 996 ;
  - évaluations : `eval:critical` 54/54, `eval:smoke` 99/99.
- Non vérifié : l'application réelle avec les vraies sections du serveur, et l'application
  packagée.

## 24/11/2026 — Interface V3, étape 3 : colonne de gauche simplifiée

- Nouvelle colonne, de 268 px au lieu de 300 :
  - le logo NOON ;
  - la navigation : Nouveau chat, Rechercher, Assistant vocal, Chat, Brief du jour,
    Personnel, Conversation Live ;
  - les Projets, puis les Récents (ancien « Chats »), ouverts par défaut ;
  - un pied compact : Focus et budget API.
- Ce qui a bougé, identifiants et classes conservés (le JavaScript est relié par
  `.view-btn`, `.mode-btn` et les identifiants) :
  - les quatre vues quittent la barre du haut et deviennent des entrées de la colonne ;
  - à leur place, la barre affiche le titre de la vue en cours (`#topBarTitle`) ;
  - le mode DA/DEV quitte la colonne pour un sélecteur compact dans la barre du haut.
    Le mode qui suit automatiquement le projet relève de l'étape 4 ;
  - « Conversation Live » perd son gros bouton bleu et devient une entrée de navigation :
    pastille neutre au repos, verte une fois connectée, orange en erreur ; coût affiché
    seulement pendant une session ;
  - le statut détaillé de Live reste annoncé aux lecteurs d'écran ;
  - les titres de section en capitales espacées disparaissent ; Focus, chevrons et rail
    replié reprennent le jeu de pictos de l'étape 1.
- Nouveau : « Rechercher » ouvre un filtre local sur les Récents.
  - Il filtre par titre, sans tenir compte des accents.
  - Les groupes de dates vides sont masqués, et le filtre est réappliqué quand la liste se
    rafraîchit.
  - Échap vide et ferme le champ.
  - Aucune requête n'est envoyée au serveur.
- Blocs déjà masqués par le CSS (Intégrations, actions en attente, automatisations,
  production, mode budget, activité, carte « Noon actif », journal de projet) : ils restent
  dans le DOM, car le JavaScript les alimente. Leur contenu est accessible dans le Control
  Center.
- Tests :
  - `conversation-projects-ui` adapté : il imposait « Projets après Chats », un ordre hérité
    du point d'étape V2 et documenté nulle part. L'ordre est désormais Projets puis Récents,
    comme dans Claude ;
  - nouveau `test/sidebar-ui.test.js` (4 cas) : ordre de la navigation, vues et mode
    déplacés, recherche, blocs masqués toujours présents.
- Vérification :
  - captures Electron de l'accueil et du Chat avec recherche ;
  - comportements testés dans le navigateur intégré : vues et titre de la barre, mode
    DA/DEV, recherche et Échap, colonne repliée et rail.
- Validation :
  - lint OK ; tests 3 000/3 000 ;
  - évaluations : `eval:critical` 54/54, `eval:smoke` 99/99.
- Non vérifié : l'application réelle avec de vrais chats et projets, et l'application
  packagée. L'en-tête de la vue Chat (« Conversation · Mode DA · Nouvelle session ») fait
  doublon avec la barre du haut : il sera revu à l'étape 4.

## 24/11/2026 — Conversation qui ne s'ouvrait pas au premier clic ; rythme de la colonne

- Bug signalé par Arnaud : une conversation ne s'ouvrait pas au premier clic ; il fallait
  passer par une autre conversation.
  - Cause : au lancement, Noon restaure l'identifiant de la dernière conversation
    (`noonSessionId`) sans charger son historique, et affiche l'Assistant vocal.
    `switchConversation` sortait sans rien faire pour la conversation déjà « courante ». Elle
    sortait aussi en silence quand une réponse était en cours.
  - Correctif (`public/app/09-conversations-projects.js`) : `conversationHistoryLoadedFor`
    retient la conversation réellement affichée. Un clic sur la conversation courante charge
    son historique si nécessaire, puis ouvre le Chat. Pendant une réponse, un message
    l'indique au lieu d'ignorer le clic.
  - Reproduit puis vérifié dans l'aperçu avec des conversations fictives : conversation
    restaurée au premier clic, autre conversation, retour, conversation de projet.
  - Non vérifié : un clic dans l'application réelle. Les lignes de la liste étant
    déplaçables, un léger mouvement pendant le clic peut encore être pris pour un glisser :
    à surveiller.
- Rythme vertical unifié dans la colonne :
  - lignes de 32 px pour les projets, les discussions et les menus, 34 px pour la
    navigation principale ;
  - titres de section de 28 px, 16 px entre deux sections ;
  - discussions d'un projet alignées sur le nom du dossier ;
  - « ⋮ » visible au survol seulement.
- Menus « ⋮ » des conversations et des projets, sous-menu « Déplacer vers le projet »
  compris : même surface, lignes de 32 px, texte en graisse normale, pictos du jeu unique
  (`noonIcon()`, nouveaux symboles `pencil`, `trash`, `chevron-right`), rouge réservé à
  « Supprimer ».
- Tests : deux cas ajoutés à `test/sidebar-ui.test.js`. Suite complète 3 002/3 002 ;
  `eval:critical` 54/54, `eval:smoke` 99/99.

## 25/11/2026 — Conversation Live : accueil d'Alexandra, Kaan et Sinan ; protection quand un enfant parle

- Demande d'Arnaud :
  - phrase d'accueil propre à Alexandra ;
  - phrase propre à Kaan et Sinan, gardée telle quelle quand l'un d'eux dit que c'est lui ;
  - quand un enfant parle, aucune donnée privée.
- Identification par déclaration seulement (« c'est Kaan »), jamais par empreinte vocale.
  Nouvel outil Realtime `set_noon_speaker` (`services/voice/live-speakers.js`). L'outil
  renvoie la phrase à prononcer mot pour mot (`say`).
- Quand un enfant est déclaré, restriction côté serveur (`voice-http-routes.js`) :
  - seuls `set_noon_speaker` et `set_noon_voice_style` restent utilisables ;
  - `ask_noon_brain`, les projets, le Focus et le mode répondent « restricted » sans rien
    exécuter ;
  - les instructions de la session sont remplacées par `session.update` (`live-voice.js`) :
    plus d'historique, de souvenirs ni de personnalité privée.
- La restriction dure jusqu'à la fin de la session Live. Dire ensuite « c'est Arnaud » ne la
  lève pas : il faut relancer Live.
- Limite assumée : ce n'est pas une authentification. Elle protège d'un accès accidentel,
  pas d'un enfant qui relance lui-même Live sans se déclarer. Les phrases familiales sont
  désormais dans le code du dépôt.
- Tests : `test/live-speakers.test.js` (5 cas : phrases exactes, enfant maintenu, session
  enfant sans historique ni souvenirs, refus serveur d'`ask_noon_brain`, Alexandra sans
  restriction). Suite complète 3 007/3 007 ; `eval:critical` 54/54, `eval:smoke` 99/99,
  `eval:privacy` 3/3.
- Non vérifié : comportement réel du modèle vocal (appel effectif de l'outil, phrase
  prononcée mot pour mot), test matériel au micro.

## 25/11/2026 — Interface V3, étape 4 : atelier DEV, mode par projet, en-tête du Chat allégé

- **Atelier DEV** : en mode DEV, l'aperçu (en haut) et le terminal (en bas) forment une
  colonne à droite du chat, comme dans Claude ou Codex.
  - La poignée verticale existante de l'aperçu sépare maintenant le chat de toute la colonne.
  - Le champ de saisie se recentre sur la colonne du chat.
  - Trois boutons dans la barre du haut, à gauche de DA/DEV : Terminal, Aperçu,
    Modifications (la vue Git du terminal, dont le bouton « Git » est masqué dans l'atelier).
  - Masquer un panneau ne ferme rien : la session du terminal continue, la page de l'aperçu
    reste chargée (seule la vue native est cachée).
  - Réduire et agrandir le terminal restent dans la colonne. Agrandi, il prend toute la
    colonne et l'aperçu est caché, comme avant.
  - En-tête du terminal compact dans l'atelier : actions sur une ligne, défilables si la
    colonne est étroite.
  - Sous 640 px de chat, l'ancienne disposition empilée reste en place (règles conservées).
  - Code : `public/app/12-dev-panes-layout.js` (nouveau morceau, ajouté à `APP_PARTS`),
    retouches ciblées de `02-dev-preview.js` et `03-dev-terminal-layout-problems.js`
    (hauteur maximale du terminal dans la colonne).
- **Retenu par projet Focus** (`localStorage`, préférence d'affichage seulement) :
  - largeur de la colonne : `noonDevPreviewWidth:<focusId>`, l'ancienne largeur globale
    servant de repli ;
  - panneaux masqués : `noonDevPanes:<focusId>`.
- **Mode DA/DEV par projet** : le mode choisi dans une conversation est retenu pour son
  projet (dossier de conversations, « Général » compris) et réappliqué quand on ouvre une
  conversation de ce projet ou qu'on en crée une. Sans mode retenu, le mode courant est
  conservé. Stockage : `noonProjectModes`, côté interface uniquement.
- **En-tête du Chat allégé** : « Conversation · Mode DA · Nouvelle session » disparaît
  (doublon de la barre du haut et de « Nouveau chat »). La barre affiche le titre de la
  conversation, ou « Nouveau chat ».
- Tests :
  - nouveau `test/dev-workspace-split-ui.test.js` (7 cas, dont colonne, panneaux masqués,
    fenêtre étroite, mémoire par projet, mode par projet, titre) ;
  - `test/sidebar-ui.test.js` adapté : il imposait le titre fixe « Chat », remplacé
    volontairement par le titre de la conversation.
  - Suite complète 3 014/3 014 ; `eval:critical` 54/54, `eval:smoke` 99/99.
- Vérifié dans l'aperçu (faux serveur, Focus fictif) : 1440×900 et 1000×800, les
  combinaisons de panneaux, réduire, agrandir, la poignée, le mode par projet.
- Non vérifié :
  - l'aperçu natif d'Electron positionné dans la colonne (ses bornes suivent la zone
    d'affichage, comme avant) ;
  - la vue Modifications avec une vraie session de terminal ;
  - l'application packagée.

## 25/11/2026 — Connecteurs MCP, phase 2 : écritures avec approbation exacte

- Pas de système parallèle : un outil MCP d'écriture coché par l'utilisateur est enregistré au
  niveau EXTERNAL, comme l'écriture Figma du plugin. Il passe donc par le même chemin que les
  autres écritures externes : ordre explicite, CONFIRMATION_REQUIRED, approbation exacte
  (arguments hachés, usage unique), puis exécution transactionnelle.
  - Défense en profondeur : l'outil refuse aussi lui-même de partir sans `confirmed`.
  - Outils destructifs (`destructiveHint`) : jamais exposés dans cette version, même cochés.
  - Un outil de lecture seule pas encore validé n'est pas un outil d'écriture : il reste dans
    la liste « lecture seule ». Défaut trouvé par le nouveau test, corrigé avant l'entrée.
- Carte d'approbation : nouveau champ facultatif `approvalDisplay(args)` sur les skills
  d'extension, transmis par l'orchestrateur à `prepareAction`.
  - Le moteur garde au plus 6 détails (libellé ≤ 40, valeur ≤ 4 000 caractères), en texte brut.
  - Pour MCP : titre « Serveur — outil », serveur (et projet), outil, arguments exacts en JSON.
  - La carte du chat les affiche avec `textContent`. Si l'affichage échoue, le résumé générique
    reprend.
- Journal : `mcp.write_tool_called` (serveur, outil, erreur oui/non), jamais les arguments.
- Catalogue (vérifié dans la documentation des fournisseurs le 25/11/2026) :
  - **Supabase** (`https://mcp.supabase.com/mcp`) : enregistrement dynamique de client
    accepté. Installation obligatoirement limitée à un projet : `project_ref`, 20 lettres,
    validé avant d'être ajouté à l'URL. Cela retire aussi les outils de gestion du compte.
    Capacité `REMOTE_SUPABASE`, donc bloqué en mode local uniquement ou hors ligne.
    `execute_sql` n'est pas en lecture seule : une requête peut écrire.
  - **Vercel** : listé « Indisponible ». Il n'accepte que les clients validés, ou ceux qui
    publient une identité de client (CIMD) sur une URL HTTPS ; Noon n'a ni l'un ni l'autre.
    Piste : publier un document CIMD.
  - **Resend** : pas ajouté. Je n'ai pas vérifié qu'il existe un serveur MCP distant officiel ;
    un serveur local (stdio) relèverait de la phase 4.
- Écran des connecteurs :
  - section « Outils d'écriture » à cocher, avec une confirmation explicite avant
    l'enregistrement ;
  - champ « Identifiant du projet » pour Supabase ; le bouton Installer reste inactif tant
    qu'il n'est pas valide.
- Compatibilité : un registre `mcp-servers.json` d'avant la phase 2 se relit sans erreur
  (aucun outil d'écriture).
- Tests :
  - nouveau `test/mcp-write-approval.test.js` (6 cas), contre un vrai serveur MCP de test
    (SDK officiel). Critère de fin vérifié : refusée ne part pas, approuvée part une fois avec
    les arguments exacts, rejouée refusée (`APPROVAL_CONSUMED`), arguments modifiés refusés
    (`APPROVAL_ACTION_CHANGED`).
  - 4 cas ajoutés à `mcp-connectors-ui` et 2 à `noon-orchestrator`.
  - Adapté : `mcp-client` (liste du catalogue allongée ; les routes reçoivent `readJsonBody`
    comme dans le vrai routeur).
  - Suite complète 3 026/3 026. Évaluations `critical` 54/54, `smoke` 99/99, `privacy` 3/3,
    `extensions` 5/5.
- Non vérifié :
  - une vraie connexion Supabase : OAuth réel, outils et annotations réels ;
  - le flux complet dans le chat avec le modèle (appels payants) ;
  - le flag `connectors.mcp` reste OFF par défaut.

## 25/11/2026 — Connecteurs MCP, phase 3 : serveur ajouté par URL, outils différés

- Une partie de la phase 3 existait déjà : état du serveur, choix des outils visibles,
  déconnexion avec suppression des jetons locaux, catalogue pré-rempli. Ajouté :
- **Serveur ajouté par URL** (`POST /api/mcp/servers`, en-tête Noon exigé) :
  - adresse HTTPS, ou loopback en HTTP (alors sans autorisation) ;
  - refusés : identifiants dans l'URL, fragment, paramètre qui ressemble à un secret
    (`key`, `token`, `secret`, `auth`, `pass`, `sig`…), car l'URL est stockée en clair dans
    `mcp-servers.json` ;
  - au plus 10 serveurs, sans doublon ; identifiant `custom-<8 hex>`.
  - Noon ne déclare aucun outil en lecture seule pour ces serveurs. Un outil n'y devient
    lecture seule que si le serveur l'annonce (`readOnlyHint`) ET que l'utilisateur le
    valide. Valider en lecture un outil non annoncé le laisse en écriture, donc masqué ou
    soumis à approbation.
  - Capacité `REMOTE_MCP_CUSTOM` : bloquée en mode local uniquement ou hors ligne.
  - Le journal note l'identifiant, jamais l'adresse.
  - La désinstallation supprime aussi la définition du serveur.
- **Outils différés** : au-delà de 8 outils visibles pour un serveur, ses outils sont
  enregistrés `deferred` et envoyés avec `defer_loading` derrière `tool_search`, déjà en place
  pour les skills rares. Sans `tool_search`, tout reste chargé, comme avant. L'écran l'indique
  (« trouvé par recherche d'outils »).
- Écran : section « Autre serveur » avec nom et adresse, et un avertissement de confiance ; les
  champs ne relancent pas le rendu à la frappe. Pour ces serveurs, les outils proposés en
  lecture seule sont ceux que le serveur annonce comme tels.
- Tests : nouveau `test/mcp-custom-servers.test.js` (5 cas) et 2 cas dans `mcp-connectors-ui`.
  Suite complète 3 033/3 033 ; `eval:critical` 54/54, `smoke` 99/99, `privacy` 3/3,
  `extensions` 5/5, `offline` 7/7.
- Non vérifié : un vrai serveur tiers ajouté par URL (OAuth, enregistrement dynamique), et
  `tool_search` avec le modèle réel.
- Reste pour MCP :
  - phase 4 : serveurs locaux (stdio), seulement avec une vraie isolation ;
  - phase 5 : plugins locaux ;
  - phase 6 : migration de Figma et GitHub ;
  - piste Vercel : publier un document CIMD.

## 25/11/2026 — Connecteurs MCP, phases 5 et 6 : plugins déclaratifs, GitHub par jeton personnel

- **Phase 4 (serveurs locaux stdio) mise en attente**, à la demande d'Arnaud.
  - Alternative proposée, moins risquée : Noon ne lance jamais de processus. Il se connecte
    seulement à des serveurs MCP qui écoutent en loopback HTTP, déjà possible (Figma bureau,
    serveur ajouté par URL en `http://127.0.0.1`). L'utilisateur ou l'application lance le
    serveur lui-même ; un serveur stdio peut passer par un relais HTTP local de son choix.
- **Phase 5 : plugins déclaratifs, sans code** (`services/mcp/mcp-plugins.js`, format
  `noon.plugin/1`, voir `docs/MCP_PLUGINS.md`).
  - Contenu : 1 à 5 serveurs MCP (mêmes règles qu'un serveur ajouté par URL) et une consigne
    d'au plus 1 500 caractères.
  - Pas le SDK d'extensions : il exige un module JavaScript exécuté dans Noon, ce qui
    reviendrait au risque de la phase 4.
  - Un plugin ne peut ni déclarer d'outils en lecture seule, ni cocher d'outils d'écriture ; un
    champ inconnu fait refuser tout le plugin.
  - Installation tout ou rien. Les serveurs sont rattachés au plugin (`pluginId`) et retirés avec
    lui. 10 plugins au plus. Le fichier est revalidé au démarrage.
  - Consigne transmise au modèle par `mcpPluginGuidance` (nouvelle dépendance de `createAskAI`),
    présentée comme venant de l'utilisateur et subordonnée aux règles de Noon (4 000 caractères
    au plus en tout). Seulement si un serveur du plugin est encore installé.
  - Routes `GET`/`POST /api/mcp/plugins`, `DELETE /api/mcp/plugins/:id`, en-tête Noon exigé.
  - Écran : import d'un fichier JSON lu localement, relu (serveurs, adresses, consigne) avant tout
    envoi, installation sur confirmation.
  - Pas de place de marché : le gel de la « SDK marketplace » est respecté.
- **Phase 6 : migration progressive.**
  - **GitHub** (`https://api.githubcopilot.com/mcp/`) : vérifié le 25/11/2026, il accepte un
    jeton d'accès personnel de tout client, mais n'offre pas l'enregistrement dynamique OAuth.
    - Nouveau mode d'authentification `token` : jeton saisi dans le Control Center, validé,
      chiffré dans le coffre safeStorage (`mcp:<serveur>`), envoyé seulement en en-tête
      `Authorization` à ce serveur.
    - Il n'est jamais renvoyé à l'interface ni journalisé ; le champ est masqué, vidé à l'envoi,
      et la déconnexion supprime le jeton.
    - Un refus 401 ou 403 donne `MCP_TOKEN_REJECTED`.
    - Capacité `REMOTE_GITHUB` (existante). Lecture seule seulement d'après `readOnlyHint`,
      validé par l'utilisateur.
    - Le connecteur GitHub natif reste en place : pas de bascule tant que le serveur MCP n'a pas
      été utilisé en vrai.
  - **Figma** : rien à migrer. Son serveur en ligne refuse Noon ; le serveur de l'application
    de bureau (lecture) est déjà au catalogue, et l'écriture passe par le plugin Noon Bridge.
- Tests : nouveau `test/mcp-plugins-and-token.test.js` (9 cas, dont un vrai serveur MCP de test
  qui exige le jeton) et 3 cas dans `mcp-connectors-ui`. Adapté : liste du catalogue dans
  `mcp-client`. Suite complète 3 045/3 045 ; `eval:critical` 54/54, `smoke` 99/99,
  `privacy` 3/3, `extensions` 5/5, `offline` 7/7.
- Non vérifié :
  - un vrai jeton GitHub sur le serveur officiel ;
  - un vrai plugin avec des serveurs tiers ;
  - la consigne de plugin face au modèle réel.

## 25/11/2026 — Conversation Live démarre à l'ouverture de Noon

- Demande d'Arnaud : Live toujours actif à l'ouverture, avec la phrase « Salut Noon, par quoi on
  commence aujourd'hui ? ». Faute de réponse aux questions sur le coût et sur la phrase, la
  demande est appliquée telle qu'écrite, avec des garde-fous.
- Réglage « Démarrer Conversation Live à l'ouverture de Noon » (Réglages → Voix et audio),
  **activé par défaut**, désactivable. Préférence d'interface en `localStorage`
  (`noonLiveAutoStart`), sans nouvelle IPC.
- Règle de décision (`shouldAutoStartLive` dans `public/live-voice-core.js`, testée) :
  - seulement dans l'application, jamais dans un navigateur ni en test, pour ne pas ouvrir de
    micro d'office ;
  - une fois par lancement : un rechargement de la fenêtre ne relance pas Live ;
  - pas si le budget vocal est bloqué ;
  - pas en Qualité Max, qui exige une confirmation de son coût.
  - Le réveil du Mac ne rouvre jamais le micro (règle existante conservée).
- Phrase prononcée mot pour mot par `response.create`, seulement pour la session de lancement.
- Coût borné par la coupure existante après deux minutes sans parler (et vingt minutes au plus).
- Conflit avec le mot de réveil « Salut Noon » vérifié : le processus principal coupe déjà
  l'écoute du mot de réveil pendant Live (`liveVoiceActive`). Noon ne se réveille donc pas en
  s'entendant.
- Accueil des proches (Alexandra, Kaan, Sinan) : inchangé ; il suit l'ouverture quand la personne
  dit qui elle est.
- Tests : nouveau `test/live-auto-start.test.js` (4 cas). Suite complète 3 049/3 049 ;
  `eval:critical` 54/54, `smoke` 99/99, `privacy` 3/3.
- Non vérifié :
  - au lancement réel de Noon.app : autorisation micro, phrase prononcée, sortie audio ;
  - avec le mot de réveil activé.

## 25/11/2026 — Langue et accent de Live visibles dans les Réglages

- Constat : ils étaient déjà branchés. L'outil oral `set_noon_voice_style` les change, ils sont
  conservés et envoyés à la session. Mais depuis l'étape 3 de l'interface, ce n'étaient plus que
  deux champs cachés : impossible de voir ou de remettre à zéro une session restée « en
  anglais » autrement qu'à la voix.
- Décision : les brancher dans Réglages → Voix et audio.
  - Une liste des 10 langues reconnues par le serveur (`SUPPORTED_LANGUAGES`, Automatique
    compris) et un champ d'accent (vide = aucun).
  - Mêmes identifiants (`liveVoiceLanguage`, `liveVoiceAccent`) : le module Live, ses écouteurs
    et le réglage oral fonctionnent sans changement.
- « none » s'affiche comme un champ vide ; une langue enregistrée inconnue revient à
  Automatique.
- Tests : nouveau `test/live-voice-style-settings.test.js` (3 cas). Suite complète 3 052/3 052.
- Non vérifié : changement de langue pendant une vraie session Live.

## 25/11/2026 — Pastille de Conversation Live ronde ; sélecteur « Vue » du Control Center retiré

- Pastille de Conversation Live (colonne de gauche) : elle était ovale, 9 × 6 px. La règle de la
  colonne fixait 6 px, mais une ancienne règle lui imposait une base flex de 9 px de large.
  Correctif : `flex:0 0 6px` et `aspect-ratio:1`.
- Sélecteur « Vue : Utilisateur / Avancée » : la vue avancée n'ajoutait que des marqueurs
  `[DOSSIER_LOCAL]` aux espaces de travail et la source des réglages, deux champs que l'écran
  n'affiche pas. Aucune différence visible : retiré de l'interface (décision d'Arnaud :
  « supprime-le s'il n'est pas utile »).
  - L'API garde son paramètre `view` ; l'interface demande toujours `USER`.
- Tests : un cas dans `sidebar-ui`, un dans `control-center-navigation-groups` (toutes les
  requêtes en `view=USER`). Suite complète 3 054/3 054.

## 25/11/2026 — V3-L1 validé : charte de caractère à 30/30

- Passage `npm run eval:character -- --run` du 25/11 :
  - charte 2026-11-22.1, modèle gpt-5.6-terra, cadrans par défaut ;
  - 30 cas, coût réel 0,125 USD (estimé 0,235) ;
  - seuls les cas de test inventés sont envoyés.
- Notation par Arnaud, à partir d'une page de relecture (situation, réponse, attendu, signaux
  d'échec) générée localement dans `.noon-evals/character/`, puis enregistrée dans le fichier du
  passage (`gradedBy`) : **30/30 réussis, 100 %** ; verdict `PASS` (seuil 90 % sur 30 cas).
- Réserve d'évaluation, sans effet sur la note : la réponse C2-04 (tableau de 80 lignes) est
  coupée par la limite de 900 jetons de sortie de l'évaluation, pas par Noon.
- Conséquences :
  - L1 est validé ; C.1 à C.7 sont cochés dans la roadmap ;
  - L8 (Recorder), qui ne dépend que de L1, peut démarrer ;
  - L3 attend encore le critère de L2 (deux semaines d'usage du Brief).

## 25/11/2026 — V3-L8 démarré : Recorder V1, tranche E.1 + E.5 (enregistrement local, consentement)

- L8 démarre après la validation de L1 (seule dépendance). L3 attend toujours le critère de L2.
- Flag `recorder.v1` (OFF par défaut, désactivé en validation UI et en smoke).
- Service : `services/recorder/recorder-service.js` (routes `/api/recorder/sessions`, en-tête Noon
  exigé pour toute écriture).
  - Stockage : `recordings/<id>/` dans le dossier de données (dossiers 0700, fichiers 0600),
    `meta.json` et `audio.webm`. Rien n'est envoyé sur le réseau.
  - Sauvegarde progressive : un morceau toutes les 5 s, numéroté. Un morceau rejoué est ignoré,
    un trou est refusé. Au plus 2 Mo par morceau et 500 Mo par enregistrement ; côté interface,
    arrêt automatique à 4 h.
  - Pause et reprise horodatées (`events`) ; la durée exclut les pauses. Ces repères serviront
    aux horodatages du résumé (E.3).
  - Une session restée active au redémarrage (plantage, Mac éteint) devient « interrompue », avec
    l'audio conservé jusqu'au dernier morceau reçu.
  - Un seul enregistrement actif à la fois. Suppression seulement d'un enregistrement arrêté,
    après confirmation dans l'interface.
  - E.5 : à plusieurs, la case « J'ai prévenu les participants, et ils sont d'accord » est
    obligatoire, et le serveur refuse sans elle (`RECORDER_CONSENT_REQUIRED`).
  - Journal : identifiant, taille et durée seulement, jamais le titre.
- Interface : `public/recorder-ui.js`.
  - Panneau « Enregistreur » dans le groupe Aujourd'hui du Control Center : nouvel
    enregistrement, liste, lecture, suppression.
  - Voyant dans la barre du haut, visible partout : durée, Pause/Reprendre, Arrêter.
  - Le micro choisi dans les réglages est respecté, sans repli silencieux (décision du 21/11).
  - Si la sauvegarde échoue deux fois de suite, l'enregistrement s'arrête avec un message
    honnête.
- Tests : `test/recorder-service.test.js` (6 cas, dont de vraies requêtes HTTP) et
  `test/recorder-ui.test.js` (6 cas, avec un faux micro). Suite complète 3 066/3 066 ;
  `eval:critical` 54/54, `smoke` 99/99, `privacy` 3/3.
- Non vérifié :
  - un vrai enregistrement dans Noon.app (autorisation micro, fichier lisible après pause et
    reprise) ;
  - l'application packagée.
- Reste pour L8 :
  - E.2, transcription (décision d'Arnaud attendue : whisper.cpp local ou cloud avec
    consentement) ;
  - E.3 (résumé horodaté) et E.4 (export DOCX, dépendance `docx` déjà présente) ;
  - critère de sortie : une réunion réelle donne un DOCX fidèle.

## 25/11/2026 — Recorder V1, E.2 : transcription par OpenAI avec accord par enregistrement

- Choix d'Arnaud : la transcription passe par OpenAI, avec son accord pour chaque
  enregistrement (rapide, environ 0,006 $ par minute ; l'audio sort du Mac). whisper.cpp en
  local est reporté : il demanderait un binaire natif, un modèle à télécharger, et serait lent
  sur Mac Intel.
- Modèle `whisper-1` en `verbose_json` avec passages horodatés, nécessaires au résumé (E.3).
  `gpt-4o-mini-transcribe`, utilisé pour les courtes dictées, ne donne pas d'horodatages.
- Accord : le bouton « Transcrire avec OpenAI · coût estimé » ouvre un encadré qui précise quel
  audio part (titre, durée, taille), où il va, que le texte reste sur le Mac, et le coût. Rien
  ne part avant « Envoyer à OpenAI et transcrire ». Le serveur exige `consent: true` et horodate
  l'accord (`transcription.consentAt`).
- Refus sans appel : mode local uniquement ou hors ligne (capacité `REMOTE_TRANSCRIPTION`),
  budget mensuel atteint, enregistrement en cours, fichier au-delà de 24 Mo (limite d'envoi
  d'OpenAI).
  - Les nouveaux enregistrements passent à 32 kbit/s, assez pour la voix : environ 1 h 40 tient
    sous cette limite. Le découpage des réunions plus longues viendra plus tard.
- Le texte et les passages restent sur le Mac (`transcript.json`, 0600) ; le journal n'en
  contient rien.
  - Un échec laisse l'audio intact et permet de réessayer.
  - Une transcription restée « en cours » au redémarrage passe en échec (`INTERRUPTED`).
- Budget exact : `trackTranscriptionUsage` accepte un prix par minute ; l'écart avec le tarif de
  base (0,003 $) s'ajoute au coût du mois. Les appels existants sont inchangés.
- Interface : une transcription terminée s'ouvre passage par passage, chacun avec son
  horodatage, et le texte peut se copier.
- Tests : nouveau `test/recorder-transcription.test.js` (5 cas) et un cas d'interface.
  Suite complète 3 072/3 072 ; `eval:critical` 54/54, `smoke` 99/99, `privacy` 3/3.
- Non vérifié : un vrai appel à OpenAI avec un vrai enregistrement (payant).
- Reste pour L8 :
  - E.3, résumé, décisions et actions reliés à un horodatage ;
  - E.4, export DOCX ;
  - critère de sortie : une réunion réelle donne un DOCX fidèle.

## À trancher

- Rien pour l'instant.
