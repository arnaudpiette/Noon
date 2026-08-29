# Checklist d’acceptation Noon

## Automatique

- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run package`
- [x] `npm run verify:mac`
- [x] Migration d’un ancien tableau d’historique vers « Général »
- [x] Refus du 16e dossier
- [x] Refus de la 16e conversation d’un dossier, sans suppression
- [x] Refus d’un déplacement vers un dossier plein
- [ ] Conservation de l’historique brut après redémarrage

## Conversation

- [ ] Créer, reprendre, rechercher, renommer et supprimer une conversation
- [ ] Vérifier le streaming et le bouton Arrêter
- [ ] Couper le réseau, vérifier le brouillon et Réessayer
- [ ] Fermer puis rouvrir Noon et retrouver tous les messages

## Voix et matériel

- [ ] Autoriser/refuser le microphone dans macOS
- [ ] Tester micro interne, casque filaire et AirPods
- [ ] Changer de microphone pendant une session puis reconnecter
- [ ] Démarrer/arrêter Conversation Live et vérifier qu’une seule session existe
- [ ] Interrompre Noon en parlant et avec Échap
- [ ] Couper/réactiver le micro
- [ ] Vérifier transcription et réponse écrite simultanées
- [ ] Couper le réseau, observer les deux tentatives, puis reprendre
- [ ] Mettre le Mac en veille, reprendre et vérifier les périphériques
- [ ] Vérifier que l’audio temporaire n’est pas persisté
- [ ] Vérifier qu’une action sensible demande aussi une validation visuelle

## Brief

- [ ] Lancer avant 7 h, exactement à 7 h et après 7 h
- [ ] Tester reprise de veille et rattrapage après application arrêtée
- [ ] Vérifier une seule génération par date Paris
- [ ] Cliquer la notification et ouvrir l’écran Brief
- [ ] Tester lundi et planche de tendances lundi/mercredi/vendredi

## Sécurité locale

- [ ] Lire un fichier autorisé
- [ ] Refuser un chemin hors racine, `../` et un lien symbolique sortant
- [ ] Retirer une autorisation et vérifier son effet immédiat
- [ ] Confirmer qu’aucune clé n’apparaît dans DevTools, localStorage ou logs

## Livrables

- [x] Générer et relire DOCX, PDF, PNG, XLSX et PPTX minimaux
- [x] Générer Markdown, HTML et RTF minimaux
- [x] Refuser un dossier non autorisé
- [x] Versionner deux créations de même nom sans écrasement
- [ ] Contrôler visuellement une présentation, un document et une image complexes
