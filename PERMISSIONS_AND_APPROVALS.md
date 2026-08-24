# Permissions et autorisations

- Niveau 1 : lecture, diagnostic et rapport local autonomes.
- Niveau 2 : préparation locale versionnée, sans écraser l’original.
- Niveau 3 : écriture distante après aperçu exact et autorisation ponctuelle.
- Niveau 4 : confirmation renforcée pour suppression ou perte possible.

Une autorisation expire après cinq minutes, est utilisable une seule fois et lie fournisseur, action, cible et hash du contenu. Modifier le destinataire, le contenu ou l’étape impose une nouvelle autorisation. Commit et push sont deux actions distinctes.

Toujours bloqués : force-push, reset hard, suppression de branche distante, réécriture d’historique, commande shell libre, lecture de `.env` et suppression automatique d’un original.

L’historique d’audit masque les secrets et ne conserve que les métadonnées nécessaires.
