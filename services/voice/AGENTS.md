# Instructions voix et Wake Word pour Noon

Les règles de `AGENTS.md` situé à la racine restent applicables. Ce fichier ajoute des contraintes spécifiques à la voix, au Wake Word et à Conversation Live. `AGENTS_ARCHITECTURE.md` décrit les agents internes de Noon et ne doit pas être remplacé par ce fichier. En cas de règle plus restrictive ici, respecter la règle la plus restrictive.

## Continuité et permissions

- Protéger le fonctionnement du chat texte même si la voix tombe en panne.
- Préserver Conversation Live et le micro classique.
- Respecter la sélection du microphone et de la sortie audio.
- Gérer correctement les permissions microphone macOS.
- Ne jamais laisser deux moteurs monopoliser simultanément le microphone.
- Arrêter et réactiver proprement le Wake Word autour d’une session vocale lorsque nécessaire.
- Une erreur du Wake Word ne doit pas empêcher Noon de démarrer.
- Préférer un fonctionnement local pour la détection du mot-clé.
- Surveiller CPU et mémoire pour un moteur qui écoute en permanence.
- Vérifier les dépendances natives et le packaging Electron en x64 et arm64.
- Conserver un fallback contrôlé pendant une migration si cela réduit les risques.
- Ne supprimer une ancienne implémentation qu’après validation suffisante de la nouvelle.
- Ne jamais présenter une fonction vocale comme validée si le test matériel avec microphone n’a pas réellement été effectué.
- Séparer clairement test automatisé et test réel avec microphone.
