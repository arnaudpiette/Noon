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

## À trancher

- Réglages langue et accent de Live : à brancher ou à retirer de l'interface.
