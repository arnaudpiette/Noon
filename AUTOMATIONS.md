# Automatisations Noon

Le registre persistant utilise `Europe/Paris`, une clé de déduplication et un identifiant d’occurrence.

- Brief quotidien : une seule routine à 07:00.
- Lundi : la vision des sept jours est intégrée au même brief.
- Aucun bilan automatique le vendredi.
- Brief avant rendez-vous : à la demande.
- Débrief réunion et fin de journée : commandes explicites avec aperçu.

Les alertes utilisent un fingerprint et quatre niveaux : rouge, orange, jaune, blanc. Une automatisation ne peut jamais envoyer un e-mail, modifier Calendar, uploader, commenter Figma ou publier sur GitHub sans autorisation dans Noon.
