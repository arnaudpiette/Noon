# Confidentialité et permissions

Le serveur écoute exclusivement sur `127.0.0.1:3000`. Il n’est ni exposé au réseau local ni à Internet. Les routes privées utilisent un secret aléatoire chiffré par `safeStorage`; sa valeur n’est jamais transmise au DOM.

- Microphone : demandé uniquement au démarrage d’une fonction vocale.
- Notifications : demandées après activation explicite.
- Rappels/Raccourcis : uniquement pour les actions Apple choisies.
- Caméra, accès complet au disque et droits administrateur : non demandés.

Les liens externes doivent utiliser HTTPS et s’ouvrent dans le navigateur par défaut.
