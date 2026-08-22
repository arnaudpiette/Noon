const {
  app,
  BrowserWindow,
  session,
  systemPreferences,
} = require("electron");

const path = require("path");

let mainWindow = null;
let localServer = null;

function isNoonOrigin(origin) {
  try {
    return (
      new URL(origin).origin ===
      "http://localhost:3000"
    );
  } catch {
    return false;
  }
}

function configureMediaPermissions() {
  const noonSession = session.defaultSession;

  noonSession.setPermissionCheckHandler(
    (
      _webContents,
      permission,
      requestingOrigin,
      details
    ) => {
      if (permission !== "media") {
        return false;
      }

      const origin =
        requestingOrigin ||
        details?.securityOrigin ||
        "";

      const mediaType = details?.mediaType;

      return (
        isNoonOrigin(origin) &&
        mediaType !== "video"
      );
    }
  );

  noonSession.setPermissionRequestHandler(
    (
      webContents,
      permission,
      callback,
      details
    ) => {
      const origin =
        details?.securityOrigin ||
        webContents.getURL();

      const mediaTypes =
        details?.mediaTypes || [];

      const requestsAudio =
        mediaTypes.length === 0 ||
        mediaTypes.includes("audio");

      const requestsVideo =
        mediaTypes.includes("video");

      const permissionGranted =
        permission === "media" &&
        isNoonOrigin(origin) &&
        requestsAudio &&
        !requestsVideo;

      callback(permissionGranted);
    }
  );
}

async function requestMicrophoneAccess() {
  if (process.platform !== "darwin") {
    return true;
  }

  const currentStatus =
    systemPreferences.getMediaAccessStatus(
      "microphone"
    );

  if (currentStatus === "granted") {
    return true;
  }

  if (currentStatus === "not-determined") {
    return systemPreferences.askForMediaAccess(
      "microphone"
    );
  }

  console.warn(
    `Microphone non autorisé : ${currentStatus}`
  );

  return false;
}

function createWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    title: "Noon",
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#000000",
    show: false,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(
    "http://localhost:3000/app"
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startNoon() {
  localServer = require(
    path.join(__dirname, "..", "server.js")
  );

  if (localServer.listening) {
    createWindow();
    return;
  }

  localServer.once("listening", createWindow);
}

app.whenReady().then(async () => {
  configureMediaPermissions();

  const microphoneGranted =
    await requestMicrophoneAccess();

  if (!microphoneGranted) {
    console.warn(
      "Noon fonctionnera sans reconnaissance vocale."
    );
  }

  startNoon();

  app.on("activate", () => {
    if (!mainWindow) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (localServer?.listening) {
    localServer.close();
  }
});
