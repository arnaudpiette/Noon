# Contrat V1 — règles DEV de confiance

Date : 2026-10-02
Statut : première tranche Terra implémentée le 2026-10-02 ; aucune UI de gestion n'est incluse.

## Décision

V1 introduit des **règles de comportement DEV explicitement enregistrées par le propriétaire pour un projet résolu**. Elles sont persistées localement, résolues avant la création du contrat DEV et projetées vers le seul raisonneur DEV natif (Terra). Elles ne sont ni une nouvelle mémoire, ni un nouveau moteur de sécurité ou de permissions.

La source d'identité est le \`projectId\` déjà lié au \`WorkspaceEngine\`, et non un nom de dossier, une branche, un nom affiché ou le texte fourni par le modèle. Une tâche qui ne résout pas exactement un unique projet ne reçoit aucune règle de projet V1 ; elle peut continuer avec ses seules contraintes de tâche.

Le stockage retenu est la base personnelle locale déjà utilisée par \`WorkspaceRepository\` (\`services/persistence/database.js\`), avec un dépôt dédié et une table dédiée aux règles DEV. Cela préserve la séparation des \`memory_items\` : une mémoire historique, une préférence, un fichier du dépôt ou une sortie d'outil ne deviennent jamais une règle DEV par inférence ou par migration. La table et le fallback JSON associés devront être ajoutés dans la même tranche, avec une migration idempotente et sans lecture d'une base personnelle existante pour attribution rétroactive.

\`projectInstructions\` de \`services/delegation/dev-task-contract.js\` est le champ de projection à conserver : il est déjà borné et éphémère par tâche. Son défaut actuel est de ne pas atteindre la route native ni le payload du \`NativeDevReasoner\`; V1 le câble, au lieu de créer un second canal de contexte.

## Modèle de confiance

### Création, modification et suppression autorisées

Une mutation de règle est autorisée seulement si le processus principal a reçu une action explicite du propriétaire depuis une surface Noon de confiance, identifiée côté service par :

1. une invocation IPC préchargée, bornée à \`devProjectRule.create\`, \`devProjectRule.update\` ou \`devProjectRule.delete\` ;
2. la vérification d'origine/émetteur par le mécanisme IPC de confiance déjà présent (\`electron/production-hardening.js\`), sans accepter \`actor\`, \`ownerId\`, \`origin\` ou \`authorized\` depuis le body ;
3. le \`projectId\` et \`ownerProfileScope\` résolus depuis le workspace/profil actif ;
4. une intention de mutation explicite et le texte exact à enregistrer.

Il n'existe aucune route HTTP de mutation de règles V1. Dans la topologie actuelle, \`electron/main.js\` compose \`server.js\` dans le même processus puis appelle sa commande interne exportée après le contrôle IPC ; aucun \`localAuthSecret\`, token d'action ou équivalent ne traverse HTTP. Cette frontière IPC technique ne prouve pas à elle seule l'intention humaine : une UI explicite reste nécessaire. Le raisonneur peut proposer une règle ou préremplir un brouillon, mais ne peut ni l'enregistrer ni la modifier.

Sont des **données non fiables**, jamais promues automatiquement : tout champ modèle, \`AGENTS.md\` ou autre fichier, contenu de dépôt, résultat d'outil, document, pièce jointe, mémoire existante, résultat de recherche ou message externe. \`RepositoryPreflight.agentsFiles\` reste donc une liste de chemins, pas une ingestion d'instructions.

Une règle de comportement (par exemple « préfère telle commande de test ») ne confère aucune permission d'exécuter cette commande, d'écrire, de committer, d'accéder à un chemin ou d'appeler un fournisseur. \`DevTaskContract\`, \`OperationalSecurityPolicy\`, la politique de commandes DEV et les approbations restent les autorités imposées.

### Portées, précédence et contradictions

L'ordre de force est le suivant ; une portée ne peut modifier que le texte adressé au raisonneur, jamais une borne imposée par une portée supérieure.

| Rang | Portée | Effet V1 |
| --- | --- | --- |
| 1 | politiques produit : sécurité, privacy, permissions, bornes DEV | imposées par le code ; non exportables ni affaiblissables |
| 2 | restriction explicite de tâche | reste effective ; elle peut restreindre ou exclure une préférence projet |
| 3 | règle DEV durable du projet résolu | instruction au raisonneur, seulement si active et compatible |
| 4 | préférence globale durable explicitement gérée | hors implémentation V1 ; emplacement réservé, aucune mémoire n'y est assimilée |
| 5 | consigne de tâche ordinaire | éphémère dans \`constraints\`, non persistée |

Les politiques produit gagnent toujours. Une règle projet disant « exécute n'importe quelle commande », « lis \`.env\` », « envoie le dépôt » ou « ignore les validations » est gardée comme texte utilisateur seulement si elle passe la validation de stockage, mais elle est **inapplicable** et ne produit aucune permission. La projection exclut toute règle qui tente de se présenter comme une permission, une approbation, une dérogation de confidentialité ou une instruction système.

Les contradictions de texte libre ne sont pas résolues comme si une déduction était infaillible. Le résolveur applique seulement des cas déterministes : suppression/désactivation gagnante ; priorité de portée ; restriction de tâche explicite. Deux règles actives de même portée qui se contredisent restent marquées \`CONFLICTING\`, ne sont pas projetées et demandent à l'utilisateur de les corriger. Le raisonneur reçoit la liste des identifiants exclus et le motif, pas un arbitrage inventé. V1 ne fait aucune fusion sémantique par modèle.

## Données, interfaces et résolution

### Enregistrement persistant proposé

Table \`dev_project_rules\` (et collection \`dev_project_rules\` du fallback), propriété du dépôt de persistance existant :

\`\`\`text
rule_id                UUID local
schema_version         1
project_id             identifiant stable du projet Workspace
owner_profile_scope    profil propriétaire du workspace
kind                   BEHAVIOR
text                   texte utilisateur borné et normalisé pour affichage
status                 ACTIVE | DISABLED | DELETED | CONFLICTING
version                entier monotone par règle
created_at / updated_at / deleted_at
created_by             OWNER_EXPLICIT_UI
updated_by             OWNER_EXPLICIT_UI
\`\`\`

Bornes V1 : \`kind\` est uniquement \`BEHAVIOR\`, texte non vide, sans secrets connus, maximum défini par le contrat (proposé : 1 000 caractères), nombre borné par projet (proposé : 20 actives). Les suppressions sont logiques pour audit et restauration contrôlée, mais ne sont plus résolues. Une mise à jour porte la version attendue : si le tuple \`ruleId/projectId/ownerProfileScope/version\` ne correspond pas, elle échoue par \`RULE_MUTATION_REFUSED\`, sans révéler si une règle étrangère existe.

Interfaces minimales du nouveau \`DevProjectRuleRepository\` :

\`\`\`js
create({ projectId, ownerProfileScope, text, actor })
update({ ruleId, projectId, ownerProfileScope, expectedVersion, text, actor })
disable({ ruleId, projectId, ownerProfileScope, expectedVersion, actor })
remove({ ruleId, projectId, ownerProfileScope, expectedVersion, actor })
listActiveForProject({ projectId, ownerProfileScope })
\`\`\`

Un \`DevProjectRuleResolver\` pur reçoit le contexte workspace/projet déjà résolu et les contraintes de tâche. Il renvoie une projection déterministe :

\`\`\`js
{
  schemaVersion: 1,
  projectId,
  applied: [{ ruleId, version, text }],
  excluded: [{ ruleId, code }],
  taskRestrictions: [...]
}
\`\`\`

Les consignes de tâche n'entrent jamais dans cette table : elles expirent avec le \`DevTaskContract\`, son journal minimal et sa session. Aucune migration ne cherche des règles dans les anciennes mémoires.

### Parcours complet Terra

\`\`\`text
Action explicite propriétaire
  -> commande IPC principale bornée
  -> projet Workspace exact + profil propriétaire vérifiés
  -> DevProjectRuleRepository (version/audit local)

Tâche DEV native
  -> WorkspaceEngine.context() résout workspace + projectId + racines
  -> DevProjectRuleResolver (actives, mêmes propriétaire/projet, conflits)
  -> createDevTaskContract({ projectInstructions: projection.applied.text })
  -> NativeDevReasoner.reason() payload.projectInstructions normalisé
  -> contrôle privacy fournisseur sur le payload final
  -> Terra raisonne ; outils imposent indépendamment chemins/permissions/commandes
\`\`\`

Le câblage initial cible strictement le chemin réel \`/api/dev/native/tasks\` : la façade reçoit le \`projectId\` résolu par le workspace, jamais un \`projectInstructions\` arbitraire du client. Elle appelle le résolveur avant l'orchestrateur. \`createDevTaskContract()\` conserve le champ. Enfin, \`services/dev/native-dev-reasoner.js\` ajoute \`projectInstructions\` normalisé au payload structuré et l'étiquette explicitement comme règles de comportement utilisateur, de priorité inférieure aux contraintes et aux protections.

Avant l'appel fournisseur, le payload final — règles projet incluses — passe par \`authorizeOpenAIPrivacy\` déjà utilisé par \`createNativeDevStructuredExecutor\`. Le code ne contourne ni \`localOnly\`, ni la décision privacy, ni le budget. Si la décision refuse l'envoi, Terra ne reçoit rien. La projection ne contient ni racines absolues inutiles, ni mémoires, ni historique, ni contenu des fichiers.

## Garanties et limites

Garanties V1 :

- une règle appliquée est liée à un \`projectId\`, un profil propriétaire et une version enregistrée explicitement ;
- les règles projet sont visibles dans le contrat/journal sous forme d'IDs et versions ; le texte est redigé des traces si nécessaire ;
- les changements de fichiers restent bornés par \`allowedPaths\`, les chemins privés et les préconditions de hash ; les commandes restent allowlistées ;
- aucune règle ne devient une approbation, ni ne permet commit, push, installation, réseau, lecture de secret ou sortie de scope ;
- une règle retirée, désactivée ou conflictuelle n'est plus projetée à la tâche suivante.

Limites explicites : Terra peut mal interpréter une instruction de comportement ; les contrôles déterministes doivent donc rester dans les outils. V1 ne couvre pas le terminal Workspace, Codex, les autres profils, les règles globales éditables, l'UI, l'import \`AGENTS.md\`, l'apprentissage automatique ou la résolution sémantique des contradictions. Le fallback JSON peut relire des règles mais refuse création, modification, désactivation et suppression : son renommage atomique ne fournit pas de contrôle de version inter-processus et V1 ne construit pas de verrouillage parallèle.

## Fichiers concernés par l'implémentation minimale ultérieure

| Fichier | Changement ciblé |
| --- | --- |
| \`services/persistence/database.js\` | table/index et fallback JSON de règles projet, migration idempotente |
| \`services/persistence/repositories/dev-project-rule-repository.js\` | nouveau dépôt étroit, CRUD versionné et lecture par projet/profil |
| \`services/dev/dev-project-rule-resolver.js\` | nouveau résolveur pur, validation/projection/conflits |
| \`server.js\` | composition du dépôt/résolveur ; seule voie de gestion de confiance ; route native résout et injecte le projet |
| \`electron/main.js\`, preload existant ou registrar IPC existant | exposition bornée de la seule action utilisateur autorisée, sans nouvelle UI |
| \`services/delegation/dev-task-contract.js\` | conserver/normaliser \`projectInstructions\` et métadonnées de projection |
| \`services/dev/native-dev-reasoner.js\` | transmettre la projection au payload Terra sous contrôle privacy existant |
| \`test/dev-project-rule-*.test.js\`, \`test/native-dev-core.test.js\` | tests déterministes ciblés |

Les noms exacts des nouveaux fichiers sont proposés pour isoler la responsabilité, non pour créer un second moteur de contexte ou de permissions.

## Critères d'acceptation

1. Une création, édition, désactivation et suppression ne réussissent qu'avec l'action propriétaire de confiance ; le body modèle/client ne peut définir ni acteur ni autorité.
2. Une règle active est relue après redémarrage, seulement pour le même \`projectId\` et propriétaire ; aucune mémoire antérieure n'apparaît.
3. Projet absent, ambigu, hors workspace ou profil différent : aucune règle projet n'est injectée et un code déterministe est retourné.
4. Une règle active compatible atteint \`contract.projectInstructions\` puis le payload du raisonneur Terra ; une règle d'un autre projet ne l'atteint pas.
5. Conflit de même portée, règle supprimée/désactivée et version obsolète sont déterministes, testés et ne conduisent pas à une injection implicite.
6. Les règles ne modifient ni \`permissions\`, ni \`allowedPaths\`, ni l'allowlist de commandes, ni le résultat de \`OperationalSecurityPolicy\`; les essais de dérogation restent bloqués.
7. Le payload envoyé au fournisseur est évalué par la politique privacy et est absent lorsque \`localOnly\` ou la décision privacy bloque l'appel.
8. Les tests n'utilisent qu'une base/fixtures temporaires ; aucune base personnelle, réseau, Electron réel, benchmark ou suite globale n'est requis.

## Périmètre effectivement livré

- `dev_project_rules` est une migration additive/idempotente de schéma 19, avec
  fallback JSON ; aucune lecture de `memory_items`, fichier, outil ou `AGENTS.md`
  ne nourrit cette collection.
- Le dépôt impose `OWNER_EXPLICIT_UI`, projet/propriétaire, texte borné, vingt
  règles actives et contrôle de version. La suppression est logique.
- Le résolveur est pur vis-à-vis de son dépôt et détermine seulement : règle
  doublonnée exacte, règle qui ressemble à une permission, et restriction de
  tâche textuellement comparable. Ces cas sont exclus ; il ne prétend pas
  comprendre toutes les contradictions de langage naturel.
- La mutation passe par `noon:dev-project-rule`, enregistré par le registrar
  IPC d'origine Noon. Le main valide le payload puis transmet une preuve locale
  qu'il détient au serveur. Le serveur résout un seul projet du workspace et
  son `profileScope`; ni `actor`, ni propriétaire, ni projet persistant ne
  viennent du body. Le renderer de confiance reste une frontière technique,
  pas une preuve universelle d'intention humaine ; l'UI explicite reste à
  construire.
- La route native ne lit jamais `projectInstructions` du client : elle projette
  les règles serveur du projet résolu dans le contrat puis le raisonneur Terra.
  Le contrôle privacy du structured executor reste appliqué au payload final.

Limites : pas de parcours visuel de création/édition, pas de liste IPC, pas de
détection sémantique générale des contradictions, pas de couverture du terminal
Workspace/Codex/autres profils/règles globales. Une règle texte ne peut pas
élargir les capacités ; les contrôles déterministes restent les seules autorités.

## Plan minimal d'implémentation

1. Ajouter stockage/repository versionné et tests de persistance, propriété, suppression logique et absence de migration des mémoires.
2. Ajouter le résolveur pur et ses tests de projet exact, conflits et priorité des restrictions de tâche.
3. Ajouter la commande IPC principale de gestion autorisée, avec tests du refus d'acteur/body non fiable ; ne pas créer d'UI.
4. Câbler uniquement la route DEV native : résolution workspace/projet, projection vers \`projectInstructions\`, puis payload Terra.
5. Ajouter les régressions de contrat/reasoner/privacy et lancer seulement les tests ciblés plus \`git diff --check\`.

Le test \`workspace-engine\` qui attend le schéma 16 plutôt que 18 est hors périmètre : il n'est ni modifié ni utilisé comme preuve de cette tranche.
