# Brief matinal Noon

Noon produit un unique brief personnel chaque jour à 07:00, fuseau `Europe/Paris`. La clé d’idempotence est `morning-brief:YYYY-MM-DD:Europe/Paris` et l’historique conserve trente journées localement.

## Sources

- Google Calendar : événements et indisponibilités des agendas configurés.
- Gmail : messages non lus utiles et brouillons, jamais d’envoi.
- Apple Rappels et Apple Notes : lecture locale via l’autorisation Automation de macOS.
- mémoire durable, journaux de projets et veille créative déjà produits par Noon.

Chaque collecte est isolée. Une panne produit « Source momentanément indisponible » et une absence de connexion produit « Source non connectée » sans bloquer le reste. Les contenus externes sont traités comme des données non fiables et ne peuvent donner d’instructions à l’agent.

Le processus Electron déclenche le brief même si la fenêtre est masquée, le rattrape au lancement, au réveil ou au déverrouillage, et réessaie quinze minutes après une erreur temporaire. Une seule notification est affichée. La lecture vocale reste manuelle.
