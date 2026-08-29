"use strict";

// Configuration de packaging Electron Forge : icône, ressources macOS et formats distribués.

const path = require("path");
const macIcon = path.join(__dirname, "assets", "icons", "noon.icns");

const hasNotarizationCredentials = Boolean(
  process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
);

module.exports = {
  packagerConfig: {
    name: "Noon",
    executableName: "Noon",
    appBundleId: "com.arnaudpiette.noon",
    appCategoryType: "public.app-category.productivity",
    icon: macIcon,
    // Les bibliothèques natives de sharp/libvips doivent rester hors de l’archive
    // afin que le chargeur dynamique de macOS puisse résoudre leurs fichiers .dylib.
    asar: {
      unpack: "**/node_modules/@img/**",
    },
    arch: "x64",
    protocols: [{ name: "Noon", schemes: ["noon"] }],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Noon utilise le microphone pour les conversations vocales et, si vous l’activez, pour détecter localement la phrase “Salut Noon”.",
      NSRemindersUsageDescription:
        "Noon accède aux rappels uniquement pour préparer et synchroniser les éléments que vous demandez.",
      LSApplicationCategoryType: "public.app-category.productivity",
    },
    osxSign: process.env.APPLE_SIGN_IDENTITY ? {
      identity: process.env.APPLE_SIGN_IDENTITY,
      hardenedRuntime: true,
      entitlements: "build/entitlements.mac.plist",
      "entitlements-inherit": "build/entitlements.mac.plist",
    } : undefined,
    osxNotarize: hasNotarizationCredentials ? {
      tool: "notarytool",
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    } : undefined,
    ignore: [
      /^\/\.env(?:\.|$)/,
      /^\/\.git(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/backups(?:\/|$)/,
      /^\/logs(?:\/|$)/,
      /^\/test(?:\/|$)/,
      /^\/Workspace\/Temp(?:\/|$)/,
      /^\/.*(?:conversation-memory|conversation-summaries|creative-brief|long-term-memory|usage|projects-registry|project-journals|approval-audit|integration-tokens|automations).*\.json(?:\.tmp|\.bak)?$/,
    ],
  },
  makers: [
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
    { name: "@electron-forge/maker-dmg", platforms: ["darwin"], config: { name: "Noon", icon: macIcon } },
  ],
  plugins: [{ name: "@electron-forge/plugin-auto-unpack-natives", config: {} }],
};
