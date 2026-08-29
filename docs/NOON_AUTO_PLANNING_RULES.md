# Règles de planification automatique

L’organisation automatique est limitée aux nouveaux blocs personnels créés par Noon dans l’agenda cible configuré.

- horaires par défaut : 09:00–18:30, du lundi au vendredi ;
- pause inviolable : 12:30–13:30 ;
- tampon par défaut autour des rendez-vous : 10 minutes ;
- bloc Focus maximal : 90 minutes ; les tâches longues sont découpées ;
- couleur Google Calendar : Myrtille/Blueberry, identifiant validé `9` dans le catalogue de couleurs ;
- titre : `Noon — …` ;
- aucune personne invitée, invitation, visioconférence ou mise à jour envoyée ;
- `sendUpdates=none` pour toutes les écritures autorisées ;
- signature privée obligatoire : `managedBy=noon`, `sourceType`, `sourceId`, `planningKey`.

Avant création, Noon recherche `planningKey`. Une opération rejouée retourne le bloc existant. Les modifications et suppressions refusent tout événement sans signature Noon.

Une confiance inférieure à 75 % entraîne seulement une proposition. Si aucun créneau n’existe avant l’échéance, Noon n’ajoute rien et le signale dans le brief.
