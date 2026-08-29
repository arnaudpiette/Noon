# Session Continuity Engine

## Rôle

La continuité de Noon sépare deux responsabilités :

- la **conversation** conserve l'historique logique des messages ;
- la **session** conserve seulement l'état opérationnel utile à une reprise.

`SessionContinuityEngine` est l'unique façade de l'état sessionnel. Le
Conversation Store, le Workspace Engine, l'Approval Engine, l'Artifact Engine
et le Memory Engine restent les autorités de leurs propres données.

## Schéma canonique

Une session contient notamment un identifiant stable distinct du
`conversationId`, le profil, le workspace et le projet actifs, le mode, le
dernier canal, les références de tâche, artefact, recherche et plan courants,
l'exécution active, les identifiants d'approbation, les entités récentes, un
résumé compact et un checkpoint de reprise.

Les états possibles sont `active`, `idle`, `suspended` et `closed`. Une session
fermée n'efface jamais la conversation. Une nouvelle session peut donc être
liée plus tard au même historique.

## Politique de réutilisation

- même conversation et même profil : réutilisation de la session non fermée ;
- conversation dont la session est fermée : création d'une nouvelle session ;
- passage chat/voix ou reconnexion WebRTC : conservation de la session métier ;
- l'identifiant de connexion Realtime reste purement technique.

## Persistance et reprise

Le stockage canonique utilise les tables SQLite `continuity_sessions`,
`continuity_checkpoints` et `conversation_segments`. Le fallback de la base
personnelle existante est réutilisé si SQLite n'est pas disponible ; aucun
fichier JSON isolé n'est introduit.

L'état est persisté à la fin d'un message, lors d'un changement important,
d'un changement de workspace, d'une suspension ou d'un checkpoint. Il n'est
jamais écrit à chaque token de streaming.

Au démarrage, une session qui était active devient `suspended`, son exécution
en cours devient une référence `interrupted` et aucun outil, socket, timer,
rendu ou action externe n'est relancé. Les approbations sont relues depuis
l'Approval Engine et la session ne conserve que leurs identifiants.

## Résumé, checkpoint et historique

Le résumé est incrémental et mis à jour uniquement après un seuil de messages,
de caractères ou un changement de sujet explicite. Il conserve une version et
le dernier message couvert, puis est compacté lorsqu'il dépasse son budget.

Le checkpoint contient uniquement les références courantes, le workspace, le
projet, le mode, la version du résumé, les questions ouvertes et quelques
références récentes. Il ne contient ni prompt complet, ni historique complet,
ni contenu de fichier, ni arguments d'outil.

La reprise charge le résumé et une queue bornée de messages. L'historique plus
ancien n'est recherché qu'à la demande via le moteur de recherche personnel.

## Références récentes et confidentialité

Les fichiers, tâches, artefacts, recherches, résultats, workspaces et autres
entités sont conservés sous forme d'identifiants, libellés courts et versions.
Ils expirent selon leur type. Une référence expirée ou ambiguë n'est jamais
résolue arbitrairement.

Les snapshots n'enregistrent pas les corps d'e-mails, contenus de fichiers,
prompts privés, mémoires déchiffrées ou paramètres exécutables. Le profil fait
partie de la clé de résolution et empêche une reprise croisée. Les diagnostics
et métriques n'exposent jamais le texte du résumé.

La continuité est locale et indépendante du modèle. Les requêtes privées
continuent d'utiliser `store: false` selon la politique existante de Noon.

## Migration progressive

Les identifiants de conversation historiques provenant du renderer restent
acceptés comme adaptateurs legacy. Au premier accès, une session canonique est
créée ou réutilisée, sans réécrire l'historique existant. Le chat, la voix,
Realtime, l'Intent Engine et le Context Builder adoptent ensuite l'identifiant
de session canonique. Les états purement UI (panneau, scroll, fenêtre) restent
dans le renderer.

## Diagnostic local

`GET /sessions/diagnostics` retourne uniquement les identifiants, l'état, le
workspace, le mode, le nombre de références et la version du résumé.
`POST /sessions/resume` et `POST /sessions/suspend` exigent l'en-tête local
`X-Noon-Request: 1`.

