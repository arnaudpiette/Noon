# Configuration de « Salut Noon »

La détection est locale. Aucun son n’est enregistré ni envoyé à OpenAI avant le réveil de Noon.

1. Créer ou ouvrir un compte sur Picovoice Console.
2. Copier votre **AccessKey**.
3. Créer le mot-clé français `Salut Noon`.
4. Choisir macOS et l’architecture Intel/x86_64.
5. Télécharger le fichier personnalisé `.ppn`.
6. Télécharger le modèle français `.pv` requis.
7. Dans Noon, ouvrir Réglages → **Réveil vocal — Salut Noon**.
8. Enregistrer l’AccessKey. Elle est chiffrée par le coffre macOS et n’est jamais renvoyée au renderer.
9. Importer le `.ppn`, puis le `.pv`.
10. Choisir le microphone et commencer avec la sensibilité modérée `0,50`.
11. Autoriser le microphone lorsque macOS le demande.
12. Tester « Salut Noon », puis activer le lancement à l’ouverture de session si souhaité.

Le Brief Noon est préparé chaque jour à 7 h, heure de Paris, ou rattrapé au prochain lancement. Après « Salut Noon », l’application répond « Bonjour Arnaud », affiche le point du jour et le lit si la réponse vocale est activée.

Une sensibilité élevée réduit les détections manquées mais augmente les faux positifs. Conversation Live suspend automatiquement le moteur local afin que les deux systèmes ne capturent jamais le microphone simultanément. Après une détection, l’écoute locale reprend automatiquement à la fin du délai de lecture.
