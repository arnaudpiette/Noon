# État actuel de Noon — audit V3-L0

**Date : 22/11/2026.** Lot V3-L0 de `docs/ROADMAP.md` (A.1, A.2, A.3, A.7).
Base : branche `v2/multi-provider`, HEAD `31670e3` (21/11/2026 21:50), synchronisée avec
`origin` (0 commit d'avance ou de retard). Les changements de ce lot ne sont pas encore commités.

## 1. Dépôt

| Mesure | Valeur |
|---|---|
| JS dans `lib/`, `services/`, `electron/`, `public/` | 96 211 lignes |
| `server.js` | 10 644 lignes |
| `public/app.js` | 11 569 lignes |
| Fichiers de plus de 1 500 lignes | 9 (voir §5) |
| Documents Markdown versionnés | 133 |
| Fichiers de test | 247 |
| Feature flags | 69 : 6 ON, 9 LIMITED, 19 SHADOW, 35 OFF |
| Version | 1.0.6, x64 (Mac Intel) |

Fichiers non suivis de l'utilisateur laissés intacts : `benchmark-workspaces/`,
`dev-cost-ledger.json`, `dev-task-journal/`.

## 2. Preuves exécutées le 22/11/2026

| Contrôle | Résultat |
|---|---|
| `npm run lint` (ESLint + `node --check`) | PASS, 0 erreur |
| `npm test` | PASS, 2 762 / 2 762 |
| `npm run eval:critical` | PASS |
| `npm run eval:privacy`, `eval:remote`, `eval:sync` | PASS |
| `npm run eval:smoke` | PASS 99/99 après alignement de `voice.identity` sur Cedar (§6) |
| Smoke packagé (`scripts/packaged-smoke.js`, profil isolé) | PASS : serveur prêt en 1,0 s, `/health` en 2,0 s, sortie propre |

Le binaire testé est `out/Noon-darwin-x64/Noon.app`, construit le 21/11 à 21:41. Son
`app.asar` est identique octet pour octet à celui de `/Applications/Noon.app`. Ce build précède
le commit IP-1 (21:50) et ne contient donc ni IP-1, ni les changements non commités.

**Non vérifié (manuel, à faire par Arnaud) :** ouvrir `/Applications/Noon.app` avec le vrai
profil, constater l'interface et obtenir une réponse à « Bonjour ». Le smoke automatique utilise
un profil isolé en mode test : il prouve le démarrage et `/health`, pas une réponse de modèle.

## 3. A.2 — Goal Mode DEV : 4C-2 et B3

- 4C-2 : `1d8e1bb` (20/11), réconciliation des réservations et des coûts.
- B3 : `316bae1` (20/11), UI d'approbation et maintenance du verrou `DATA_DIRECTORY`.
- Correctifs issus de l'essai réel du 21/11 : B4a `715bb75`, B4b `7aff527`, B4c `ea27330`.

Tests au vert. L'essai réel du 21/11 a été arrêté puis annulé (configuration restaurée) ; le
contrôle visuel du panneau dans Electron reste à faire. **Décision : gel des raffinements du
cycle de vie des réservations** (voir `DECISIONS.md`).

## 4. A.3 — Vrai lint

- ESLint 10.14.0 (`eslint.config.js`), branché en tête de `npm run lint`.
- Règles : socle `recommended` + `no-undef`, `no-unused-vars` (variables et imports stricts,
  paramètres tolérés car les options déstructurées font partie des signatures), `eqeqeq`
  (sauf `== null`). `catch {}` vide autorisé (convention du projet) ; `no-control-regex`
  désactivé (nettoyeurs d'entrées).
- Mesure initiale : 291 signalements. Après configuration et correction : **0**.
- Corrections : 22 affectations inutiles, 16 échappements inutiles, une trentaine de
  variables ou imports morts, quelques fonctions mortes (dont trois dans `public/app.js`, une
  variable d'état `isListening` jamais lue), une erreur relancée sans `cause`.
- Défaut latent trouvé dans un test : dans `test/goal-mode-dev-http-server.test.js`, une
  expression régulière écrite dans un modèle de chaîne perdait ses `\.` ; corrigé en `\\.`.
- **Reporté à A.4** : `no-floating-promises` exige typescript-eslint avec informations de
  types (`// @ts-check` + JSDoc).

## 5. A.7 — Inventaire des services

Outil : `node scripts/services-inventory.js` (`--json` pour une sortie machine). Analyse
statique des `require()` depuis `electron/main.js`, `electron/preload.js`, `server.js` et
`config.js`. **Branché** ne veut pas dire **utilisé** : un service atteint peut rester inactif
(flag OFF ou SHADOW). Le critère d'usage réel de la roadmap (3 fois par semaine) exigera la
télémétrie locale du pilier G.

**Dossiers jamais atteints par l'application (tests seulement) :**
- `services/automations` (2 fichiers, 42 lignes)
- `services/workflows` (2 fichiers, 22 lignes)

**Fichiers morts (requis nulle part) :**
- `services/connectors/figma-auth.js`, `google-contacts.js`, `google-drive.js`, `registry.js`
- `services/automations/anti-spam.js`
- `services/decision/index.js`, `services/sync/index.js`, `services/remote/index.js`,
  `services/remote/remote-health.js`
- `lib/personal-brief.js`

**Fichiers atteints seulement par les tests (extraits) :**
- `services/remote/*` : moteur d'interaction distante, handoff, médias, approbations distantes (12 fichiers)
- `services/sync/*` : moteur, politique, transport, conflits (5 fichiers)
- `services/connectors/figma.js` et `github.js`
- `services/jobs/job-scheduler.js`, `services/lifecycle/recovery-service.js`,
  `services/evaluation/noon-evaluation-engine.js` (utilisé par les scripts d'évaluation)
- `lib/agent-router.js`, `lib/noon-evaluations.js`, `lib/noon-routing-corpus.js`, `lib/project-journals.js`

**Écart avec la documentation :** `AGENTS.md` présente `lib/agent-router.js` comme le
sélecteur des profils internes, mais l'application ne le requiert pas (tests seulement).

**Fichiers de plus de 1 500 lignes (objectif A.5) :** `public/app.js` (11 569), `server.js`
(10 644), `services/dev/workspace-terminal-service.js` (2 294),
`services/dev/native-dev-implementation-engine.js` (2 179), `services/goals/goal-mode-run-state.js`
(1 975), `services/goals/goal-mode-next-step-planner.js` (1 695),
`services/security/dev-process-runner.js` (1 667), `services/orchestration/noon-orchestrator.js`
(1 628), `services/decision/decision-support-engine.js` (1 613).

Les dix fichiers morts ci-dessus ont été supprimés le 22/11/2026 avec l'accord d'Arnaud
(récupérables dans l'historique Git).

## 6. Problèmes connus

- `eval:smoke` : le scénario `voice.identity` attendait la voix `arbor` alors que la voix
  canonique est `cedar` (`docs/VOICE_IDENTITY.md`). Échec antérieur à ce lot ; scénario aligné
  sur Cedar le 22/11/2026 : `eval:smoke` 99/99.
- `public/live-voice.js` lisait les réglages langue et accent sans les transmettre à la
  session Live. Ces lectures mortes ont été retirées. À trancher : les réglages doivent-ils
  agir sur Live, ou disparaître de l'interface ?
- Test instable déjà connu : `test/connector-validation.test.js` (Calendar, budget de 50 ms
  en temps réel) peut échouer sous charge.
- `npm install` signale des vulnérabilités dans l'arbre de dépendances (non analysées dans ce lot).

## 7. Sortie de V3-L0

| Critère | État |
|---|---|
| App packagée qui démarre | PASS (smoke isolé) |
| App packagée qui répond à « Bonjour » | **Non vérifié** (manuel) |
| Lint réel au vert | PASS |
| Baseline de tests | 2 762 tests, critical/privacy/remote/sync/smoke PASS |
| Liste des services morts | Faite (§5) ; fichiers morts supprimés |
