# Provider Privacy Policy

## Portée

ProviderPrivacyPolicy est le propriétaire canonique de la décision d'envoi de
données vers un fournisseur de modèle. Elle complète, sans les remplacer, la
politique d'actions, les permissions d'outils et la politique offline.

Le flux texte est :

1. construction du contexte minimal ;
2. classification locale des fragments ;
3. décision de confidentialité et liste des fournisseurs éligibles ;
4. routage déterministe du modèle ;
5. vérification du jeton opaque par l'adaptateur ;
6. appel fournisseur.

OpenAI reste le seul fournisseur actif. Anthropic, Google AI et local restent
NOT_CONFIGURED ; aucune implémentation fournisseur supplémentaire n'est créée.

## Classes et décisions

Classes : PUBLIC, PERSONAL, PRIVATE, HIGHLY_SENSITIVE et LOCAL_ONLY.

Décisions : ALLOW, DENY, REDACT_REQUIRED et LOCAL_ONLY.

OpenAI accepte explicitement PUBLIC, PERSONAL et PRIVATE afin de préserver les
usages V1 autorisés. HIGHLY_SENSITIVE, LOCAL_ONLY, les secrets détectés, les
classifications inconnues, les restrictions incompatibles et les fournisseurs
inconnus ou non configurés ferment le flux.

REDACT_REQUIRED ne délivre aucun jeton. Une éventuelle redaction doit être
locale, déterministe, puis faire l'objet d'une nouvelle évaluation.

## Défense en profondeur

Une décision ALLOW crée un objet opaque lié à l'instance de politique et au
fournisseur. L'adaptateur OpenAI refuse avant même de résoudre le client réseau
si ce jeton manque ou ne correspond pas au fournisseur. Le code stable est
REMOTE_PROVIDER_POLICY_REQUIRED.

Les événements d'observabilité contiennent seulement le fournisseur, la
décision, les codes de raison, les sources et les comptes par classe. Aucun
contenu de fragment, secret ou donnée privée n'y est recopié.

## Invariants

- DEFAULT_DENY : provider inconnu/non configuré, classification inconnue ou
  métadonnées absentes sont refusés.
- LOCAL_ONLY_ABSOLUTE : aucune autorisation de provider distant n'est délivrée.
- NO_SECRET_EGRESS : les marqueurs explicites de clés, tokens, mots de passe,
  secrets client, clés privées et payloads SafeStorage sont bloqués localement.
- MINIMUM_NECESSARY_CONTEXT : ContextBuilder conserve sa sélection pertinente
  et son budget ; la policy ne récupère jamais une source ou un stockage entier.

## Limites V2.2

La politique couvre le pipeline texte canonique, la recherche Web publique, la
création d'analyses en arrière-plan, l'analyse multimodale distante et les
requêtes de génération d'image. Les flux audio et leur identité vocale restent
inchangés. Les adaptateurs historiques spécialisés devront converger vers le
contrat ModelProviderAdapter lors d'une étape ultérieure ; ils passent déjà par
la décision canonique avant d'ouvrir leur client distant.
