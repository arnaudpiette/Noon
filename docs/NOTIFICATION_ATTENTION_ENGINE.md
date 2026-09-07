# Notification & Attention Engine

Le moteur `services/notifications/` est l’unique couche de décision entre une information utile et sa livraison. Il ne décide ni de l’importance métier, ni de l’exécution d’une action.

## Flux

1. Une source produit un `AttentionRequest` canonique.
2. Le store SQLite persiste la demande et son identité de déduplication.
3. La policy applique expiration, Focus, quiet hours, présence, budget d’attention, appareil actif et confidentialité.
4. Le routeur crée un `DeliveryRecord` par canal autorisé.
5. Une interaction produit un intent `trusted_ui`; elle ne contourne jamais Security ni Approval.

Les états de livraison restent distincts : `DELIVERED` ne signifie jamais `SEEN`. Une ouverture explicite est requise. Toute action devenue obsolète est refusée après revalidation de sa source.

## Canaux et rollout

- `IN_APP`, `MACOS_NOTIFICATION` et `BADGE` disposent d’un contrat de capacité.
- `MOBILE_PUSH` reste désactivé tant que l’appareil et le scope `NOTIFICATIONS` ne sont pas validés.
- `VOICE` reste désactivé par défaut et exige une session vocale active ainsi qu’une préférence explicite.
- Le moteur central démarre en `SHADOW` : il calcule et persiste les décisions sans doubler les notifications historiques.

## Confidentialité

`NORMAL`, `PRIVATE`, `PROTECTED` et `LOCAL_ONLY` sont filtrés avant composition du payload visible. `LOCAL_ONLY` et toute donnée dérivée de celle-ci ne quittent jamais le Mac. Les journaux ne contiennent ni titre ni corps de notification.

## Exploitation

```bash
npm run lint:notifications
npm run eval:notifications
node --test test/notification-attention-engine.test.js
```

Le `BackgroundJobEngine` produit désormais ses changements d’état via cette façade. Les autres producteurs historiques seront migrés progressivement après comparaison du mode shadow, sans double livraison.
