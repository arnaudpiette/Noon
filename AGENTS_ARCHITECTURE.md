# Architecture des agents Noon

Noon utilise des profils, pas cinq IA permanentes. `lib/agent-router.js` sélectionne un seul profil principal : Mail, Planning, OpenClassrooms, DEV ou Design/DA.

Chaque profil définit rôle, outils autorisés/interdits, mode, nombre maximal d’étapes, budget partagé et politique d’approbation. Il n’existe ni délégation cachée ni boucle entre agents. Toute écriture extérieure garde le système d’approbation commun.

Pour les demandes de développement complexes, Noon peut consulter Codex avec l’outil local `ask_codex`. Cette consultation exige un projet Focus, reste limitée à son dossier, utilise le bac à sable `read-only` et une session éphémère, puis revient à Noon pour la réponse finale. Codex ne peut donc ni modifier le projet ni déclencher une action extérieure depuis cette intégration.
