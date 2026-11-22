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

## À trancher

- Réglages langue et accent de Live : à brancher ou à retirer de l'interface.
