# Flux de Sécurité des Propositions de Spécialistes

## Vue d'ensemble

Lorsqu'un spécialiste (DA, DEV, etc.) suggère une action via `proposedToolRequests` (ex: "je recommande d'envoyer cet email"), cette proposition **n'est plus silencieusement jetée**. Elle est désormais :

1. **Routée** via `OperationalSecurityPolicy` pour évaluation
2. **Transformée** en demande d'approbation si sensible
3. **Présentée** à l'utilisateur pour validation explicite
4. **Tracée** complètement pour audit

## Architecture détaillée

### Phase 1 : Émission (DelegationEngine)

Les spécialistes produisent des `proposedToolRequests` avec la structure suivante :

```javascript
{
  toolRequestId: "tool-req-xyz",
  skillId: "send_email",           // Outil suggéré
  operation: "send",               // Opération
  purpose: "Envoyer le brouillon au client",
  requestedInputs: {
    to: "client@example.com",
    subject: "Proposition de rapport",
    body: "..."
  },
  authority: "UNTRUSTED_PROPOSAL"  // Toujours non fiable
}
```

**Point clé** : `authority: "UNTRUSTED_PROPOSAL"` indique que c'est une hypothèse non ordonnée explicitement.

### Phase 2 : Évaluation (NoonOrchestrator → OperationalSecurityPolicy)

`processProposedToolRequests()` transforme chaque proposition :

```javascript
// Créer un ActionRequest pour la politique
const actionRequest = operationalSecurityPolicy.createActionRequest({
  skillId: "send_email",
  operation: "send",
  args: { to: "client@example.com", ... },
  origin: "model_generated",    // ← Origine basse fiabilité
  channel: state.request.channel,
  actor: "specialist",
  hypothetical: true,           // ← Pas une ordre explicite
  explicitOrder: false,         // ← Pas confirmée par l'utilisateur
  // ...
});

// Évaluer selon la politique
const decision = operationalSecurityPolicy.evaluate({
  actionRequest,
  skillPolicy: { /* config */ }
});
```

**Classification automatique** :

- `send_email` + `hypothetical: true` + `explicitOrder: false`
  → `ACTION_CLASSES.EXECUTE` + `TRUST_LEVELS.LOW`
  → `outcome: "REQUIRE_APPROVAL"` ✓

### Phase 3 : Approbation (ApprovalManager)

Si `outcome === "REQUIRE_APPROVAL"` :

```javascript
const approval = approvalManager.prepareAction({
  executionId: "exec-123",
  toolCallId: "proposal-tool-req-xyz",
  skillName: "send_email",
  operation: "send",
  normalizedArgs: { to: "client@example.com", ... },
  target: "Envoyer le brouillon au client",
  permissionLevel: "proposal",
  // ...
});
```

**Résultat** : Une demande d'approbation est créée et retournée à l'interface utilisateur.

### Phase 4 : Interruption et Présentation

L'orchestrateur **interrompt l'exécution normale** et retourne :

```javascript
{
  status: "approval_required",
  executionId: "exec-123",
  approval: {
    id: "approval-xyz",
    prompt: "Envoyer le brouillon au client",
    riskLevel: "MEDIUM",
    // ...
  },
  type: "specialist_proposal",
  text: "1 proposition de spécialiste nécessite votre confirmation.",
  metadata: { ... }
}
```

**Affichage utilisateur** : "DA suggère d'envoyer le brouillon au client. Approuver ?"

### Phase 5 : Résolution (ResumWorkflow)

L'utilisateur choisit : **approuver** ou **rejeter**.

#### Cas : Rejet

```javascript
// Dans resumeWorkflow(), branche specialist_proposal
if (normalizedDecision !== "approve") {
  await approvalManager.resumeApprovedAction({
    decision: "reject"
  });
  // → continue normalement sans la proposition
}
```

**Résultat** : La proposition est ignorée, l'exécution continue.

#### Cas : Approbation

```javascript
// Dans resumeWorkflow(), branche specialist_proposal
await approvalManager.resumeApprovedAction({
  decision: "approve",
  // ...
});

// Marquer comme approuvée dans l'état
state.proposalResults[index].approved = true;
state.proposalResults[index].approvalId = approvalId;

// Ajouter au contexte du modèle pour la suite
state.context.runtime.approvedSpecialistProposals = [
  {
    toolRequestId: "tool-req-xyz",
    skillId: "send_email",
    operation: "send",
    purpose: "Envoyer le brouillon au client",
    approvalId: "approval-xyz",
    approvedAt: "2026-08-30T15:45:30Z"
  }
];
```

**Résultat** :
- La proposition est validée
- Le modèle peut voir qu'elle est approuvée dans le contexte
- L'exécution normale continue

## Diagramme de flux

```
┌─────────────────────────────────────────────────────────────────┐
│ Spécialiste suggère : send_email("Envoyer brouillon")          │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ↓ proposal: { toolRequestId, skillId, ... }
┌─────────────────────────────────────────────────────────────────┐
│ processProposedToolRequests()                                   │
│  ├─ Crée ActionRequest(origin: model_generated, hypothetical)  │
│  └─ Appelle OperationalSecurityPolicy.evaluate()              │
└────────────────┬────────────────────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
         ↓               ↓
    ALLOW         REQUIRE_APPROVAL
         │               │
         │               ↓
         │        approvalManager.prepareAction()
         │               │
         │               ↓
         │        Retour à l'utilisateur:
         │        "Approuver cette proposition ?"
         │               │
         │        ┌──────┴──────┐
         │        │             │
         │        ↓             ↓
         │      APPROVE      REJECT
         │        │             │
         │    ┌───┘             └───┐
         │    ↓                     ↓
         │ Marquer approuvée   Ignorer
         │ Ajouter au contexte Continuer
         └────┬──────────────────────┘
              ↓
         continueExecution()
         (Modèle voit les propositions approuvées)
```

## Classement de sensibilité

La politique évalue chaque proposition selon :

| Critère | Valeur pour propositions | Impact |
|---------|--------------------------|--------|
| `origin` | `model_generated` | Trust: LOW |
| `trustLevel` | LOW | Augmente le risque |
| `explicitOrder` | false | Exige une approbation |
| `hypothetical` | true | Pas contraignant |
| `actionClass` | EXECUTE (pour send_*) | Risk ↑ |

**Résultat** : `outcome: REQUIRE_APPROVAL` pour 99% des propositions mutantes.

## Événements d'audit

Chaque étape est tracée :

1. **`specialist_proposal_requires_approval`** : Proposition détectée comme sensible
2. **`specialist_proposal_approved`** : Utilisateur a validé
3. **`specialist_proposal_rejected`** : Utilisateur a refusé
4. **`specialist_proposal_evaluation_error`** : Erreur lors de l'évaluation

Plus les événements `recordApproval()` standard avec `source: "specialist_proposal"`.

## Exemple concret

### Requête utilisateur
```
"Analyse la codebase et génère un rapport PDF complet avec corrections."
```

### Spécialistes activés
1. **DEV** : Analyse le code
2. **DOCUMENT** : Génère le rapport

### DEV propose :
```javascript
proposedToolRequests: [
  {
    toolRequestId: "req-1",
    skillId: "git_commit",
    operation: "commit",
    purpose: "Commiter les corrections détectées",
    requestedInputs: {
      message: "Fix: Refactor performance bottlenecks",
      files: ["src/core.js", "src/utils.js"]
    }
  }
]
```

### Flux d'approbation
1. `processProposedToolRequests()` crée un `ActionRequest`
   - `origin: "model_generated"` (DEV)
   - `action: EXECUTE` (git_commit)
   - `hypothetical: true` (suggestion, pas ordre)
   - `explicitOrder: false` (pas confirmé)

2. `OperationalSecurityPolicy.evaluate()`
   - **Règle hard** : Mutation git dans un workspace
   - **Risk** : HIGH (IRREVERSIBLE, REMOTE_SIDE_EFFECT)
   - **Outcome** : REQUIRE_APPROVAL ✓

3. Demande d'approbation présentée à l'utilisateur
   - "DEV suggère de commiter : 'Fix: Refactor performance bottlenecks' (2 fichiers)"
   - Risque : HIGH
   - Approuver ? Rejeter ?

4. Utilisateur approuve
   - Ajoutée à `state.approvedSpecialistProposals`
   - Modèle voit : "DEV a proposé et l'utilisateur a approuvé : commit sur src/core.js, src/utils.js"

5. Modèle continue avec ce contexte
   - Peut choisir d'exécuter via un outil dédié
   - Ou l'ignorer si contexte change

## Sécurité

### Garanties

✅ **Aucune exécution automatique** des propositions non approuvées
✅ **Politique complète** appliquée même aux suggestions
✅ **Audit complet** : chaque proposition + décision tracée
✅ **Contexte limité** : propositions = données, pas ordres
✅ **Isolation** : propositions ≠ tool calls normaux

### Limitations intentionnelles

⚠️ Les propositions approuvées **ne sont pas exécutées automatiquement**
→ Le modèle voit qu'elles sont approuvées mais doit décider d'agir
→ Cela préserve l'agentivité du modèle tout en respectant les limites

⚠️ Une approbation **expire après 5 minutes**
→ Si le contexte change, nouvelle approbation requise

⚠️ Les profils protégés (alexandra, sinan, kaan) **exigent toujours approbation**
→ Même propositions hypothétiques

## Voir aussi

- [`OperationalSecurityPolicy`](OPERATIONAL_SECURITY_POLICY.md)
- [`DelegationEngine`](DELEGATION_ENGINE.md)
- [`NoonOrchestrator`](NOON_ORCHESTRATOR.md)
- [`ApprovalManager`](docs/approval-manager-design.md) (en dev)
