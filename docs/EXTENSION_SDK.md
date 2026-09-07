# Noon Extension & Plugin SDK

## Périmètre de sécurité

La version 1 exécute uniquement des extensions internes, bundled ou de développement explicitement autorisées. Son niveau d’isolation est `IN_PROCESS_TRUSTED`. Un worker Node ne constituant pas une frontière de sécurité, Noon ne prétend pas exécuter du code hostile en sandbox. Les extensions externes non signées et les provenances inconnues restent désactivées ou en quarantaine.

Une extension enrichit Noon mais n’obtient aucune autorité. Elle ne reçoit ni base interne, ni mémoire, ni orchestrateur, ni `process.env`, ni clé OpenAI. Les mutations passent obligatoirement par `OperationalSecurityPolicy`, l’approbation éventuelle et `TransactionalExecutionEngine`.

## Manifest v1

```json
{
  "id": "com.example.noon.search",
  "name": "Example Search",
  "version": "1.0.0",
  "apiVersion": "1",
  "type": "SEARCH_PROVIDER",
  "entrypoint": "./index.js",
  "capabilities": ["example.search"],
  "permissions": ["READ"],
  "skills": [],
  "configSchema": null,
  "supportedPlatforms": ["darwin"],
  "minimumNoonVersion": "1.0.0",
  "allowedDomains": []
}
```

`version` décrit le package. `apiVersion` décrit le contrat SDK Noon. `minimumNoonVersion` empêche le chargement dans une application trop ancienne. Les champs inconnus sont refusés. Les IDs de skills sont obligatoirement namespacés par l’ID stable de l’extension.

## Capacités et permissions

Les capacités décrivent ce que fournit le module. Les permissions décrivent les ressources ou classes d’action demandées. Installer une extension n’autorise aucune action métier. `READ`, `PREPARE`, `WRITE`, `EXECUTE`, `DESTRUCTIVE` et `EXTERNAL` réutilisent le langage de sécurité de Noon ; les ressources comme `network.external` ou `credentials.github` doivent aussi être déclarées.

## Lifecycle

`DISCOVERED → DISABLED → ENABLING → ENABLED`, avec les états `DEGRADED`, `FAILED`, `INCOMPATIBLE` et `QUARANTINED`. L’installation est désactivée par défaut. Une mise à jour ajoutant une permission revient à `DISABLED` et exige une nouvelle revue. Désinstaller conserve les données namespacées sauf suppression explicitement demandée.

## SDK minimal

```js
const { defineExtension } = require("./services/extensions");

module.exports = defineExtension({
  manifest,
  activate(context) {
    return { skills: { "com.example.noon.search.query": handler } };
  },
  healthCheck: async () => ({ ok: true })
});
```

La surface publique se limite à `defineExtension`, `defineSkill`, `defineConnector`, `defineContextAdapter` et `defineArtifactRenderer`. Le contexte d’activation ne contient que l’identité de l’extension, ses capacités déclarées et le niveau d’isolation. Le contexte d’invocation ajoute un logger expurgé, un signal d’annulation, un stockage namespacé, et des façades réseau/credential bornées.

## Schémas et résultats

Chaque skill fournit un schéma d’entrée et de sortie objet strict (`additionalProperties: false`). Une sortie invalide provoque `EXTENSION_SCHEMA_VALIDATION_FAILED` et n’est jamais transmise au modèle. Un résultat valide devient une enveloppe structurée avec capacité, données, provenance non fiable, warnings, état partiel et métriques.

## Fichiers, réseau et credentials

Le loader ne scanne jamais le disque : il accepte uniquement des racines configurées, résout les realpaths, refuse les packages symlink et les entrypoints sortant du package. La façade réseau exige `network.external`, HTTPS et un hostname présent dans `allowedDomains`. La façade credential retourne uniquement un handle scopé lorsque la permission `credentials.<service>` est déclarée. Elle n’expose jamais la clé OpenAI.

## Santé, erreurs et observabilité

Les health checks doivent être peu coûteux, non destructifs et sans donnée privée. Trois échecs consécutifs placent l’extension en quarantaine et retirent ses skills. Les événements ne contiennent ni input, ni output, ni secret, ni nom de fichier privé. L’API locale `GET /api/extensions` expose seulement les métadonnées nécessaires au futur Control Center.

## Exemple et tests

`services/extensions/sample/noon-example-search.js` est une source read-only, locale, sans secret ni réseau. Les tests couvrent manifests, compatibilité, collisions, lifecycle, permission review, mutation transactionnelle, policy/approval, schémas, timeout, annulation, crash/quarantaine, stockage, réseau, contexte minimal et confidentialité des logs.

## Limites connues

- `IN_PROCESS_TRUSTED` n’empêche pas un module Node malveillant importé de lire directement `process.env` ou `fs`. Pour cette raison, aucun plugin tiers arbitraire n’est supporté.
- La signature cryptographique externe n’est pas implémentée ; le manifest conserve provenance, état `signed` et fingerprint SHA-256 en préparation d’un mécanisme standard.
- Les migrations, commandes, renderers, providers et job types ont un contrat de manifest mais leur branchement dynamique complet viendra extension par extension, derrière les registries canoniques correspondants.
