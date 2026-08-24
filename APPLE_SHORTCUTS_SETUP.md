# Configurer « Noon – Rappel »

Ne remplacez pas le raccourci existant. Ouvrez-le dans Raccourcis et vérifiez :

1. Accepter Texte depuis la feuille de partage.
2. Si l’entrée existe, définir `Texte rappel` avec cette entrée.
3. Sinon, utiliser Dicter du texte ou Demander une entrée.
4. Extraire les dates de `Texte rappel`.
5. Si une date existe, la conserver ; sinon demander uniquement la date.
6. Si une heure est détectée, la conserver ; sinon demander seulement l’heure si le rappel doit être daté.
7. Ajouter un rappel dans la liste `Noon` ou `Noon Inbox`.
8. Afficher ou prononcer une confirmation courte.

Activez la feuille de partage dans les détails du raccourci. Siri peut lancer le raccourci en prononçant exactement « Noon Rappel » sur Mac ou iPhone.

Tests : entrée depuis Notes, dictée sans entrée, date et heure présentes, date absente, heure absente. Noon utilise sur Mac `shortcuts run "Noon – Rappel"` avec le texte transmis via l’entrée standard ; aucune commande shell libre n’est créée.

Le bridge EventKit natif reste désactivé tant qu’un projet macOS signé et l’autorisation Rappels ne sont pas configurés. Aucun port Internet n’est ouvert.
