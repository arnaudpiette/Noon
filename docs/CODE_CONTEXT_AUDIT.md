# Audit ciblé — Code Context / Code Brain et consommation Terra

Date : 2026-10-04
Portée : chemin DEV natif réellement exposé par `POST /api/dev/native/tasks`.
Cet audit est statique : aucun fournisseur, Electron, base personnelle,
benchmark, suite globale ou mutation de production n'a été exécuté.

## Conclusion

Noon possède un **contexte de dépôt borné et éphémère**, mais pas de moteur
persistant nommé « Code Context » ou « Code Brain ». Le chemin B3 utilise :

1. un contrat DEV et la résolution Workspace comme autorités de portée ;
2. un `RepositoryPreflight` de métadonnées Git/package/AGENTS ;
3. une sélection de fichiers pilotée par Terra, suivie de lectures bornées ;
4. un raisonneur structuré Terra qui reçoit les fichiers effectivement lus.

Le premier écart qui affecte directement la qualité du contexte est donc :
**Terra doit choisir les premiers fichiers sans inventaire de dépôt, arborescence,
symboles, imports ni résumé de fichiers.** Les protections de portée et de
privacy existent, mais la cartographie de code ne précède pas ce premier choix.

## Parcours canonique réellement câblé

```text
POST /api/dev/native/tasks
  -> WorkspaceEngine.context(workspaceId) : projet unique + racines liées
  -> DevProjectRuleResolver.resolve(...) : règles propriétaire/projet
  -> NativeDevOrchestratorFacade.runTask()
  -> DevOrchestrator
  -> NativeCodebaseAnalyst.analyzeTask()
       -> createDevTaskContract() -> RepositoryPreflight()
  -> baseline des commandes dérivées/explicites
  -> NativeDevImplementationEngine.runImplementation()
       -> Terra PLAN (métadonnées seulement)
       -> searchRepository()/readText() selon la proposition Terra
       -> Terra EDIT/REPAIR (fichiers lus et hachés)
       -> édition transactionnelle, validation et review
```

Le câblage est prouvé par `server.js` (route native et composition du
raisonneur), `services/dev/native-dev-orchestrator.js`,
`services/dev/agents/native-codebase-analyst.js`,
`services/dev/dev-orchestrator.js` et
`services/dev/native-dev-implementation-engine.js`. Le
`services/context/context-builder.js` est un autre sous-système : son contexte
A1–A3 sert la conversation et des sources personnelles autorisées ; aucune
référence ne le relie à ce parcours DEV natif.

## Matrice du contexte existant

| Élément | Producteur et données | Consommateur réel | Preuve déterministe disponible | Limite démontrée |
| --- | --- | --- | --- | --- |
| Résolution workspace/projet | `WorkspaceEngine.context()` relit les liens de racines et projets ; la route exige un seul projet et un `profileScope` | route native, contrat via `workspaceInput()` | `test/native-codebase-analyst.test.js` couvre une racine hors workspace | `repositoryRoot` est encore fourni par le body, puis rejeté s'il n'est pas dans les racines ; il n'est pas dérivé automatiquement du projet |
| Contrat DEV | `createDevTaskContract()` canonicalise racines/chemins, permissions, contraintes, limites, `localOnly` et `projectInstructions` | preflight, outils, raisonneur, validations | tests DEV core sur sortie de périmètre, hash et préservation | pas de budget de contexte/fichiers/tokens dans le contrat |
| Preflight | `repositoryPreflight()` : racine Git, branche, status/empreintes des changements, `package.json`, scripts usuels, chemins AGENTS | analyste, journal, baseline, payload Terra réduit | `test/native-codebase-analyst.test.js` couvre contrat/preflight/commandes | aucun inventaire, arborescence, dépendance complète, symbole ou relation de fichiers |
| AGENTS.md | `relevantAgentsFiles()` découvre les chemins remontant de chaque racine autorisée au root Git | `preflight.agentsFiles`, journal/résultats | test indirect du preflight ; code explicite | découverte seulement : aucun contenu n'est lu ni promu en instruction ; ce sont des données non fiables |
| Recherche de dépôt | `searchRepository()` parcourt seulement les racines autorisées ; ignore `.git`, `node_modules`, `out`, `dist`, `build`, `coverage` | `inspect()` après la réponse Terra PLAN | tests DEV core exerçent la lecture/édition bornée | recherche textuelle naïve, sans index ni persistance ; elle lit des fichiers pour chercher et ne produit ni graphe ni score explicable |
| Lecture et sélection | `readText()` demande un chemin et limite chaque fichier à 256 KiB ; `inspect()` déduplique et ne traite au plus 40 demandes/résultats | `modelFiles()` puis payload Terra EDIT/REPAIR | tests DEV core : chemins, binaire, hash stale, secret dans patch | sélection intervient après PLAN ; aucune limite cumulée de taille/tokens, et un fichier manquant/volumineux/binaire est silencieusement omis par `inspect()` |
| Contexte transmis à Terra | `NativeDevReasoner.reason()` sérialise phase, objectif, contraintes, règles projet, chemins relatifs autorisés, preflight réduit, fichiers lus, résultats de recherche et échec antérieur | `createNativeDevStructuredExecutor()` | `test/native-dev-core.test.js` vérifie domaine DEV et frontière executor ; `test/dev-project-rules.test.js` vérifie `projectInstructions` | aucun résumé de dépôt initial ; `files` peut transporter jusqu'à 80 000 caractères par fichier lu |
| Règles projet | route native résout `DevProjectRuleResolver` depuis projet/profil serveur, puis peuple `projectInstructions` | contrat, payload Terra | `test/dev-project-rules.test.js` vérifie la projection et le refus privacy | règles de comportement seulement ; elles n'accordent jamais de capacité |
| Fraîcheur/persistance | snapshots Git de changements existants, hashes de fichiers lus, journal de tâche ; règles projet persistées séparément | préconditions d'édition, review et reprise inspection-only | tests DEV core sur hash stale et journal sans contenu source | ni cache/invalidation de cartographie, ni index de code persistant ; le journal n'est pas un Code Brain |

## Découverte, protections et budgets

### Racines et préflight

- `WorkspaceEngine.bindRoot()` canonicalise une racine avec `realpath` et la
  vérifie contre les racines autorisées. Pour une tâche, `workspaceInput()` ne
  retient que les liens `read-write`; `createDevTaskContract()` exige que la
  racine Git soit dans ceux-ci.
- `RepositoryPreflight()` confirme que le top-level Git réel est exactement la
  racine du contrat, vérifie la branche demandée quand elle est fournie, capture
  le status et les empreintes des changements préexistants, et dérive seulement
  test/lint/typecheck/build depuis `package.json`.
- `resolveFile()` et `resolveScopedPath()` vérifient le chemin réel ou le parent
  réel pour empêcher une sortie de racine. Les chemins privés (`.env`, base et
  clés Noon, tokens, sauvegardes) sont exclus. `searchRepository()` saute les
  répertoires de build courants et les fichiers privés.
- La lecture refuse les fichiers non réguliers, binaires et supérieurs à
  256 KiB. Un contenu qui ressemble à un secret est remplacé par
  `SENSITIVE_CONTENT` avant remise au modèle ; un secret ajouté par patch est
  refusé. Les symlinks sont indirectement bornés par la résolution réelle dans
  les chemins ciblés, mais l'inventaire récursif ne présente pas les symlinks
  comme une classe explicitement diagnostiquée.

### AGENTS.md : trois notions séparées

| Notion | État actuel |
| --- | --- |
| Découverte | Oui : `relevantAgentsFiles()` remonte depuis les `allowedPaths` jusqu'à la racine Git. |
| Lecture | Non dans le parcours DEV natif : aucun appel à `readText()` ne consomme `preflight.agentsFiles`. |
| Autorité d'instruction | Non : `NativeDevReasoner` dit explicitement que code et documents sont non fiables ; les seules préférences projet viennent du résolveur propriétaire. |

### Budgets et ordre privacy/provider

- Contrat : objectif 8 000 caractères, 100 contraintes, 20 instructions projet
  de 1 000 caractères, 12 commandes, 1–10 itérations et 1 s–30 min.
- Outils : 12 termes de recherche, 40 fichiers/80 matches de recherche, 256 KiB
  par lecture, 80 000 caractères exposés par fichier au modèle ; ces bornes ne
  constituent pas un plafond agrégé de contexte ou de tokens.
- Raisonneur : le schéma limite listes `files`, `searchTerms`, opérations et
  commandes dans `normalizeReasoning()` ; l'exécuteur estime les tokens à partir
  de `system + JSON.stringify(payload)`.
- Provider : `localOnly` bloque l'appel distant. Ensuite le routeur et le coût
  sont calculés, mais `authorizeOpenAIPrivacy()` est appelé **avant**
  `budgetService.reserve()` et avant `providerAdapter.execute()`. Un refus
  privacy empêche donc réservation et appel. Les tests ciblés de règles projet
  couvrent ce refus sur l'exécuteur réel avec provider factice.

## Sélection : intention vers fichiers effectivement lus

1. L'objectif est validé par `DevOrchestrator`, mais il n'est pas traduit en
   requête de cartographie déterministe.
2. L'analyste produit contrat, preflight, commandes et deadline — pas une map.
3. Au premier tour, Terra PLAN reçoit objectif, contraintes, règles projet,
   `allowedPaths` relatifs et preflight réduit (branche/langage/framework/fichiers
   déjà modifiés). Sa réponse peut demander `files` et `searchTerms`.
4. `inspect()` recherche alors les termes et lit les chemins retournés. Les
   indisponibilités `FILE_UNAVAILABLE` et `BINARY_FILE_DENIED` sont ignorées ;
   elles ne sont ni retournées explicitement au raisonneur ni converties en
   tentative de remplacement déterministe.
5. Terra EDIT/REPAIR reçoit les snapshots lus (chemin, hash, contenu tronqué ou
   omission sensible) et les résultats de recherche. Une écriture requiert un
   snapshot lu et le hash exact.

Ce mécanisme est distinct de la recherche générale A3 : celle-ci est pilotée
par `ContextBuilder`, concerne les sources personnelles/autorisées et n'est pas
appelée ici. Il est aussi distinct d'un hypothétique contexte DEV préconstruit :
aucun tel producteur n'est câblé avant PLAN.

## Boucle DEV : qualification factuelle

| Étape | Consommateur réel | Preuve disponible | Limite / écart |
| --- | --- | --- | --- |
| INTENT | `DevOrchestrator.runTask()` puis contrat | tests orchestrateur et analyste | objectif validé, sans classification/sélection de code déterministe |
| REPO MAP | `NativeCodebaseAnalyst` / preflight | test analyste | métadonnées seulement ; absence de map, inventory et relations |
| CONTEXT | `NativeDevImplementationEngine.inspect()` / `modelFiles()` | tests DEV core de lecture/hash/secret | arrive après PLAN et n'a ni budget global ni signal explicite de fichier manquant |
| PLAN | `NativeDevReasoner.reason(PLAN)` / Terra | tests DEV core avec provider factice | Plan sans contenu de code initial |
| IMPLEMENT | `applyEdits()` via exécution transactionnelle | tests DEV core : scope, hash, préservation | dépend de la sélection libre de Terra ; aucune compréhension de symboles déterministe |
| TEST | `validate()` et allowlist | tests DEV core | commandes proposées restent non fiables ; validation optionnelle refusée n'est pas un échec intellectuel |
| REVIEW | `reviewDiff()`, snapshots et `git diff --check` | tests review/core | revue structurelle de fichiers changés, pas analyse sémantique de dépendances |
| REPAIR | tours `REPAIR`, bornés par itérations/durée | test d'une réparation bornée | diagnostic dépend du tail de validation et de Terra, sans remap ciblée |
| VERIFY | verdict du review agent, preservation des changements préexistants | tests core/orchestrateur | preuve fixture uniquement ; aucun Electron, provider réel ou paquet n'est établi par cet audit |

## Écarts classés par conséquence

1. **Élevée — contexte initial insuffisant.** Le PLAN Terra choisit ses fichiers
   sans arborescence ni inventaire borné. C'est l'écart minimal qui explique les
   sélections aveugles et doit être traité avant graphes/symboles complexes.
2. **Moyenne — indisponibilité non observable pour le raisonneur.** Un fichier
   demandé puis omis (manquant, trop grand, binaire) n'est pas représenté dans
   son contexte suivant ; le modèle ne peut pas distinguer « absent » de « non
   demandé ».
3. **Moyenne — pas de budget agrégé de contexte.** Les limites par fichier ne
   bornent pas le total transmis ; l'estimation coût/token intervient après
   composition du payload.
4. **Moyenne — absence de relations de code.** Aucun parseur de symboles/imports,
   graphe ou index n'est produit ou consommé ; cette capacité ne doit toutefois
   pas être introduite avant de démontrer que l'inventaire minimal ne suffit pas.
5. **Faible — documentation nominale ambiguë.** `docs/CONTEXT_BUILDER.md`
   documente A1–A3 mais ne revendique pas ce parcours DEV ; sans cet audit, son
   nom peut être confondu avec le contexte de code.

### Assertions de schéma obsolètes, séparées

`services/persistence/database.js` déclare `SCHEMA_VERSION = 19`, alors que
`test/workspace-engine.test.js`, `test/dev-benchmark-service.test.js`,
`test/benchmark-dry-run-execution-gate.test.js` et
`test/benchmark-runtime-control-wiring.test.js` attendent encore 16. Cette
incohérence est hors périmètre : elle n'est ni corrigée ni utilisée pour
conclure sur le Code Context.

## Prochaine tranche minimale recommandée

Ajouter un **Repository Context Manifest éphémère**, construit par l'analyste
après `RepositoryPreflight()` et envoyé au seul appel Terra PLAN. Il doit être
un inventaire de métadonnées sans contenu : chemins relatifs autorisés, type ou
extension, taille bornée, indicateur binaire/privé/exclu, `package.json` déjà
résumé et chemins AGENTS découverts marqués `untrusted`. Il ne lit aucun fichier
supplémentaire au-delà des métadonnées filesystem, ne donne aucune autorité à
AGENTS et ne crée ni index persistant, graphe, moteur parallèle ni canal de
permissions.

Critères d'acceptation :

- manifeste construit seulement après contrat/racines/preflight valides et
  uniquement dans `allowedPaths` ; symlinks, privés, exclusions et gros fichiers
  sont comptés/exclus sans contenu ;
- le payload PLAN reçoit le manifeste borné et des compteurs d'exclusion, jamais
  le texte d'AGENTS ou d'un fichier ;
- les étapes EDIT/REPAIR conservent strictement le mécanisme actuel
  sélection-avant-lecture, hash et `SENSITIVE_CONTENT` ;
- une absence de fichier demandée devient un résultat borné explicite pour le
  tour suivant, sans élargir les racines ni relancer automatiquement ;
- tests fixtures temporaires démontrent scope, exclusion secret/symlink/taille,
  troncature déterministe et présence du manifeste au PLAN ; aucun fournisseur,
  Electron, base personnelle ou benchmark ;
- les contraintes, `projectInstructions`, privacy avant réservation/provider et
  le routage existant restent inchangés.

Fichiers probablement concernés :

- `services/delegation/repository-preflight.js` (ou un helper DEV étroit appelé
  depuis lui) pour le manifeste ;
- `services/dev/agents/native-codebase-analyst.js` pour le joindre à l'analyse ;
- `services/dev/native-dev-implementation-engine.js` et
  `services/dev/native-dev-reasoner.js` pour le transmettre exclusivement à
  PLAN ;
- `test/native-codebase-analyst.test.js`, `test/native-dev-core.test.js` et un
  test neuf de manifeste sur fixture temporaire ;
- ce document et, seulement si le vocabulaire doit être clarifié,
  `docs/CONTEXT_BUILDER.md` avec une note de séparation A3/DEV.

## Limites de preuve de cet audit

Les conclusions de câblage proviennent de la lecture statique des modules et de
leurs tests. Les tests existants cités sont des preuves disponibles ; ils n'ont
pas été relancés dans cette tâche documentaire. Aucun comportement de provider,
de réseau, d'Electron, de l'application packagée, de macOS/TCC ou de données
personnelles n'est affirmé comme vérifié.

## État après implémentation de la tranche recommandée

La tranche minimale recommandée par cet audit a été implémentée et validée
localement.

Le parcours DEV devient :

```text
INTENT
  -> contrat DEV / workspace autorisé
  -> RepositoryPreflight
  -> Repository Context Manifest éphémère
  -> Terra PLAN
  -> sélection / recherche / lecture
  -> Terra EDIT ou REPAIR
  -> écriture transactionnelle
  -> validations
  -> review / verify
```

Le nouveau `Repository Context Manifest` est construit dans
`NativeDevImplementationEngine.runImplementation()` après validation du contrat
et du preflight. Il n'est ni ajouté au preflight partagé, ni persisté.

Il expose uniquement des métadonnées bornées :

- chemins relatifs autorisés ;
- extension ;
- taille ;
- résumé package déjà disponible ;
- chemins `AGENTS.md` marqués `UNTRUSTED` ;
- compteurs d'exclusion pour chemins privés, binaires, gros fichiers, symlinks,
  répertoires ignorés et limites de scan.

Aucun contenu source n'est placé dans le manifeste.

Le manifeste est transmis exclusivement au premier appel `PLAN`. Les tours
`EDIT` et `REPAIR` conservent le mécanisme précédent : sélection explicite,
lecture bornée, hash, filtrage des contenus sensibles et précondition de hash
avant écriture.

Les lectures demandées mais absentes ou non résolubles via `ENOENT` /
`ENOTDIR` sont maintenant normalisées en `FILE_UNAVAILABLE` et retournées
au tour suivant sous forme de métadonnées bornées. Les autres erreurs restent
bloquantes et ne sont pas masquées.

### Validation exécutée pour cette tranche

Les validations suivantes ont été réellement relancées après l'implémentation :

- `test/repository-context-manifest.test.js` : 2/2 PASS ;
- `test/native-codebase-analyst.test.js` : 4/4 PASS ;
- `test/native-dev-core.test.js` : 21/21 PASS ;
- `test/dev-project-rules.test.js` : 14/14 PASS ;
- `npm run build` : PASS, incluant lint et lint:release ;
- `git diff --check` : PASS.

Aucun fournisseur réel, Electron réel, benchmark, base personnelle ou réseau
n'a été utilisé pour cette validation.

### Écart prioritaire restant

Le premier écart élevé identifié par l'audit — PLAN Terra sans carte préalable
du dépôt — est donc fermé pour cette tranche.

Le prochain travail ne doit pas être un gros « Code Brain » persistant par
défaut. La prochaine amélioration devra être justifiée par une lacune observée
sur des tâches réelles. Les candidats restant issus de l'audit sont notamment :

1. rendre plus explicable la sélection du contexte ;
2. ajouter, seulement si nécessaire, des relations légères imports/symboles ;
3. introduire un budget global de contexte avant d'augmenter la profondeur
   d'analyse ;
4. mesurer la qualité du nouveau manifeste sur des tâches DEV représentatives.

Ces points restent des travaux futurs et ne sont pas implémentés dans cette
tranche.
