# Artifact Engine de Noon

## Rôle

`services/artifacts/artifact-engine.js` est la façade unique entre une demande structurée et les renderers historiques de Noon. Le moteur ne remplace pas `services/production/artifact-generator.js` : il lui ajoute un plan canonique, une prévisualisation temporaire, la provenance, le versionnement, les validations et une promotion atomique vers un dossier autorisé.

Le flux normal est :

`request → prepare → preview → validation utilisateur → write`

Une prévisualisation n’est jamais considérée comme un fichier utilisateur définitif.

## Artifact Request

Le request distingue l’intention (`artifactType`) du format (`outputFormat`). Il accepte notamment le titre, le but, le contenu logique, les sources, le template, le style, la destination, la politique d’écrasement, le niveau de provenance et le mode de confidentialité.

Types stables : `document`, `pdf`, `spreadsheet`, `presentation`, `markdown`, `html`, `image`, `rtf`.

Formats délégués au renderer existant : `docx`, `pdf`, `png`, `xlsx`, `pptx`, `md`, `html`, `rtf`, `txt`, `json`, `csv`.

## Artifact Plan et contenu

Le plan intermédiaire porte l’identité, la version, les blocs, les citations, le template, le style, les fingerprints et la destination. Les blocs supportés sont :

- `heading`, `paragraph`, `list`, `table` ;
- `image`, `chart`, `quote`, `callout` ;
- `pageBreak`, `sectionBreak`.

Le contenu logique reste indépendant du renderer. Une révision peut modifier un bloc par son identifiant sans muter la version précédente.

## Renderers et previews

L’adapter réutilise le générateur existant pour tous les formats. Les previews sont produites sous `artifact-previews/<artifactId>/v<version>` dans le répertoire privé de Noon. Un même fichier temporaire validé est ensuite copié vers un nom temporaire adjacent à la destination et promu par renommage atomique.

Les previews retournent taille, pages PDF, slides PPTX, feuilles XLSX et warnings. Les contrôles actuels signalent les tableaux trop larges, slides trop denses et images manquantes. Le rendu visuel approfondi reste la responsabilité des renderers spécialisés ; l’Engine conserve leurs warnings sans prétendre qu’un layout non rendu a été inspecté.

## Provenance et confidentialité

Niveaux : `none`, `minimal`, `standard`, `detailed`. Sans source, aucune citation n’est créée. Les sources issues du Multi-Source Synthesis Engine sont conservées par identifiants et fingerprint, jamais par duplication de toutes les preuves.

Le mode `internal` peut conserver un locator local. Le mode `shareable` produit des labels publics et retire chemins absolus, IDs de profils et IDs internes des citations exportées.

## Fichiers, versionnement et approbations

- la destination doit exister dans une racine `read-write` ;
- `realpath` et le contrôle de racines bloquent traversal et symlink escape ;
- `CREATE_NEW` est le défaut et crée une nouvelle version déterministe ;
- `OVERWRITE` exige une approbation exacte et consommable liée à l’artefact, la version, le format, le chemin et le fingerprint ;
- changer contenu ou destination après preview invalide l’écriture ;
- `writeOperationId` rend un double envoi idempotent ;
- une ancienne version n’est jamais modifiée lors d’une révision.

L’historique central est stocké dans les tables SQLite `artifacts` et `artifact_writes`, avec fallback JSON existant si `node:sqlite` est indisponible. Le registre conserve le plan nécessaire aux révisions, les IDs de sources et les métadonnées de version ; il ne recopie pas les preuves brutes.

## Skill Registry

`create_artifact` peut créer directement ou retourner uniquement une preview avec `previewOnly`. `write_artifact` promeut ensuite exactement la version prévisualisée dans la même destination autorisée. Les deux exigent un ordre utilisateur explicite et passent par le Skill Registry.

## Erreurs structurées

Codes principaux :

- `ARTIFACT_UNSUPPORTED_TYPE`, `ARTIFACT_UNSUPPORTED_FORMAT` ;
- `ARTIFACT_RENDER_FAILED`, `ARTIFACT_VALIDATION_FAILED` ;
- `ARTIFACT_DESTINATION_REQUIRED`, `ARTIFACT_DESTINATION_NOT_ALLOWED` ;
- `ARTIFACT_CONFLICT`, `ARTIFACT_STALE` ;
- `ARTIFACT_OVERWRITE_REQUIRES_APPROVAL` ;
- `ARTIFACT_NOT_FOUND`, `ARTIFACT_REPOSITORY_REQUIRED`.

## Observabilité

Les événements couvrent préparation, preview, écriture, validation et échec. Les métadonnées contiennent uniquement des IDs, formats, compteurs, tailles et durées. Le corps, les cellules, les slides, les sources privées et les chemins ne sont jamais envoyés aux logs.

## Limites assumées

Les renderers historiques produisent actuellement des livrables valides mais simples. Ils ne proposent pas encore un moteur complet de templates bureautiques, de notes PowerPoint, de footnotes DOCX natives, de commentaires XLSX ou de rendu visuel multi-page automatisé. Ces améliorations doivent rester derrière les adapters, sans contourner l’Artifact Engine.
