"use strict";

// V3-L0 (A.3) : vrai lint, en complément de `node --check` (syntaxe seule).
// Règles retenues : socle `recommended` d'ESLint + no-undef, no-unused-vars, eqeqeq.
// no-floating-promises exige typescript-eslint avec informations de types : reporté à A.4
// (// @ts-check + JSDoc), voir docs/CURRENT_STATE.md.
const js = require("@eslint/js");
const globals = require("globals");

// Paramètres non utilisés tolérés : les options déstructurées font partie des signatures
// publiques des services (l'appelant peut les passer). Variables et imports : stricts.
const unused = ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }];

module.exports = [
  {
    ignores: [
      "node_modules/**", "out/**", "benchmark-workspaces/**", "dev-task-journal/**", "resources/**",
      "Workspace/**", ".noon-evals/**", "test/fixtures/**", "backups/**", "logs/**",
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
];
