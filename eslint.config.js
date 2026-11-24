"use strict";

// V3-L0 (A.3) : vrai lint, en complément de `node --check` (syntaxe seule).
// Règles retenues : socle `recommended` d'ESLint + no-undef, no-unused-vars, eqeqeq.
// A.4 : no-floating-promises (typescript-eslint, informations de types) sur les fichiers
// `// @ts-check` listés dans tsconfig.check.json, vérifiés aussi par `npm run typecheck`.
const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");
// Fichiers JavaScript seulement : les déclarations .d.ts de la liste ne sont pas lintées.
const typedBoundaryFiles = require("./tsconfig.check.json").files.filter((file) => file.endsWith(".js"));

// Paramètres non utilisés tolérés : les options déstructurées font partie des signatures
// publiques des services (l'appelant peut les passer). Variables et imports : stricts.
const unused = ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }];

module.exports = [
  {
    ignores: [
      "node_modules/**", "out/**", "benchmark-workspaces/**", "dev-task-journal/**", "resources/**",
      "Workspace/**", ".noon-evals/**",
      // Morceaux de l'interface : lintés une fois recollés (scripts/lint-app-bundle.js), car ils
      // partagent une seule portée.
      "public/app/**", "test/fixtures/**", "backups/**", "logs/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-undef": "error",
      "no-unused-vars": unused,
      eqeqeq: ["error", "always", { null: "ignore" }],
      // Convention du projet : `catch {}` volontaire pour les opérations facultatives.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Les nettoyeurs d'entrées ciblent exprès les caractères de contrôle.
      "no-control-regex": "off",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
  },
  {
    files: typedBoundaryFiles,
    languageOptions: {
      parser: tseslint.parser,
      // globalReturn : portée de module CommonJS, comme avec le parseur par défaut.
      parserOptions: { project: "./tsconfig.check.json", tsconfigRootDir: __dirname, ecmaFeatures: { globalReturn: true } },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
];
