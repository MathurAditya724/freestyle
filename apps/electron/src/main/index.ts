import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import server from "@freestyle/server";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
  Tray,
} from "electron";
import type { Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import icon from "../../resources/icon.png?asset";
import trayIconPath from "../../resources/tray/logoTemplate.png?asset";
import { pasteIntoFocusedApp } from "./paste";

const SERVER_PORT = 4649;
const APP_WIDTH = 440;
const APP_HEIGHT = 120;
const APP_BOTTOM_MARGIN = 0;

let httpServer: Server | null = null;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Register a custom app:// protocol that serves the renderer files.
// All non-file paths fall back to index.html so BrowserRouter works in production.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function registerAppProtocol(): void {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let filePath = join(
      __dirname,
      "../renderer",
      decodeURIComponent(url.pathname),
    );

    // If the path has no file extension, serve index.html (SPA fallback)
    if (!filePath.match(/\.\w+$/)) {
      filePath = join(__dirname, "../renderer/index.html");
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function getRendererURL(path = "/"): string {
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    return `${process.env["ELECTRON_RENDERER_URL"]}${path}`;
  }
  return `app://renderer${path}`;
}

function getAppWindowPosition(): { x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  return {
    x: Math.round((width - APP_WIDTH) / 2),
    y: height - APP_HEIGHT - APP_BOTTOM_MARGIN,
  };
}

function createAppWindow(): void {
  const { x, y } = getAppWindowPosition();

  mainWindow = new BrowserWindow({
    width: APP_WIDTH,
    height: APP_HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    roundedCorners: true,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show();
    mainWindow!.webContents.send("pill:visibility", true);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Lose focus = hide the app pill (skip in dev for easier debugging)
  mainWindow.on("blur", () => {
    if (mainWindow && !is.dev) {
      mainWindow.hide();
      mainWindow.webContents.send("pill:visibility", false);
    }
  });

  mainWindow.on("show", () => {
    mainWindow?.webContents.send("pill:visibility", true);
  });

  mainWindow.on("hide", () => {
    mainWindow?.webContents.send("pill:visibility", false);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  mainWindow.loadURL(getRendererURL("/app"));
}

function createSettingsWindow(): void {
  settingsWindow = new BrowserWindow({
    width: 800,
    height: 560,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  settingsWindow.on("ready-to-show", () => {
    settingsWindow!.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  settingsWindow.loadURL(getRendererURL("/settings"));
}

function showAppWindow(): void {
  if (!mainWindow) {
    createAppWindow();
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    // Re-center in case display changed
    const { x, y } = getAppWindowPosition();
    mainWindow.setPosition(x, y);
    mainWindow.show();
    mainWindow.focus();
  }
}

function showSettingsWindow(): void {
  if (!settingsWindow) {
    createSettingsWindow();
    return;
  }
  settingsWindow.show();
  settingsWindow.focus();
}

function createTray(): void {
  const trayImage = nativeImage.createFromPath(trayIconPath);
  // Mark as template so macOS adapts to menu bar light/dark
  trayImage.setTemplateImage(true);

  tray = new Tray(trayImage);
  tray.setToolTip("Freestyle");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open App",
      click: () => showAppWindow(),
    },
    {
      label: "Settings",
      click: () => showSettingsWindow(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  // Left-click: toggle the app window
  tray.on("click", () => {
    showAppWindow();
  });

  // Right-click: show context menu
  tray.on("right-click", () => {
    tray!.popUpContextMenu(contextMenu);
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Register the custom app:// protocol for production SPA support
  registerAppProtocol();

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC: paste text at cursor
  ipcMain.handle("paste:text", async (_event, text: string) => {
    // Hide the pill first so the focused app receives the paste
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    }
    // Small delay to let the target app regain focus
    await new Promise((r) => setTimeout(r, 100));
    await pasteIntoFocusedApp(text);
  });

  // IPC: notify renderer of recording state changes
  ipcMain.on("ping", () => console.log("pong"));

  // Set database path for the server before any API calls
  process.env["FREESTYLE_DB_PATH"] = join(
    app.getPath("userData"),
    "freestyle.db",
  );

  // Start the Hono HTTP server with WebSocket support
  const wss = new WebSocketServer({ noServer: true });
  httpServer = serve(
    {
      fetch: server.fetch,
      port: SERVER_PORT,
      websocket: { server: wss },
    },
    (info) => {
      console.log(`Server running on http://localhost:${info.port}`);
    },
  );

  createTray();

  // Register global hotkey -- load from DB or use default
  registerHotkey();

  // Listen for hotkey changes from the settings UI
  ipcMain.on("hotkey:update", (_event, newHotkey: string) => {
    registerHotkey(newHotkey);
  });
});

const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";

function registerHotkey(hotkey?: string): void {
  globalShortcut.unregisterAll();

  // Try to load from DB if not provided
  if (!hotkey) {
    try {
      const dbPath = process.env["FREESTYLE_DB_PATH"];
      if (dbPath) {
        // Use a raw import to avoid circular deps -- the DB is already initialized
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(dbPath);
        const row = db
          .prepare("SELECT value FROM settings WHERE key = 'hotkey'")
          .get() as { value: string } | undefined;
        db.close();
        if (row?.value) hotkey = row.value;
      }
    } catch {
      // Ignore errors, use default
    }
  }

  const key = hotkey || DEFAULT_HOTKEY;

  try {
    const success = globalShortcut.register(key, () => {
      showAppWindow();
    });
    if (!success) {
      console.error(`Failed to register hotkey: ${key}`);
      // Fall back to default if custom key fails
      if (key !== DEFAULT_HOTKEY) {
        globalShortcut.register(DEFAULT_HOTKEY, () => {
          showAppWindow();
        });
      }
    }
  } catch (err) {
    console.error(`Error registering hotkey: ${key}`, err);
  }
}

// Unregister shortcuts on quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Keep app running in background when windows are closed (tray stays active)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // On non-macOS, keep the app alive for the tray
    // Only quit explicitly via tray menu
  }
});

// Gracefully shut down the HTTP server before quitting
app.on("before-quit", () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});
