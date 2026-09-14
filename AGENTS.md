# Noon — Instructions permanentes pour Codex

## 1. Rôle de ce fichier

Ce fichier définit les règles que Codex doit respecter lorsqu’il travaille dans le dépôt Noon.

Il ne décrit pas les agents internes de Noon.

L’architecture des profils internes de Noon est décrite dans :

* `AGENTS_ARCHITECTURE.md`

Ne pas confondre :

* `AGENTS.md` → règles de développement pour Codex ;
* `AGENTS_ARCHITECTURE.md` → architecture des profils et agents internes de Noon.

---

# 2. Projet

Noon est un assistant personnel IA local-first pour macOS construit principalement avec :

* Electron ;
* Node.js ;
* JavaScript ;
* OpenAI ;
* stockage local sécurisé ;
* services modulaires ;
* interfaces vocales et textuelles.

Point d’entrée Electron :

`electron/main.js`

Le projet contient notamment :

* `electron/` → application macOS, preload, IPC et cycle de vie Electron ;
* `lib/` → logique historique et composants centraux de Noon ;
* `services/` → architecture modulaire des services ;
* `public/` → interface utilisateur ;
* `scripts/` → validation, évaluations, packaging et maintenance ;
* `test/` → tests ;
* `docs/` → documentation d’architecture ;
* `server.js` → serveur principal et orchestration historique.

---

# 3. Règle absolue : préserver le travail local

Le working tree local de l’utilisateur est prioritaire sur GitHub.

GitHub `main` peut être moins récent que les modifications présentes dans VS Code.

Avant toute modification :

```bash
git status --short
git diff --stat
git diff
```

Si nécessaire :

```bash
git log -5 --oneline
```

Codex doit comprendre les modifications locales existantes avant d’écrire.

Ne jamais :

* écraser une modification locale parce qu’elle n’existe pas sur GitHub ;
* restaurer automatiquement une version distante ;
* effectuer `git reset --hard` ;
* effectuer `git clean` ;
* utiliser `git checkout -- <fichier>` pour effacer un changement ;
* supprimer une modification non liée à la tâche ;
* reconstruire un fichier entier lorsque quelques lignes suffisent.

Si des modifications locales existent, les préserver.

---

# 4. Git

Codex peut inspecter Git librement.

Codex ne doit pas automatiquement :

* créer un commit ;
* effectuer un push ;
* créer une release ;
* fusionner une branche ;
* supprimer une branche ;
* réécrire l’historique.

Un commit ou un push nécessite une demande explicite de l’utilisateur.

Avant de proposer un commit, afficher clairement :

* les fichiers modifiés ;
* les tests exécutés ;
* leur résultat ;
* les éventuelles limitations restantes.

---

# 5. Sources de référence

Avant une modification importante, consulter les documents pertinents existants.

En particulier :

* `README.md`
* `AGENTS_ARCHITECTURE.md`
* `PERMISSIONS_AND_APPROVALS.md`
* `PRIVACY_AND_PERMISSIONS.md`
* `CLOUD_INTEGRATIONS_SETUP.md`
* `MANUAL_TEST_CHECKLIST.md`
* `MANUAL_RELEASE_CHECKLIST.md`
* `NOON_INSTALLATION_LOCALE.md`
* `NOON_WAKE_WORD_SETUP.md`
* les documents correspondants dans `docs/`

Ne pas inventer une nouvelle architecture si une architecture existe déjà.

Le code actuel et le working tree local restent néanmoins prioritaires si la documentation est plus ancienne.

En cas de contradiction :

1. examiner le code actuel ;
2. examiner les modifications locales ;
3. comparer avec la documentation ;
4. signaler l’écart ;
5. ne pas écraser silencieusement l’implémentation récente.

---

# 6. Principe de modification minimale

Pour chaque demande :

1. identifier le sous-système concerné ;
2. comprendre le flux existant ;
3. modifier le minimum de fichiers nécessaire ;
4. conserver les API internes existantes lorsque possible ;
5. tester localement ;
6. vérifier les régressions.

Ne pas profiter d’une petite tâche pour refactoriser des parties sans rapport.

Éviter les réécritures massives de :

* `server.js`
* `electron/main.js`
* `public/app.js`
* systèmes de mémoire ;
* systèmes OAuth ;
* ModelRouter ;
* système vocal ;
* système d’approbations.

Une refactorisation importante doit avoir une raison technique explicite.

---

# 7. Architecture Electron et sécurité IPC

Respecter la séparation entre :

* processus principal Electron ;
* preload ;
* renderer ;
* serveur local ;
* services internes.

Ne pas exposer directement au renderer :

* clés API ;
* tokens OAuth ;
* secrets ;
* accès arbitraire au système de fichiers ;
* commandes shell ;
* objets Node sensibles.

Préserver les restrictions du preload et des IPC.

Toute nouvelle capacité sensible doit passer par une interface bornée et validée.

---

# 8. Local-first

Noon est un assistant local-first.

Les informations privées doivent rester locales sauf lorsqu’un service distant est explicitement nécessaire à une fonctionnalité autorisée.

Ne pas envoyer automatiquement vers un modèle ou service distant :

* fichiers privés sans nécessité ;
* mémoire personnelle complète ;
* bases locales ;
* informations familiales ;
* historiques complets ;
* secrets ;
* données sans rapport avec la demande.

Réduire le contexte envoyé au strict nécessaire.

---

# 9. Secrets et SafeStorage

Ne jamais ajouter au dépôt :

* clés API ;
* tokens OAuth ;
* mots de passe ;
* secrets client ;
* données personnelles privées ;
* fichiers de mémoire utilisateur ;
* bases SQLite personnelles ;
* credentials Google ;
* AccessKey de wake word ;
* cookies ou sessions.

Les secrets persistants doivent utiliser le mécanisme sécurisé déjà prévu par Noon, notamment `safeStorage` dans Electron lorsque applicable.

Ne jamais remplacer un stockage sécurisé par :

* `localStorage` ;
* JSON en clair ;
* fichier texte ;
* code source ;
* variable hardcodée.

`.env.example` peut documenter les noms des variables mais ne doit jamais contenir de vraies valeurs privées.

---

# 10. Actions externes

Les lectures et écritures externes sont deux niveaux différents de permission.

Noon peut analyser des données autorisées en lecture.

Une écriture ayant un effet externe doit continuer à utiliser le mécanisme d’approbation prévu par Noon.

Cela concerne notamment :

* Gmail ;
* Google Calendar ;
* Google Drive ;
* GitHub ;
* Figma ;
* Contacts ;
* Apple Rappels ;
* fichiers personnels ;
* autres connecteurs.

Ne jamais contourner le système d’approbation simplement pour simplifier une implémentation.

En développement, privilégier lorsque pertinent :

```bash
DRY_RUN_EXTERNAL_WRITES=true npm start
```

---

# 11. Fichiers locaux

Respecter les dossiers autorisés par l’utilisateur.

Ne pas permettre au modèle de parcourir arbitrairement tout le Mac.

Respecter :

* les permissions de lecture ;
* les permissions de création ;
* le Focus actif ;
* les exclusions existantes ;
* les fichiers secrets ;
* `.git` ;
* `node_modules` ;
* caches ;
* builds ;
* emplacements explicitement exclus.

Une autorisation de lecture ne signifie pas autorisation de modification.

---

# 12. Mémoire Noon

Toute modification de la mémoire doit préserver :

* persistance locale ;
* validation lorsque nécessaire ;
* correction ;
* oubli ;
* isolation contextuelle ;
* redémarrage de l’application ;
* confidentialité.

Une mémoire candidate non confirmée ne doit pas devenir silencieusement une vérité permanente.

Une information oubliée ou invalidée ne doit pas ressusciter après :

* redémarrage ;
* migration ;
* réindexation ;
* restauration de session.

Porter une attention particulière aux modules liés à :

* mémoire long terme ;
* intelligence personnelle ;
* contexte ;
* persistance ;
* sessions.

---

# 13. Agents internes de Noon

Noon n’utilise pas cinq IA autonomes fonctionnant en parallèle.

Respecter `AGENTS_ARCHITECTURE.md`.

`lib/agent-router.js` sélectionne les profils appropriés.

Ne pas introduire sans demande explicite :

* orchestration multi-agent autonome ;
* boucles agent-agent ;
* délégations récursives ;
* agents permanents consommant des ressources en arrière-plan.

Les profils existants doivent rester bornés par :

* leurs outils ;
* leurs permissions ;
* leur budget ;
* leurs limites d’étapes ;
* les règles d’approbation.

---

# 14. Codex Bridge

Respecter l’architecture de :

`lib/codex-bridge.js`

La consultation de Codex depuis Noon ne doit pas devenir une porte dérobée permettant :

* l’écriture arbitraire ;
* les actions externes ;
* l’accès hors Focus ;
* l’exécution non bornée de commandes ;
* l’accès à des secrets.

Le principe de sandbox et de portée limitée doit être préservé.

---

# 15. ModelRouter

Ne pas modifier silencieusement :

* les modèles disponibles ;
* l’ordre de fallback ;
* les seuils ;
* les budgets ;
* les règles de sélection ;
* le comportement local-only ;
* les protections de coût.

Toute modification du routage doit être :

* ciblée ;
* testée ;
* justifiée ;
* compatible avec les fallbacks existants.

Un modèle indisponible ne doit pas casser Noon lorsque le fallback est prévu.

---

# 16. Voix

Les fonctions vocales ne doivent pas casser les fonctions texte.

Toute modification du système vocal doit préserver au minimum :

* Chat texte ;
* Conversation Live ;
* permissions microphone ;
* sélection des périphériques ;
* arrêt/reprise audio ;
* comportement en cas d’indisponibilité ;
* fallback approprié.

Ne pas simuler une voix ou un fournisseur indisponible.

Afficher un état honnête lorsque la fonctionnalité n’est pas disponible.

---

# 17. Wake word « Salut Noon »

Le système de wake word doit rester local autant que possible.

Une modification ou migration du moteur de wake word doit être isolée du reste de Noon.

Avant de modifier ce sous-système, identifier :

* service de wake word ;
* gestion du microphone ;
* intégration Electron ;
* configuration ;
* démarrage/arrêt ;
* interaction avec Conversation Live ;
* packaging des dépendances natives ;
* tests existants.

Une migration, par exemple d’un fournisseur de wake word vers un autre, ne doit pas casser :

* `npm start` ;
* le lancement Electron ;
* la voix ;
* le micro classique ;
* Conversation Live ;
* le mode texte.

Ne pas supprimer l’ancienne implémentation avant validation suffisante de la nouvelle si un fallback ou une migration progressive est possible.

---

# 18. Brief quotidien

Préserver les règles du Brief Noon.

En particulier :

* fuseau `Europe/Paris` ;
* génération du jour concerné ;
* rattrapage contrôlé ;
* calendrier ;
* rappels ;
* notes ;
* priorités ;
* suggestions de créneaux ;
* données autorisées.

La pause :

`12:30 → 13:30`

doit rester protégée dans les propositions d’organisation tant que cette règle produit est active.

Ne pas transformer une suggestion en écriture Calendar automatique sans respecter la politique d’approbation correspondante.

---

# 19. Données et persistance

Toute évolution des données persistantes doit prendre en compte :

* compatibilité avec les données existantes ;
* migration ;
* idempotence ;
* sauvegarde ;
* rollback lorsque nécessaire ;
* redémarrage de Noon ;
* ancienne version installée.

Ne jamais supprimer une base utilisateur pour résoudre facilement un problème de migration.

Ne jamais considérer la suppression de données locales comme une solution normale de développement.

---

# 20. Tests

Après chaque modification, exécuter d’abord les tests les plus ciblés.

Puis utiliser selon l’impact :

```bash
npm run lint
npm run eval:critical
npm test
```

Pour un contrôle général :

```bash
npm run noon:check
```

Pour vérifier le build :

```bash
npm run build
```

Ne jamais annoncer :

`PASS`

si la commande n’a pas réellement réussi.

Ne pas modifier un test uniquement pour masquer une régression.

---

# 21. Évaluations

Noon possède plusieurs catégories d’évaluations.

Utiliser la catégorie correspondant au sous-système modifié lorsqu’elle existe.

Par exemple :

```bash
npm run eval:critical
npm run eval:privacy
npm run eval:smoke
npm run eval:multimodal
npm run eval:delegation
npm run eval:remote
npm run eval:decision
npm run eval:notifications
npm run eval:offline
npm run eval:extensions
```

Éviter de lancer systématiquement toutes les évaluations lorsqu’un test ciblé suffit pendant le développement.

Avant de conclure une modification structurante, élargir la validation.

---

# 22. Packaging macOS

Noon fonctionne en développement et sous forme d’application Electron packagée.

Une modification peut fonctionner avec :

```bash
npm start
```

et échouer dans `Noon.app`.

Pour les changements touchant :

* Electron ;
* preload ;
* dépendances natives ;
* audio ;
* wake word ;
* filesystem ;
* chemins de ressources ;
* packaging ;
* permissions macOS ;

vérifier également le comportement packagé lorsque cela est pertinent.

Commandes disponibles :

```bash
npm run package:mac:x64
npm run package:mac:arm64
```

Pour les validations de release, utiliser les scripts existants plutôt que créer une procédure parallèle.

---

# 23. Mac cible actuel

Ne pas supposer qu’une architecture processeur unique restera permanente.

Le projet dispose de builds :

* x64 ;
* arm64.

Préserver les deux lorsque cela est raisonnablement possible.

Ne pas introduire une dépendance native sans vérifier sa compatibilité Electron/macOS et son architecture CPU.

---

# 24. Dépendances

Avant d’ajouter une dépendance npm :

1. vérifier si une dépendance existante couvre déjà le besoin ;
2. vérifier sa maintenance ;
3. vérifier sa licence ;
4. vérifier sa compatibilité macOS ;
5. vérifier sa compatibilité Electron ;
6. vérifier x64 et arm64 si applicable ;
7. examiner son impact sur le packaging ;
8. examiner son impact sécurité ;
9. examiner son poids.

Ne pas ajouter une grosse dépendance pour remplacer quelques lignes simples de code.

Ne pas supprimer une dépendance encore utilisée avant d’avoir recherché tous ses imports et usages.

---

# 25. `server.js`

`server.js` est un fichier central important et volumineux.

Ne pas le réécrire globalement pour une modification locale.

Lorsque possible :

* réutiliser les services existants ;
* déplacer progressivement les responsabilités vers `services/` seulement si la tâche le justifie ;
* préserver les API et comportements existants.

Toute extraction importante doit être testée contre les comportements actuels.

---

# 26. Services

Respecter l’organisation existante sous `services/`.

Elle contient notamment des responsabilités liées à :

* approvals ;
* artifacts ;
* automations ;
* config ;
* connectors ;
* context ;
* daily brief ;
* decision ;
* delegation ;
* evaluation ;
* execution ;
* extensions ;
* goals ;
* intents ;
* lifecycle ;
* notifications ;
* persistence ;
* reliability ;
* research ;
* runtime ;
* security ;
* sessions ;
* voice.

Avant de créer un nouveau service, vérifier si la responsabilité existe déjà.

Éviter les services en doublon.

---

# 27. Interface utilisateur

Ne pas modifier inutilement le design existant lors d’une tâche backend.

Préserver :

* comportements existants ;
* accessibilité ;
* états de chargement ;
* états d’erreur ;
* responsive lorsque applicable ;
* interactions déjà validées.

Une modification fonctionnelle ne doit pas entraîner une refonte graphique non demandée.

---

# 28. Logs

Ne pas écrire dans les logs :

* tokens ;
* clés API ;
* mots de passe ;
* contenu complet des mémoires privées ;
* données personnelles inutiles ;
* secrets OAuth.

Pour le diagnostic, préférer :

* statut ;
* nom de sous-système ;
* code erreur ;
* durée ;
* identifiant technique ;
* empreinte tronquée.

---

# 29. Gestion des erreurs

Ne pas masquer les erreurs importantes.

Les erreurs doivent permettre de distinguer :

* configuration absente ;
* permission refusée ;
* service indisponible ;
* erreur réseau ;
* erreur utilisateur ;
* bug interne.

Préférer un fallback contrôlé lorsqu’il existe.

Une erreur d’un sous-système facultatif ne doit pas nécessairement empêcher tout Noon de démarrer.

---

# 30. Pas de faux succès

Codex doit distinguer clairement :

* implémenté ;
* testé automatiquement ;
* testé manuellement ;
* testé dans Electron ;
* testé dans l’application packagée ;
* non testé ;
* partiellement validé.

Ne jamais déclarer une fonctionnalité « totalement opérationnelle » si une étape importante n’a pas été vérifiée.

---

# 31. Méthode obligatoire pour chaque tâche

## Avant de coder

1. Lire la demande.
2. Examiner les fichiers concernés.
3. Examiner les tests concernés.
4. Lire la documentation pertinente.
5. Exécuter `git status --short`.
6. Identifier les modifications locales.
7. Déterminer les risques de régression.

## Pendant

1. Faire des changements ciblés.
2. Préserver les interfaces existantes.
3. Ne pas toucher aux fichiers sans rapport.
4. Ne pas désactiver les protections de sécurité.
5. Ajouter ou adapter les tests lorsque nécessaire.

## Après

1. Examiner le diff.
2. Lancer les tests ciblés.
3. Lancer les contrôles généraux nécessaires.
4. Vérifier qu’aucune donnée privée n’est apparue dans le diff.
5. Résumer précisément les changements.
6. Indiquer les tests réellement exécutés.
7. Indiquer ce qui reste non vérifié.

---

# 32. Format du rapport final Codex

À la fin d’une tâche importante, fournir un résumé de ce type :

## Modifications

* fichiers modifiés ;
* comportement ajouté ou corrigé.

## Validation

* commandes exécutées ;
* tests réussis ;
* tests échoués.

## Régressions vérifiées

* fonctionnalités voisines contrôlées.

## Non vérifié

* tests matériels ;
* tests packagés ;
* services externes ;
* autres validations restant à effectuer.

## Git

* état du working tree ;
* aucun commit/push sauf demande explicite.

---

# 33. Interdictions absolues sans autorisation explicite

Ne jamais automatiquement :

* supprimer la mémoire utilisateur ;
* supprimer une base locale ;
* effacer une configuration ;
* effectuer un reset Git ;
* écraser des changements locaux ;
* pousser sur GitHub ;
* publier une release ;
* envoyer un e-mail ;
* modifier un événement distant ;
* supprimer un fichier personnel ;
* contourner une approbation ;
* exposer un secret ;
* désactiver une sécurité pour faire passer un test.

---

# 34. Définition de terminé

Une tâche est terminée seulement lorsque :

* la demande est implémentée ;
* les changements sont ciblés ;
* les modifications locales antérieures ont été préservées ;
* les tests pertinents ont été exécutés ;
* aucune régression connue n’a été introduite ;
* la confidentialité est préservée ;
* les politiques d’approbation sont préservées ;
* les limitations restantes sont signalées ;
* la documentation est mise à jour si le comportement ou l’architecture a réellement changé.

Ne pas confondre :

« le code compile »

avec :

« la fonctionnalité est totalement validée ».
