#!/usr/bin/env node
"use strict";
// V3-L7 — outil de maintenance (hors app packagée). Refuse le déplacement si le bloc écrit une
// variable du serveur, dépend d'une variable locale du gestionnaire autre que req/res/requestPath,
// ou déclare quelque chose utilisé après lui. Vérifier ensuite le comportement avant/après.
// Déplace un bloc contigu de routes du gestionnaire HTTP de server.js vers un module, tel quel.
// usage : node scripts/extract-server-routes.js <config.json> [--write]   (sans --write : essai à blanc)
// config: { start: "texte exact de la 1re ligne", end: "texte exact de la ligne qui suit le bloc",
//           module: "services/x/y-http-routes.js", factory: "createYHttpRoutes", instance: "yHttpRoutes",
//           header: "commentaire", allowedLocals: ["req","res","requestPath"] }
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const espree = require(path.join(ROOT, "node_modules/espree"));
const eslintScope = require(path.join(ROOT, "node_modules/eslint-scope"));

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const write = process.argv.includes("--write");
const serverFile = path.join(ROOT, "server.js");
const source = fs.readFileSync(serverFile, "utf8");

function lineOffset(text) {
  const index = source.indexOf(`\n${text}`);
  if (index < 0 || source.indexOf(`\n${text}`, index + 1) >= 0) throw new Error(`marqueur absent ou ambigu : ${text}`);
  return index + 1;
}
const start = lineOffset(config.start);
const end = lineOffset(config.end);
if (end <= start) throw new Error("fin avant début");
const block = source.slice(start, end);

const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script", range: true, loc: true, ecmaFeatures: { globalReturn: true } });
const manager = eslintScope.analyze(ast, { ecmaVersion: 2022, nodejsScope: true, sourceType: "script" });
const moduleScope = manager.globalScope.childScopes[0];
const inBlock = (range) => range[0] >= start && range[1] <= end;

const deps = new Map(); const problems = []; const locals = new Set();
for (const scope of manager.scopes) {
  for (const reference of scope.references) {
    if (!inBlock(reference.identifier.range)) continue;
    const variable = reference.resolved;
    if (!variable) continue; // global (JSON, URL, process…)
    const defined = variable.defs.some((def) => inBlock(def.name.range));
    if (defined) continue;
    const name = variable.name;
    if (variable.scope === moduleScope) {
      if (reference.isWrite()) problems.push(`écriture de la variable serveur ${name}`);
      const kind = variable.defs[0]?.parent?.kind || variable.defs[0]?.type;
      deps.set(name, kind);
    } else if ((config.allowedLocals || ["req", "res", "requestPath"]).includes(name)) {
      locals.add(name);
      if (reference.isWrite()) problems.push(`écriture de ${name}`);
    } else problems.push(`variable locale du gestionnaire : ${name}`);
  }
}
// Une déclaration du bloc utilisée après le bloc deviendrait introuvable une fois déplacée.
for (const scope of manager.scopes) {
  for (const variable of scope.variables) {
    if (!variable.defs.some((def) => inBlock(def.name.range))) continue;
    for (const reference of variable.references) if (!inBlock(reference.identifier.range)) problems.push(`déclaration du bloc utilisée ailleurs : ${variable.name}`);
  }
}
if (/\barguments\b|\bthis\b/.test(block)) problems.push("arguments/this dans le bloc");
if (problems.length) { console.error([...new Set(problems)].join("\n")); process.exit(2); }

const names = [...deps.keys()].sort();
let routeResultPath = path.relative(path.dirname(path.join(ROOT, config.module)), path.join(ROOT, "services/http/route-result")).split(path.sep).join("/");
if (!routeResultPath.startsWith(".")) routeResultPath = `./${routeResultPath}`;
// Indentation de 4 espaces, sauf les lignes qui commencent à l'intérieur d'un gabarit
// multiligne (leur contenu doit rester octet pour octet).
const templates = [];
(function walk(node) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "TemplateLiteral" && node.range[0] < end && node.range[1] > start) templates.push(node.range);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value.type === "string") walk(value);
  }
})(ast);
function indent(text) {
  let offset = start;
  return text.split("\n").map((line) => {
    const lineStart = offset; offset += line.length + 1;
    const insideTemplate = templates.some(([from, to]) => lineStart > from && lineStart < to);
    return line && !insideTemplate ? `    ${line}` : line;
  }).join("\n");
}
const moduleText = `"use strict";

${config.header.split("\n").map((line) => `// ${line}`.trimEnd()).join("\n")}
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("${routeResultPath}");

const DEPENDENCIES = Object.freeze(${JSON.stringify(names)});

function ${config.factory}(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(\`Dépendance manquante : \${name}\`);
  return async function handle(req, res, requestPath) {
    const {
${names.map((name) => `      ${name},`).join("\n")}
    } = deps;

${indent(block.replace(/\s+$/, ""))}

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, ${config.factory} };
`;

const dispatch = `{
  const routed = await ${config.instance}(req, res, requestPath);
  if (routed !== NOT_HANDLED) return routed;
}

`;
const construction = `const ${config.instance} = ${config.factory}({
${names.map((name) => `  get ${name}() { return ${name}; },`).join("\n")}
});
`;
let server = source.slice(0, start) + dispatch + source.slice(end);
const anchor = "const server = http.createServer(async (req, res) => {";
if (server.split(anchor).length !== 2) throw new Error("ancre createServer");
server = server.replace(anchor, `${construction}${anchor}`);
const requireLine = `const { ${config.factory} } = require("./${config.module.replace(/\.js$/, "")}");\n`;
const requireAnchor = 'const { createStaticAssets } = require("./services/http/static-assets");\n';
if (!server.includes(requireAnchor)) throw new Error("ancre require");
server = server.replace(requireAnchor, requireAnchor + requireLine);
if (!server.includes('require("./services/http/route-result")')) server = server.replace(requireAnchor, `${requireAnchor}const { NOT_HANDLED } = require("./services/http/route-result");\n`);

console.log(`bloc : ${block.split("\n").length - 1} lignes · dépendances (${names.length}) : ${names.join(", ")} · locales : ${[...locals].join(", ")}`);
if (write) {
  fs.mkdirSync(path.dirname(path.join(ROOT, config.module)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, config.module), moduleText);
  fs.writeFileSync(serverFile, server);
  console.log("écrit");
}
