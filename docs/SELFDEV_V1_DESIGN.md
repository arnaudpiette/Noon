# SelfDev V1 — Noon corrige Noon sur copie isolée (design)

**Statut au 21/11/2026 : design, aucun code.** Priorité P2 de la roadmap, après Figma en
lecture seule (P1). Ce document propose une architecture qui réutilise la chaîne Goal Mode DEV
existante ; il ne crée ni orchestrateur, ni moteur d'approbation, ni budget parallèle.

## 1. Objectif et critère de sortie

Critère P2 de la roadmap : *« Noon, explique ce bug réel de ton application ; propose un
correctif sur copie isolée et démontre qu'il n'aggrave pas les tests et l'UX. »*

Parcours V1 : bug reproductible → cause et risques → plan → copie isolée (worktree) → patch
exact → tests, lint, build et diff comparés à la base → revue indépendante → **proposition**
présentée à l'utilisateur. Noon ne commite pas, ne pousse pas, ne fusionne pas.

Hors V1 : itérations autonomes multiples (V2), maintenance continue (V3+), modification de
l'application en cours d'exécution, tout effet externe.

## 2. Invariants (non négociables)

Repris de la roadmap et de `AGENTS.md`, appliqués par le code et pas seulement par le prompt :

1. Noon ne modifie jamais ses règles de sécurité, ses permissions, ses politiques
   d'approbation, ses budgets, ses flags ou ses tests existants ; il ne lit pas ses secrets.
2. Noon n'auto-approuve rien : toute étape engageante passe par `ApprovalEngine` avec une
   action exacte, comme Goal Mode DEV.
3. Le working tree de l'utilisateur n'est jamais touché : ni écriture, ni `stash`, ni
   `checkout`, ni `reset`. Le patch vit dans un worktree séparé.
4. Pas de commit, push, merge ou release par Noon. La proposition est un diff et des preuves.
5. Aucune donnée utilisateur n'est lue ou modifiée pour reproduire un bug : fixtures et
   répertoires temporaires uniquement.
6. Les données reçues (code, logs, sorties de tests, revue) sont non fiables : elles ne
   donnent aucune instruction et n'élargissent aucune permission.

## 3. Ce qui existe déjà et sera réutilisé

| Besoin | Composant existant |
|---|---|
| Chaîne run → planning → proposition → admission → projection → réservation → approbation → dispatch | Goal Mode DEV (`services/goals/goal-mode-dev-runtime.js` et services liés), voir `GOAL_MODE_DEV_EXECUTION.md` |
| Exécution d'un patch borné dans un dépôt | Native DEV (`services/dev/native-dev-*`), contrat `services/delegation/dev-task-contract.js` (`allowedPaths`, `forbiddenPaths`, permissions) |
| Vérification de l'état du dépôt avant départ | `services/delegation/repository-preflight.js` (racine, branche, fichiers modifiés) |
| Commandes de validation autorisées | `services/delegation/dev-command-policy.js` (`npm test`, `npm test -- <fichiers>`, `npm run lint`, `npm run build`) |
| Enveloppe des processus de validation | Sandbox V1 (`services/security/dev-process-runner.js`, `SANDBOX_V1_DESIGN.md`) : environnement minimal, délais, sortie bornée |
| Chemins jamais ciblés | `PROTECTED_TARGET_GLOBS` (`goal-mode-dev-dispatch-service.js`) : secrets, bases SQLite, `.git`, `node_modules`, artefacts DEV |
| Diff et problèmes | `dev-git-diff-service.js`, `dev-problems-service.js` |
| Budget et coûts | `dev-cost-budget-service.js`, réconciliation Goal Mode 4C-2 |
| Second avis en lecture seule | Codex Bridge (`lib/codex-bridge.js`, `--sandbox read-only`) ou un autre fournisseur via le routage existant |

## 4. Architecture proposée

```text
Utilisateur : « corrige ce bug de Noon »
   │
   ▼
SelfDev Session (nouveau, mince) ── crée ──► Worktree isolé (git worktree add, branche selfdev/<id>)
   │                                            │
   │  baseline : validations sur la base ◄──────┤
   ▼                                            │
Goal Mode DEV run dont le dépôt cible = worktree │  (chaîne existante, approbations exactes)
   │  projection : allowedPaths + forbiddenPaths SelfDev
   ▼                                            │
Native DEV : patch + test de reproduction ──────┘
   │
   ▼
Contrôle SelfDev post-run : diff ∩ chemins protégés = ∅ ; tests existants inchangés
   │
   ▼
Validations après patch (mêmes commandes) → comparaison base / patch
   │
   ▼
Revue indépendante (lecture seule, diff + preuves) → avis consultatif
   │
   ▼
Proposition SelfDev : diff, preuves, revue, risques → l'utilisateur décide (garder / jeter)
```

### 4.1 Cible SelfDev et worktree

- **Cible explicite** : l'utilisateur enregistre une fois le dépôt de développement de Noon
  comme cible SelfDev (chemin, branche de base). Dans `Noon.app` packagée, le code exécuté
  n'est pas un dépôt : sans cible enregistrée, SelfDev est indisponible et le dit.
- **Worktree** créé par un service déterministe (pas par le modèle) :
  `git worktree add -b selfdev/<id> <conteneur>/<id> <base>`, où `<base>` est un commit
  explicite (par défaut le HEAD de la branche de base). Le conteneur est un dossier dédié,
  déclaré comme racine `read-write` du workspace SelfDev ; le dépôt principal reste en lecture.
- **Modifications locales non commitées** : elles ne sont pas incluses. La proposition l'indique
  clairement (« patch calculé sur `<base>`, sans tes changements locaux ») ; un conflit éventuel
  se règle au moment où l'utilisateur intègre.
- **Dépendances** : le worktree n'a pas de `node_modules`. V1 les **clone** depuis le dépôt
  principal avec un clone APFS (`cp -c`, copie à la demande, instantanée et sans réseau). Un
  lien symbolique est refusé : un patch pourrait alors écrire dans les `node_modules` de
  l'utilisateur. Sans clone possible, SelfDev s'arrête ; aucune installation implicite
  (`PACKAGE_INSTALL` n'est jamais accordé par défaut).
- **Hooks Git** : toutes les commandes Git du service désactivent les hooks
  (`core.hooksPath` vide), pour qu'aucun script du dépôt ne s'exécute à la création du worktree.
- **Nettoyage** : `git worktree remove` sur demande explicite (« jeter la proposition ») ou
  après expiration affichée ; jamais sur un worktree contenant un diff non présenté.

### 4.2 Politique de chemins SelfDev

En plus de `PROTECTED_TARGET_GLOBS`, la projection Goal Mode DEV d'un run SelfDev reçoit des
`forbiddenPaths` propres à Noon. Liste initiale, à figer et tester en SD-1 :

- sécurité et autorité : `services/security/**`, `services/approvals/**`,
  `services/goals/goal-mode-dev-*`, `services/delegation/dev-command-policy.js`,
  `services/delegation/dev-task-contract.js`, `skills/registry.js` ;
- configuration et budgets : `services/config/feature-flag-registry.js`,
  `services/dev/dev-cost-budget-service.js`, `config.js`, `.env*` ;
- règles et gouvernance : `AGENTS.md`, `**/AGENTS.md`, `AGENTS_ARCHITECTURE.md`,
  `PERMISSIONS_AND_APPROVALS.md`, `PRIVACY_AND_PERMISSIONS.md` ;
- outillage de vérification : `package.json`, `package-lock.json`, `scripts/**`,
  `forge.config.js`, `electron/production-hardening.js` ;
- **tests existants** : tout fichier déjà présent sous `test/` est en lecture seule ; V1 peut
  **ajouter** de nouveaux fichiers de test, jamais modifier ni supprimer les existants.

La liste est appliquée deux fois : à la projection (le contrat Native DEV refuse ces chemins)
et après le run, sur le diff réel du worktree (`git diff --name-status <base>`). Tout chemin
protégé touché, tout test existant modifié ou supprimé, tout fichier hors `allowedPaths`
invalide la proposition (`SELFDEV_PROTECTED_PATH_CHANGED`), sans réparation automatique.

Conséquence assumée : V1 ne peut pas corriger un bug situé dans ces zones. Il peut l'expliquer
et proposer un correctif en texte, que l'utilisateur appliquera lui-même.

### 4.3 Preuves : base contre patch

- **Reproduction** : le plan doit désigner un test de reproduction **nouveau** qui échoue sur
  la base et passe après le patch. Sans reproduction automatisable, la proposition est marquée
  « non démontrée » et ne peut pas atteindre le critère P2.
- **Comparaison** : mêmes commandes sur le worktree avant et après le patch, via la Sandbox V1
  (`npm test -- <fichiers ciblés>`, puis `npm test`, `npm run lint`, `npm run build` selon le
  risque). Résultat présenté : tests réussis/échoués avant et après, nouveaux échecs nommés,
  durée. Un nouvel échec sur un test existant invalide la proposition.
- **Instabilité** : un test qui échoue sur la base est relancé une fois ; s'il est instable, il
  est signalé comme tel et exclu du verdict, jamais masqué.
- **Données** : les validations héritent de l'environnement minimal de la Sandbox V1 (sans
  `NOON_DATA_DIR`), donc les tests qui chargent `server.js` écrivent dans le worktree, pas dans
  les données de l'utilisateur. À vérifier par un test dédié en SD-2.
- **UX** : V1 ne prétend pas prouver l'UX automatiquement. Quand le patch touche `public/`,
  la proposition liste les écrans concernés et, si disponible, une capture du mode de
  validation UI isolé ; sinon elle demande une vérification manuelle.

### 4.4 Revue indépendante

Après les preuves, un relecteur distinct reçoit uniquement le diff, le résumé du bug et les
résultats de validation, en lecture seule (Codex Bridge `--sandbox read-only`, ou un autre
modèle via le routage existant, sous les mêmes règles de confidentialité et de budget). Sa
sortie est un avis structuré (risques, régressions possibles, tests manquants), affiché tel
quel. Il ne peut ni approuver, ni modifier le patch, ni relancer un run.

### 4.5 Proposition et décision

La proposition affichée contient : explication du bug, cause, patch (diff), base utilisée,
preuves avant/après, avis du relecteur, risques et limites, coût. Actions possibles :
**ouvrir le worktree** (Finder ou éditeur) et **jeter la proposition**. Aucun bouton de
commit, de fusion ou d'application au working tree en V1 : l'utilisateur intègre lui-même.

## 5. Limites de sécurité connues

- **Pas d'isolation au niveau macOS.** Comme pour Native DEV aujourd'hui, les validations
  exécutent du code écrit par un modèle. La Sandbox V1 borne l'environnement, la durée et la
  sortie, mais ne garantit pas `filesystemContainment` ni `networkDenied` : un patch hostile
  pourrait lire hors du worktree ou ouvrir le réseau pendant `npm test`. Mitigations V1 :
  approbation exacte avant chaque validation, revue humaine du diff possible avant les
  validations complètes, fixtures sans données réelles. Un backend OS vérifié reste le
  prérequis de SelfDev V2.
- Les chemins protégés reposent sur une liste : un oubli est possible. Elle est donc testée,
  versionnée et elle-même protégée.
- Le relecteur est un modèle : son avis peut être faux dans les deux sens.

## 6. Tranches

1. **SD-1 — Cible et worktree, sans modèle.** Enregistrement de la cible, service de worktree
   (création, inventaire, suppression explicite), politique de chemins SelfDev et contrôle du
   diff. Tests : working tree utilisateur intact (empreinte avant/après), base explicite,
   refus des chemins protégés, ajout de test autorisé, modification de test refusée.
2. **SD-2 — Preuves base/patch.** Exécution des mêmes validations sur la base et après patch
   via la Sandbox V1, comparaison, détection d'instabilité, vérification que les tests
   n'écrivent pas dans les données utilisateur.
3. **SD-3 — Branchement Goal Mode DEV.** Run Goal Mode DEV dont le dépôt cible est le
   worktree, `forbiddenPaths` SelfDev injectés à la projection, contrôle post-run, flag
   `selfdev.v1` OFF par défaut. Aucune nouvelle autorité : approbations, budget et
   réconciliation inchangés.
4. **SD-4 — Revue et proposition.** Relecteur en lecture seule, carte de proposition dans le
   Control Center (diff, preuves, avis, risques), actions « ouvrir » et « jeter ».
5. **Validation P2 sur le Mac** : un bug réel de Noon, du signalement à la proposition, avec
   le critère de la roadmap.

## 7. Décisions (21/11/2026)

- **`node_modules`** : clone APFS depuis le dépôt principal ; ni lien symbolique, ni
  installation implicite.
- **Base** : n'importe quel commit explicite, par défaut le HEAD de la branche de base. Le
  working tree de l'utilisateur n'a pas à être propre, puisque le worktree part d'un commit ;
  la proposition affiche la base utilisée.
- **Relecteur** : Codex Bridge en local et en lecture seule s'il est disponible ; sinon un
  modèle distant via le routage existant, après approbation et sous les règles de
  confidentialité et de budget.
- **Conservation** : une proposition non traitée depuis 14 jours est signalée avec une offre de
  nettoyage ; aucune suppression automatique.
