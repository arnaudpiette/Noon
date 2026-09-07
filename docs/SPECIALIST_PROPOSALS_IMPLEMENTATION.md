# Boucle fermée : Propositions de Spécialistes → Approbation

## Problème résolu

**Avant** : Les `proposedToolRequests` retournés par `DelegationEngine` étaient silencieusement jetés.
**Après** : Elles sont routées vers `OperationalSecurityPolicy`, évaluées, et présentées à l'utilisateur pour approbation.

## Changements implémentés

### 1. OperationalSecurityPolicy (operational-security-policy.js)

#### Nouvelle propriété
- `isSpecialistProposal: boolean` → Flag pour traiter les propositions spéciales

#### Modification de la logique d'évaluation
**Avant** :
```javascript
if (["external_content", "model_generated", ...].includes(request.origin) && mutating) {
  add(REASON_CODES.UNTRUSTED_ORIGIN);
  blockedBy.push(REASON_CODES.HARD_RULE_DENY);  // ← DENY direct
}
```

**Après** :
```javascript
// Pour outils normaux : refuser comme avant
if ([...].includes(request.origin) && mutating && !request.isSpecialistProposal) {
  add(REASON_CODES.UNTRUSTED_ORIGIN);
  blockedBy.push(REASON_CODES.UNTRUSTED_ORIGIN);
}
// Pour propositions : demander approbation au lieu de refuser
if (request.isSpecialistProposal && [...].includes(request.origin) && mutating) {
  add(REASON_CODES.APPROVAL_REQUIRED);  // ← REQUIRE_APPROVAL
}
```

### 2. NoonOrchestrator (noon-orchestrator.js)

#### Nouvelle fonction `processProposedToolRequests(state)`
- Examine `state.delegation.toolRequests`
- Pour chaque proposition avec `authority: "UNTRUSTED_PROPOSAL"` :
  - Crée un `ActionRequest` avec `isSpecialistProposal: true`
  - Évalue via `operationalSecurityPolicy.evaluate()`
  - Si `outcome === "REQUIRE_APPROVAL"` : prépare approbation
  - Stocke en attente dans `pending` map

**Retour** :
- `null` si aucune approbation requise
- `{ __approvalRequired: true, approval, proposalCount }` sinon

#### Appel intégré dans le flux principal
Ligne 803 (après `delegationEngine.run()`) :
```javascript
const proposalApproval = await processProposedToolRequests(state);
if (proposalApproval?.__approvalRequired) {
  return {
    status: "approval_required",
    type: "specialist_proposal",
    text: "1 proposition de spécialiste nécessite votre confirmation.",
    metadata: { ... },
  };
}
```

#### Modification de `resumeWorkflow()`
Ajout d'une première branche pour `workflow.type === "specialist_proposal"` :
- Rejet : annule, trace, continue
- Approbation : marque approuvée, ajoute au contexte, continue

### 3. Tests (specialist-proposals-integration.test.js)

Test d'intégration vérifiant :
✅ Création d'ActionRequest avec `isSpecialistProposal: true`
✅ Évaluation → `REQUIRE_APPROVAL`
✅ Préparation d'approbation
✅ Résumé d'approbation
✅ Circuit complet

## Flux visuel

```
┌─ DelegationEngine.run()
│  └─ Retourne { toolRequests: [{ skillId, operation, purpose, authority: "UNTRUSTED_PROPOSAL" }] }
│
├─ processProposedToolRequests()
│  ├─ Pour chaque proposal:
│  │  ├─ createActionRequest(isSpecialistProposal: true)
│  │  ├─ evaluate()
│  │  │  ├─ origin: "model_generated" + mutating
│  │  │  ├─ → APPROVAL_REQUIRED (pas DENY grâce au flag)
│  │  │
│  │  └─ prepareAction()
│  │
│  └─ Retourne { __approvalRequired: true, approval, proposalCount }
│
├─ User Approval Interface
│  └─ "DEV propose d'envoyer le brouillon. Approuver ?"
│
├─ resumeWorkflow(type: "specialist_proposal")
│  ├─ Si REJECT: continue sans proposition
│  ├─ Si APPROVE:
│  │  ├─ Marque approuvée dans state.proposalResults
│  │  ├─ Ajoute à state.context.runtime.approvedSpecialistProposals
│  │  └─ continue normalement
│
└─ Model voit les propositions approuvées dans le contexte
```

## Audit complet

Chaque proposition génère des événements :
- `specialist_proposal_requires_approval` : détection
- `recordSpecialistProposals()` : résumé batch
- `recordApproval(..., source: "specialist_proposal")` : approbation
- `specialist_proposal_approved` / `specialist_proposal_rejected` : résolution
- `specialist_proposal_evaluation_error` : erreur

## Garanties de sécurité

✅ **Aucune exécution automatique** : propositions approuvées ≠ exécutées
✅ **Politique complète** : évaluation via OperationalSecurityPolicy
✅ **Audit complet** : traçage de chaque décision
✅ **Isolation** : workflows de propositions ≠ tool calls
✅ **Contexte limité** : `origin: "model_generated"` + `trustLevel: LOW`

## Fichiers modifiés

| Fichier | Changements |
|---------|------------|
| `services/security/operational-security-policy.js` | `isSpecialistProposal` flag + logique conditionnelle |
| `services/orchestration/noon-orchestrator.js` | `processProposedToolRequests()` + `resumeWorkflow()` branche |
| `test/specialist-proposals-integration.test.js` | Test d'intégration complet |
| `docs/SPECIALIST_PROPOSALS_SECURITY_FLOW.md` | Documentation détaillée |

## Exemple : Proposition de commit

**Demande utilisateur** :
```
"Analyse la codebase et corrige les problèmes trouvés."
```

**DEV propose** :
```javascript
{
  toolRequestId: "req-42",
  skillId: "git_commit",
  operation: "commit",
  purpose: "Commiter les corrections détectées",
  requestedInputs: {
    message: "Fix: Performance bottlenecks in core.js",
    files: ["src/core.js"]
  },
  authority: "UNTRUSTED_PROPOSAL"
}
```

**Flux** :
1. `processProposedToolRequests()` crée ActionRequest(isSpecialistProposal: true)
2. Policy évalue : mutating + model_generated + isSpecialistProposal
   - → Pas de DENY
   - → REQUIRE_APPROVAL (REMOTE_SIDE_EFFECT, IRREVERSIBLE)
3. Approbation présentée à l'utilisateur
4. Utilisateur approuve / rejette
5. Si approuvé : modèle voit la proposition validée dans le contexte

## Notes pour la production

⚠️ **Observabilité optionnelle** :
- `observability?.recordSpecialistProposals()` peut être absent
- Appels vérifiés avec `?.` (optional chaining)

⚠️ **Dépendances requises** :
- `operationalSecurityPolicy` doit être fourni
- `approvalManager` doit être fourni
- Sinon : propositions ignorées silencieusement (safe fallback)

✅ **Rétrocompatibilité** :
- Les orchestrateurs existants sans `operationalSecurityPolicy` continuent de fonctionner
- Les propositions retournées ne sont plus retournées à l'utilisateur (champ masqué)

## Voir aussi

- [SPECIALIST_PROPOSALS_SECURITY_FLOW.md](SPECIALIST_PROPOSALS_SECURITY_FLOW.md)
- [specialist-proposals-security-integration.md](/memories/repo/specialist-proposals-security-integration.md)
- Test : [specialist-proposals-integration.test.js](../test/specialist-proposals-integration.test.js)
