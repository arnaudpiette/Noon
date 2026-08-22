require("dotenv").config();
const OpenAI = require("openai");
const { toFile } = require("openai");

// Initialise le client OpenAI avec la clé stockée dans le fichier .env.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  ALLOWED_DIRECTORIES,
  PRIORITY_DIRECTORIES,
  EXCLUDED_NAMES,
} = require("./config");

const PORT = 3000;
const USAGE_FILE = path.join(__dirname, "usage.json");
const MONTHLY_BUDGET_USD = 28;

// GPT-5.6 Luna — coût par million de tokens.
const LUNA_INPUT_PRICE = 0.20;
const LUNA_OUTPUT_PRICE = 1.20;

// Charge les compteurs du mois ou initialise un suivi vide.
function loadUsage() {
  if (!fs.existsSync(USAGE_FILE)) {
    return {
      month: new Date().toISOString().slice(0, 7),
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    };
  }

  return JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
}

// Enregistre les compteurs de consommation dans un fichier local.
function saveUsage(usage) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}

// Convertit les tokens consommés en coût estimé en dollars.
function calculateCostUSD(usage) {
  const inputCost =
    (usage.inputTokens / 1_000_000) * LUNA_INPUT_PRICE;

  const outputCost =
    (usage.outputTokens / 1_000_000) * LUNA_OUTPUT_PRICE;

  return inputCost + outputCost;
}

// Détermine le budget restant et le mode de protection à appliquer.
function getBudgetStatus() {
  const usage = loadUsage();
  const costUSD = calculateCostUSD(usage);
  const remainingUSD = Math.max(
    0,
    MONTHLY_BUDGET_USD - costUSD
  );

  let mode = "NORMAL";

  if (costUSD >= 28) {
    mode = "BLOCKED";
  } else if (costUSD >= 24) {
    mode = "PROTECTION";
  } else if (costUSD >= 17) {
    mode = "ECO";
  }

  return {
    ...usage,
    costUSD,
    remainingUSD,
    monthlyBudgetUSD: MONTHLY_BUDGET_USD,
    mode,
  };
}

// Adapte le comportement de Noon au niveau de budget mensuel restant.
function getRuntimeLimits(mode) {
  switch (mode) {
    case "ECO":
      return {
        maxTurns: 2,
        maxSearchResults: 10,
        maxFileChars: 4000,
        instruction:
          "Mode économie actif. Réponds brièvement et limite fortement les appels d'outils.",
      };

    case "PROTECTION":
      return {
        maxTurns: 1,
        maxSearchResults: 5,
        maxFileChars: 2500,
        instruction:
          "Mode protection budgétaire actif. Utilise l'API au strict minimum et réponds très brièvement.",
      };

    default:
      return {
        maxTurns: 3,
        maxSearchResults: 15,
        maxFileChars: 6000,
        instruction:
          "Mode normal. Reste néanmoins économe en tokens et en appels d'outils.",
      };
  }
}

// Ajoute à la consommation mensuelle les tokens du dernier appel OpenAI.
function trackUsage(response) {
  if (!response.usage) return;

  let usage = loadUsage();
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Réinitialise automatiquement les compteurs lors d'un changement de mois.
  if (usage.month !== currentMonth) {
    usage = {
      month: currentMonth,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    };
  }

  usage.inputTokens += response.usage.input_tokens || 0;
  usage.outputTokens += response.usage.output_tokens || 0;
  usage.requests += 1;

  saveUsage(usage);
}

// Indique si un fichier ou dossier doit être ignoré.
function isExcluded(name) {
  return EXCLUDED_NAMES.includes(name);
}

// Retourne le contenu visible d'un dossier sans lire les éléments exclus.
function listDirectory(dirPath) {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => !isExcluded(entry.name))
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      path: path.join(dirPath, entry.name),
    }));
}

// Vérifie que le chemin demandé reste dans un espace de travail autorisé.
function isPathAllowed(targetPath) {
  const resolvedTarget = path.resolve(targetPath);

  return ALLOWED_DIRECTORIES.some((allowedDir) => {
    const resolvedAllowed = path.resolve(allowedDir);

    return (
      resolvedTarget === resolvedAllowed ||
      resolvedTarget.startsWith(resolvedAllowed + path.sep)
    );
  });
}

function normalizeFocusPath(focusPath) {
  if (!focusPath) {
    return null;
  }

  const resolvedPath = path.resolve(focusPath);

  if (
    !isPathAllowed(resolvedPath) ||
    !fs.existsSync(resolvedPath)
  ) {
    return null;
  }

  return resolvedPath;
}

function normalizeFocusName(focusName) {
  if (typeof focusName !== "string") {
    return null;
  }

  const normalizedName = focusName
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, 120);

  return normalizedName || null;
}

const ALLOWED_NOON_MODES = new Set(["DA", "DEV"]);

function normalizeNoonMode(mode) {
  const normalizedMode =
    typeof mode === "string"
      ? mode.trim().toUpperCase()
      : "";

  return ALLOWED_NOON_MODES.has(normalizedMode)
    ? normalizedMode
    : "DA";
}

function listLocalProjects() {
  const projectsByPath = new Map();

  const MAX_DEPTH = 6;
  const MAX_PROJECTS = 100;

  function isProjectDirectory(directoryPath) {
    let names;

    try {
      names = new Set(fs.readdirSync(directoryPath));
    } catch {
      return false;
    }

    const hasPackage = names.has("package.json");

    const hasViteConfig = [
      "vite.config.js",
      "vite.config.mjs",
      "vite.config.ts",
    ].some((fileName) => names.has(fileName));

    const hasFrontendAndBackend =
      names.has("frontend") && names.has("backend");

    const hasStaticWebsite =
      names.has("index.html") &&
      (
        names.has("css") ||
        names.has("styles") ||
        names.has("assets")
      );

    return (
      hasPackage ||
      hasViteConfig ||
      hasFrontendAndBackend ||
      hasStaticWebsite
    );
  }

  function addProject(projectPath, priority) {
    const resolvedPath = path.resolve(projectPath);

    if (
      projectsByPath.size >= MAX_PROJECTS ||
      !isPathAllowed(resolvedPath)
    ) {
      return;
    }

    projectsByPath.set(resolvedPath, {
      name: path.basename(resolvedPath),
      path: resolvedPath,
      priority,
    });
  }

  function scanDirectory(directoryPath, depth, priority) {
    if (
      depth > MAX_DEPTH ||
      projectsByPath.size >= MAX_PROJECTS
    ) {
      return;
    }

    const resolvedPath = path.resolve(directoryPath);

    if (!isPathAllowed(resolvedPath)) {
      return;
    }

    /*
     * Lorsqu’un vrai projet est détecté, on l’ajoute,
     * puis on arrête de descendre dans src, components,
     * backend, node_modules, etc.
     */
    if (isProjectDirectory(resolvedPath)) {
      addProject(resolvedPath, priority);
      return;
    }

    let entries;

    try {
      entries = fs.readdirSync(resolvedPath, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        isExcluded(entry.name)
      ) {
        continue;
      }

      scanDirectory(
        path.join(resolvedPath, entry.name),
        depth + 1,
        priority
      );
    }
  }

  // Recherche prioritaire dans OpenClassrooms et Website.
  for (const priorityDirectory of PRIORITY_DIRECTORIES) {
    scanDirectory(priorityDirectory, 0, true);
  }

  // Recherche dans les autres espaces autorisés.
  for (const allowedDirectory of ALLOWED_DIRECTORIES) {
    scanDirectory(allowedDirectory, 0, false);
  }

  return [...projectsByPath.values()].sort(
    (projectA, projectB) => {
      if (projectA.priority !== projectB.priority) {
        return projectA.priority ? -1 : 1;
      }

      return projectA.name.localeCompare(
        projectB.name,
        "fr"
      );
    }
  );
}

// Recherche récursivement un nom de fichier ou de dossier.
function searchFiles(searchTerm) {
  const results = [];
  const normalizedSearch = searchTerm.toLowerCase();

  function scanDirectory(currentPath) {
    let entries;

    try {
      entries = fs.readdirSync(currentPath, {
        withFileTypes: true,
      });
    } catch {
      // Ignore les dossiers illisibles et poursuit la recherche ailleurs.
      return;
    }

    for (const entry of entries) {
      if (isExcluded(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);

      if (entry.name.toLowerCase().includes(normalizedSearch)) {
        results.push({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          path: fullPath,
        });
      }

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      }

      // Évite une réponse gigantesque
      if (results.length >= 15) {
        return;
      }
    }
  }

  for (const allowedDirectory of ALLOWED_DIRECTORIES) {
    scanDirectory(allowedDirectory);

    if (results.length >= 15) {
      break;
    }
  }

  return results;
}

// Lit un fichier uniquement après avoir appliqué toutes les règles de sécurité.
function readAllowedFile(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!isPathAllowed(resolvedPath)) {
    throw new Error("Accès refusé : fichier hors des dossiers autorisés.");
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Fichier introuvable.");
  }

  const stats = fs.statSync(resolvedPath);

  if (!stats.isFile()) {
    throw new Error("Le chemin demandé n'est pas un fichier.");
  }

  if (isExcluded(path.basename(resolvedPath))) {
    throw new Error("Accès refusé : fichier protégé.");
  }

  // Bloque explicitement les fichiers susceptibles de contenir des secrets.
  const forbiddenFiles = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".npmrc",
  ];

  if (forbiddenFiles.includes(path.basename(resolvedPath))) {
    throw new Error("Accès refusé : fichier sensible.");
  }

  // Limite la lecture à 1 Mo pour éviter une réponse trop volumineuse.
  if (stats.size > 1024 * 1024) {
    throw new Error("Fichier trop volumineux.");
  }

  // Seuls les formats texte utiles à l'analyse de projets sont acceptés.
  const allowedExtensions = [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".html",
    ".css",
    ".scss",
    ".md",
    ".txt",
  ];

  const extension = path.extname(resolvedPath).toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    throw new Error("Type de fichier non autorisé.");
  }

  // Tronque les très longs contenus avant de les transmettre au modèle.
  const content = fs.readFileSync(resolvedPath, "utf8");
  const MAX_CHARS = 6000;

  return {
    path: resolvedPath,
    extension,
    size: stats.size,
    truncated: content.length > MAX_CHARS,
    content:
      content.length > MAX_CHARS
        ? content.slice(0, MAX_CHARS) +
          "\n\n[CONTENU TRONQUÉ PAR NOON]"
        : content,
  };
}

// Gère les commandes locales simples sans interroger le modèle d'IA.
function handleLocalCommand(question) {
  const q = question.toLowerCase().trim();

  if (q.includes("espace") || q.includes("workspace")) {
    return {
      action: "list_workspaces",
      answer: "Voici les espaces de travail autorisés.",
      data: ALLOWED_DIRECTORIES,
    };
  }

  if (q.startsWith("cherche ") || q.startsWith("recherche ")) {
    const term = question
      .replace(/^cherche\s+/i, "")
      .replace(/^recherche\s+/i, "")
      .trim();

    return {
      action: "search",
      answer: `Recherche de « ${term} ».`,
      data: searchFiles(term),
    };
  }

  return {
    action: "unknown",
    answer: "Je n'ai pas encore appris à exécuter cette demande.",
    data: null,
  };
}

// Décrit les fonctions locales que le modèle est autorisé à demander.
const NOON_TOOLS = [
  {
    type: "function",
    name: "search_files",
    description:
      "Recherche des fichiers et dossiers dans les espaces de travail autorisés de l'utilisateur.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Nom ou partie du nom du fichier, dossier ou projet à rechercher.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "read_file",
    description:
      "Lit le contenu d'un fichier texte autorisé sur le Mac. À utiliser uniquement pour les fichiers retournés par les outils de recherche ou de navigation.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Chemin absolu du fichier à lire.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "browse_directory",
    description:
      "Liste le contenu d'un dossier autorisé sur le Mac. Utilise cet outil pour comprendre la structure d'un projet avant de choisir les fichiers à lire.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Chemin absolu du dossier à explorer.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function askAI(
  question,
  focus = null,
  focusPath = null,
  mode = "DA",
  history = [],
  sessionId = "noon-local"
) {
  setSessionActivity(
    sessionId,
    "thinking",
    "Analyse de la demande…"
  );

  // Bloque localement tout nouvel appel lorsque le plafond mensuel est atteint.
  const budget = getBudgetStatus();
  const limits = getRuntimeLimits(budget.mode);

  const focusInstruction = focus
    ? focusPath
      ? `Le projet actuellement sélectionné est "${focus}". Son chemin local autorisé est "${focusPath}". Pour toute demande concernant ce projet, utilise directement ce chemin et limite tes recherches à ce dossier. Ne lance une recherche globale que si cela est indispensable.`
      : `Le projet actuellement sélectionné est "${focus}". Considère en priorité que les demandes ambiguës concernent ce projet.`
    : "Aucun projet Focus n'est actuellement sélectionné.";

  const modeInstruction =
    mode === "DEV"
      ? `Mode DEV actif. Agis comme un assistant de développement web. Pour les questions de code, vérifie les fichiers locaux avant de répondre. Donne les noms des fichiers concernés et explique précisément les modifications proposées. N'invente jamais une structure ou du code que tu n'as pas vérifié.`
      : `Mode DA actif. Agis comme un assistant de direction artistique, graphisme et web design. Priorise le concept, la hiérarchie visuelle, l'identité, la typographie, l'ergonomie et la cohérence graphique. Reste concret et applicable.`;

  if (budget.mode === "BLOCKED") {
    throw new Error(
      "Budget mensuel Noon atteint. Les appels API sont bloqués jusqu'au mois prochain."
    );
  }

  // Conserve toute la conversation, les appels d'outils et leurs résultats.
  const input = [
    {
      role: "system",
      content:
        "Tu es Noon, assistant professionnel local. Tu réponds en français. " +
        "Lorsque l'utilisateur pose une question concernant ses projets ou fichiers locaux, " +
        "utilise les outils disponibles pour vérifier les informations. " +
        "N'invente jamais le contenu d'un fichier. " +
        "Tu fonctionnes actuellement en lecture seule. " +
        "Explore le minimum de fichiers nécessaire. Commence par package.json et les fichiers structurants. " +
        "Ne lis pas tous les fichiers d'un projet si ce n'est pas nécessaire. " +
        modeInstruction + " " +
        focusInstruction + " " +
        limits.instruction,
    },
    ...history,
    {
      role: "user",
      content: question,
    },
  ];

  // Le nombre de tours diminue automatiquement selon le mode budgétaire.
  for (let turn = 0; turn < limits.maxTurns; turn++) {
    const isFinalTurn =
      turn === limits.maxTurns - 1;

    if (isFinalTurn) {
      setSessionActivity(
        sessionId,
        "responding",
        "Rédaction de la réponse…"
      );
    }

    // Demande au modèle soit une réponse finale, soit un ou plusieurs outils.
    const response = await openai.responses.create({
      model: "gpt-5.6-luna",
      input,
      tools: NOON_TOOLS,

      /*
       * Durant la dernière étape, Noon doit obligatoirement
       * produire sa réponse avec les informations disponibles.
       */
      tool_choice: isFinalTurn ? "none" : "auto",
    });

    // Comptabilise chaque appel, y compris les tours demandant un outil.
    trackUsage(response);

    const toolCalls = response.output.filter(
      (item) => item.type === "function_call"
    );

    // Aucun outil demandé : Noon a terminé son raisonnement.
    if (toolCalls.length === 0) {
      setSessionActivity(
        sessionId,
        "done",
        "Réponse prête."
      );

      const finalAnswer = response.output_text?.trim();

      if (finalAnswer) {
        return finalAnswer;
      }

      return "Je n'ai pas réussi à produire une réponse exploitable.";
    }

    // On conserve les demandes d'outils du modèle.
    input.push(...response.output);

    for (const toolCall of toolCalls) {
      let result;

      try {
        // Convertit les arguments JSON générés par le modèle en objet JavaScript.
        const args = JSON.parse(toolCall.arguments);

        if (toolCall.name === "search_files") {
          console.log(`🔎 Noon recherche : ${args.query}`);

          setSessionActivity(
            sessionId,
            "searching",
            `Recherche : ${args.query}`
          );

          result = searchFiles(args.query);
        }

        else if (toolCall.name === "read_file") {
          console.log(`📖 Noon lit : ${args.path}`);

          setSessionActivity(
            sessionId,
            "reading",
            `Lecture : ${path.basename(args.path)}`
          );

          result = readAllowedFile(args.path);
        }

        else if (toolCall.name === "browse_directory") {
          console.log(`📂 Noon explore : ${args.path}`);

          setSessionActivity(
            sessionId,
            "browsing",
            `Exploration : ${path.basename(args.path)}`
          );

          // Empêche l'exploration des dossiers situés hors des espaces autorisés.
          if (!isPathAllowed(args.path)) {
            throw new Error("Accès refusé : dossier non autorisé.");
          }

          // Vérifie que le chemin existe avant de tenter de le parcourir.
          if (!fs.existsSync(args.path)) {
            throw new Error("Dossier introuvable.");
          }

          const stats = fs.statSync(args.path);

          // Refuse les fichiers : cet outil accepte uniquement les dossiers.
          if (!stats.isDirectory()) {
            throw new Error("Le chemin demandé n'est pas un dossier.");
          }

          result = listDirectory(args.path);
        }

        else {
          result = {
            error: `Outil inconnu : ${toolCall.name}`,
          };
        }
      } catch (error) {
        // Retourne l'erreur au modèle afin qu'il puisse adapter sa réponse.
        result = {
          error: error.message,
        };
      }

      // Associe le résultat à l'appel grâce à son identifiant unique.
      input.push({
        type: "function_call_output",
        call_id: toolCall.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  return "L'analyse s'est terminée sans réponse exploitable.";
}

const CONVERSATION_MEMORY_FILE = path.join(
  __dirname,
  "conversation-memory.json"
);

function loadConversationSessions() {
  if (!fs.existsSync(CONVERSATION_MEMORY_FILE)) {
    return new Map();
  }

  try {
    const savedSessions = JSON.parse(
      fs.readFileSync(
        CONVERSATION_MEMORY_FILE,
        "utf8"
      )
    );

    const validSessions = Object.entries(
      savedSessions
    ).filter(([, history]) => Array.isArray(history));

    return new Map(validSessions);
  } catch (error) {
    console.warn(
      "Mémoire Noon illisible :",
      error.message
    );

    return new Map();
  }
}

function saveConversationSessions() {
  const temporaryFile =
    `${CONVERSATION_MEMORY_FILE}.tmp`;

  try {
    const savedSessions = Object.fromEntries(
      conversationSessions
    );

    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(savedSessions, null, 2)
    );

    fs.renameSync(
      temporaryFile,
      CONVERSATION_MEMORY_FILE
    );
  } catch (error) {
    console.error(
      "Impossible d'enregistrer la mémoire Noon :",
      error.message
    );
  }
}

const conversationSessions =
  loadConversationSessions();

const MAX_HISTORY_EXCHANGES = 5;
const MAX_HISTORY_MESSAGES =
  MAX_HISTORY_EXCHANGES * 2;
const MAX_HISTORY_CHARS = 4000;

function normalizeSessionId(value) {
  const sessionId =
    typeof value === "string" ? value.trim() : "";

  if (!/^[a-zA-Z0-9-]{8,80}$/.test(sessionId)) {
    return "noon-local";
  }

  return sessionId;
}

function createConversationKey({
  sessionId,
  mode,
  focus,
  focusPath,
}) {
  return [
    sessionId,
    mode,
    focusPath || focus || "no-focus",
  ].join("::");
}

function getConversationHistory(conversationKey) {
  return [
    ...(conversationSessions.get(conversationKey) || []),
  ];
}

function rememberConversation(
  conversationKey,
  question,
  answer
) {
  const history = getConversationHistory(conversationKey);

  history.push(
    {
      role: "user",
      content: String(question).slice(
        0,
        MAX_HISTORY_CHARS
      ),
    },
    {
      role: "assistant",
      content: String(answer).slice(
        0,
        MAX_HISTORY_CHARS
      ),
    }
  );

  conversationSessions.set(
    conversationKey,
    history.slice(-MAX_HISTORY_MESSAGES)
  );

  saveConversationSessions();
}

function clearConversationSession(sessionId) {
  const prefix = `${sessionId}::`;

  for (const conversationKey of conversationSessions.keys()) {
    if (conversationKey.startsWith(prefix)) {
      conversationSessions.delete(conversationKey);
    }
  }

  saveConversationSessions();
}

const sessionActivities = new Map();

function setSessionActivity(sessionId, state, text) {
  sessionActivities.set(sessionId, {
    state,
    text,
    updatedAt: new Date().toISOString(),
  });
}

function getSessionActivity(sessionId) {
  return (
    sessionActivities.get(sessionId) || {
      state: "idle",
      text: "En attente.",
      updatedAt: null,
    }
  );
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

async function transcribeAudioBuffer(
  audioBuffer,
  contentType
) {
  const mediaType = (
    contentType || "audio/webm"
  ).split(";")[0];

  const extension = mediaType.includes("mp4")
    ? "m4a"
    : "webm";

  const audioFile = await toFile(
    audioBuffer,
    `noon-voice.${extension}`,
    {
      type: mediaType,
    }
  );

  const transcription =
    await openai.audio.transcriptions.create({
      file: audioFile,
      model: "gpt-4o-mini-transcribe",
      language: "fr",
    });

  return transcription.text?.trim() || "";
}

// Crée le serveur HTTP et renvoie toutes les réponses au format JSON.

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.url === "/") {
    res.writeHead(200);
    return res.end(
      JSON.stringify(
        {
          status: "ok",
          assistant: "Noon",
          message: "Le serveur local de Noon fonctionne.",
        },
        null,
        2
      )
    );
  }

  if (req.url === "/workspaces") {
    // Liste les espaces autorisés et leur contenu de premier niveau.
    try {
      const workspaces = ALLOWED_DIRECTORIES.map((dirPath) => ({
        path: dirPath,
        priority: PRIORITY_DIRECTORIES.some((priorityPath) =>
          priorityPath.startsWith(dirPath)
        ),
        contents: listDirectory(dirPath),
      }));

      res.writeHead(200);
      return res.end(
        JSON.stringify(
          {
            status: "ok",
            mode: "read-only",
            workspaces,
          },
          null,
          2
        )
      );
    } catch (error) {
      res.writeHead(500);
      return res.end(
        JSON.stringify(
          {
            status: "error",
            message: error.message,
          },
          null,
          2
        )
      );
    }
  }

// Parcourt un dossier autorisé indiqué avec le paramètre ?path=.
if (req.url.startsWith("/browse")) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestedPath = url.searchParams.get("path");

    if (!requestedPath) {
      res.writeHead(400);
      return res.end(
        JSON.stringify({
          status: "error",
          message: "Le paramètre path est obligatoire.",
        })
      );
    }

    if (!isPathAllowed(requestedPath)) {
      res.writeHead(403);
      return res.end(
        JSON.stringify({
          status: "error",
          message: "Accès refusé : dossier non autorisé.",
        })
      );
    }

    if (!fs.existsSync(requestedPath)) {
      res.writeHead(404);
      return res.end(
        JSON.stringify({
          status: "error",
          message: "Dossier introuvable.",
        })
      );
    }

    const contents = listDirectory(requestedPath);

    res.writeHead(200);
    return res.end(
      JSON.stringify(
        {
          status: "ok",
          mode: "read-only",
          path: requestedPath,
          contents,
        },
        null,
        2
      )
    );
  } catch (error) {
    res.writeHead(500);
    return res.end(
      JSON.stringify({
        status: "error",
        message: error.message,
      })
    );
  }
}

// Recherche des fichiers et dossiers avec le paramètre ?q=.
if (req.url.startsWith("/search")) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = url.searchParams.get("q");

    if (!query || query.trim().length < 2) {
      res.writeHead(400);

      return res.end(
        JSON.stringify({
          status: "error",
          message: "La recherche doit contenir au moins 2 caractères.",
        })
      );
    }

    const results = searchFiles(query.trim());

    res.writeHead(200);

    return res.end(
      JSON.stringify(
        {
          status: "ok",
          mode: "read-only",
          query,
          count: results.length,
          results,
        },
        null,
        2
      )
    );
  } catch (error) {
    res.writeHead(500);

    return res.end(
      JSON.stringify({
        status: "error",
        message: error.message,
      })
    );
  }
}

// Lit un fichier texte autorisé indiqué avec le paramètre ?path=.
if (req.url.startsWith("/read")) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const filePath = url.searchParams.get("path");

    if (!filePath) {
      res.writeHead(400);

      return res.end(
        JSON.stringify({
          status: "error",
          message: "Le paramètre path est obligatoire.",
        })
      );
    }

    const file = readAllowedFile(filePath);

    res.writeHead(200);

    return res.end(
      JSON.stringify(
        {
          status: "ok",
          mode: "read-only",
          file,
        },
        null,
        2
      )
    );
  } catch (error) {
    res.writeHead(403);

    return res.end(
      JSON.stringify({
        status: "error",
        message: error.message,
      })
    );
  }
}

// Traite une commande locale simple sans utiliser OpenAI.
if (req.url.startsWith("/ask")) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const question = url.searchParams.get("q");
    const focus = url.searchParams.get("focus");

    if (!question) {
      res.writeHead(400);

      return res.end(
        JSON.stringify({
          status: "error",
          message: "La question est obligatoire.",
        })
      );
    }

    const result = handleLocalCommand(question);

    res.writeHead(200);

    return res.end(
      JSON.stringify(
        {
          status: "ok",
          assistant: "Noon",
          question,
          ...result,
        },
        null,
        2
      )
    );
  } catch (error) {
    res.writeHead(500);

    return res.end(
      JSON.stringify({
        status: "error",
        message: error.message,
      })
    );
  }
}

// Confie la question à l'IA, qui peut appeler les outils locaux en lecture seule.
if (req.url.startsWith("/ai")) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const question = url.searchParams.get("q");
    const focus = normalizeFocusName(
      url.searchParams.get("focus")
    );
    const focusPath = normalizeFocusPath(
      url.searchParams.get("focusPath")
    );
    const mode = normalizeNoonMode(
      url.searchParams.get("mode")
    );
    const sessionId = normalizeSessionId(
      url.searchParams.get("sessionId")
    );
    const conversationKey = createConversationKey({
      sessionId,
      mode,
      focus,
      focusPath,
    });
    const history = getConversationHistory(
      conversationKey
    );

    if (!question) {
      res.writeHead(400);
      return res.end(
        JSON.stringify({
          status: "error",
          message: "La question est obligatoire.",
        })
      );
    }

    const answer = await askAI(
      question,
      focus,
      focusPath,
      mode,
      history,
      sessionId
    );

    rememberConversation(
      conversationKey,
      question,
      answer
    );

    res.writeHead(200);
    return res.end(
      JSON.stringify(
        {
          status: "ok",
          assistant: "Noon",
          question,
          answer,
        },
        null,
        2
      )
    );
  } catch (error) {
    res.writeHead(500);
    return res.end(
      JSON.stringify({
        status: "error",
        message: error.message,
      })
    );
  }
}

// Expose la consommation mensuelle et le mode budgétaire actuel.
if (req.url === "/budget") {
  const budget = getBudgetStatus();

  res.writeHead(200);

  return res.end(
    JSON.stringify(
      {
        status: "ok",
        assistant: "Noon",
        budget: {
          month: budget.month,
          requests: budget.requests,
          inputTokens: budget.inputTokens,
          outputTokens: budget.outputTokens,
          costUSD: Number(budget.costUSD.toFixed(4)),
          remainingUSD: Number(
            budget.remainingUSD.toFixed(4)
          ),
          monthlyBudgetUSD: budget.monthlyBudgetUSD,
          mode: budget.mode,
        },
      },
      null,
      2
    )
  );
}

// Sert la page principale de l'interface web locale.
if (req.method === "GET" && req.url === "/app") {
  const filePath = path.join(__dirname, "public", "index.html");

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
  });

  return res.end(fs.readFileSync(filePath));
}

// Sert la feuille de styles de l'interface.
if (req.method === "GET" && req.url === "/style.css") {
  const filePath = path.join(__dirname, "public", "style.css");

  res.writeHead(200, {
    "Content-Type": "text/css; charset=utf-8",
  });

  return res.end(fs.readFileSync(filePath));
}

// Sert le code JavaScript exécuté par l'interface.
if (req.method === "GET" && req.url === "/app.js") {
  const filePath = path.join(__dirname, "public", "app.js");

  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
  });

  return res.end(fs.readFileSync(filePath));
}

// Sert le moteur léger qui anime le cœur de particules NOON.
if (req.method === "GET" && req.url === "/noon-particles.js") {
  const filePath = path.join(__dirname, "public", "noon-particles.js");

  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
  });

  return res.end(fs.readFileSync(filePath));
}

if (req.method === "GET" && req.url === "/projects") {
  try {
    const projects = listLocalProjects();

    res.writeHead(200);

    return res.end(
      JSON.stringify(
        {
          status: "ok",
          mode: "read-only",
          count: projects.length,
          projects,
        },
        null,
        2
      )
    );
  } catch (error) {
    res.writeHead(500);

    return res.end(
      JSON.stringify({
        status: "error",
        message: error.message,
      })
    );
  }
}

if (
  req.method === "POST" &&
  req.url.startsWith("/session/clear")
) {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  const sessionId = normalizeSessionId(
    url.searchParams.get("sessionId")
  );

  clearConversationSession(sessionId);

  res.writeHead(200);

  return res.end(
    JSON.stringify({
      status: "ok",
      message: "Mémoire de conversation supprimée.",
    })
  );
}

if (
  req.method === "GET" &&
  req.url.startsWith("/session/history")
) {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    const sessionId = normalizeSessionId(
      url.searchParams.get("sessionId")
    );

    const mode = normalizeNoonMode(
      url.searchParams.get("mode")
    );

    const focus = normalizeFocusName(
      url.searchParams.get("focus")
    );

    const focusPath = normalizeFocusPath(
      url.searchParams.get("focusPath")
    );

    const conversationKey = createConversationKey({
      sessionId,
      mode,
      focus,
      focusPath,
    });

    const history = getConversationHistory(
      conversationKey
    );

    res.writeHead(200);

    return res.end(
      JSON.stringify({
        status: "ok",
        count: history.length,
        history,
      })
    );
  } catch (error) {
    res.writeHead(500);

    return res.end(
      JSON.stringify({
        status: "error",
        message: error.message,
      })
    );
  }
}

if (
  req.method === "GET" &&
  req.url.startsWith("/session/activity")
) {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  const sessionId = normalizeSessionId(
    url.searchParams.get("sessionId")
  );

  res.writeHead(200);

  return res.end(
    JSON.stringify({
      status: "ok",
      activity: getSessionActivity(sessionId),
    })
  );
}

if (
  req.method === "POST" &&
  req.url === "/transcribe"
) {
  const budget = getBudgetStatus();

  if (budget.mode === "BLOCKED") {
    res.writeHead(403);

    return res.end(
      JSON.stringify({
        status: "error",
        message:
          "Budget mensuel Noon atteint.",
      })
    );
  }

  const chunks = [];
  let totalBytes = 0;
  let audioTooLarge = false;

  req.on("data", (chunk) => {
    if (audioTooLarge) return;

    totalBytes += chunk.length;

    if (totalBytes > MAX_AUDIO_BYTES) {
      audioTooLarge = true;
      chunks.length = 0;
      return;
    }

    chunks.push(chunk);
  });

  req.on("end", async () => {
    if (audioTooLarge) {
      res.writeHead(413);

      return res.end(
        JSON.stringify({
          status: "error",
          message: "Enregistrement trop volumineux.",
        })
      );
    }

    if (chunks.length === 0) {
      res.writeHead(400);

      return res.end(
        JSON.stringify({
          status: "error",
          message: "Aucun son reçu.",
        })
      );
    }

    try {
      const audioBuffer = Buffer.concat(chunks);

      const text = await transcribeAudioBuffer(
        audioBuffer,
        req.headers["content-type"]
      );

      if (!text) {
        res.writeHead(422);

        return res.end(
          JSON.stringify({
            status: "error",
            message:
              "Aucune parole n'a été reconnue.",
          })
        );
      }

      res.writeHead(200);

      return res.end(
        JSON.stringify({
          status: "ok",
          text,
        })
      );
    } catch (error) {
      console.error(
        "Erreur de transcription :",
        error.message
      );

      res.writeHead(500);

      return res.end(
        JSON.stringify({
          status: "error",
          message:
            "Impossible de transcrire la voix.",
        })
      );
    }
  });

  return;
}

  res.writeHead(404);
  return res.end(
    JSON.stringify(
      {
        status: "error",
        message: "Route inconnue.",
      },
      null,
      2
    )
  );
});

server.listen(PORT, () => {
  console.log(`Noon est actif sur http://localhost:${PORT}`);
});

module.exports = server;
