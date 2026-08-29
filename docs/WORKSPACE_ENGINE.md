# Workspace Engine

`WorkspaceEngine` est la façade centrale qui relie un espace de travail à ses projets, racines locales autorisées, conversations, artefacts et scope mémoire. Les anciens catalogues Focus et projets restent disponibles comme adaptateurs pendant la migration.

## Garanties

- L’identité repose sur `workspaceId`, jamais sur un nom mutable.
- Une résolution de nom ambiguë ne change pas le Focus actif.
- Les racines sont résolues avec `realpath` et contrôlées contre les permissions locales.
- Une conversation appartient au plus à un Workspace ; son déplacement ne duplique pas son contenu.
- Archiver ou supprimer logiquement un Workspace ne supprime pas ses projets, conversations ou artefacts.
- La recherche reçoit la liste explicite des projets du Workspace et filtre les résultats avant exposition.
- Les événements techniques ne contiennent ni chemins locaux ni contenu utilisateur.

## Migration

`ensureLegacy()` crée une projection idempotente à partir d’un identifiant Focus et de sa racine explicite. Les lectures legacy sont conservées, ce qui permet une migration progressive et un retour arrière sans perte. Aucun homonyme n’est fusionné automatiquement.

## API locale

- `GET /workspaces` liste le registre et les emplacements autorisés.
- `POST /workspaces` crée un Workspace et ses liaisons explicites.
- `GET|PATCH /workspaces/:id` lit ou modifie ses métadonnées.
- `POST /workspaces/:id/activate` active le Workspace.
- `POST /workspaces/:id/archive` l’archive sans cascade.
- `POST /workspaces/:id/conversations` déplace une conversation.
- `POST /workspaces/:id/artifacts` lie un artefact.

Les données restent dans la base locale SQLite existante, avec le fallback JSON historique si `node:sqlite` n’est pas disponible.
