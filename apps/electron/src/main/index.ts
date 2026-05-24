import type { Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import server from "@freestyle/server";
import { serve } from "@hono/node-server";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
  Tray,
} from "electron";
import type {
  IGlobalKeyDownMap,
  IGlobalKeyEvent,
} from "node-global-key-listener";
import { GlobalKeyboardListener } from "node-global-key-listener";
import { WebSocketServer } from "ws";
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
let keyListener: GlobalKeyboardListener | null = null;
let hotkeyPressed = false;

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
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}${path}`;
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
    focusable: false,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow!.showInactive();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
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

function showPill(): void {
  if (!mainWindow) {
    createAppWindow();
    return;
  }

  if (!mainWindow.isVisible()) {
    const { x, y } = getAppWindowPosition();
    mainWindow.setPosition(x, y);
    mainWindow.showInactive();
  }
}

function hidePill(): void {
  if (mainWindow?.isVisible()) {
    mainWindow.hide();
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
    if (mainWindow?.isVisible()) {
      hidePill();
    } else {
      showPill();
    }
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
    // Hide the pill first, then paste into the focused app
    hidePill();
    // Small delay for safety before pasting
    await new Promise((r) => setTimeout(r, 50));
    await pasteIntoFocusedApp(text);
  });

  // IPC: hide the pill window on request from renderer
  ipcMain.on("pill:hide", () => {
    hidePill();
  });

  // IPC: notify renderer of recording state changes
  ipcMain.on("ping", () => console.log("pong"));

  // Set database path for the server before any API calls
  process.env.FREESTYLE_DB_PATH = join(app.getPath("userData"), "freestyle.db");

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

  createAppWindow();

  // Register hold-to-record hotkey via node-global-key-listener
  registerHotkey();

  // Listen for hotkey changes from the settings UI
  ipcMain.on("hotkey:update", (_event, newHotkey: string) => {
    registerHotkey(newHotkey);
  });
});

const DEFAULT_HOTKEY = "Alt+Space";

// Map Electron accelerator parts to node-global-key-listener key names
type HotkeyParts = { modifiers: Set<string>; key: string };

function parseAccelerator(accel: string): HotkeyParts {
  const parts = accel.split("+").map((p) => p.trim());
  const key = parts[parts.length - 1];
  const modifiers = new Set<string>();

  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i].toLowerCase();
    if (mod === "alt" || mod === "option") {
      modifiers.add("LEFT ALT");
      modifiers.add("RIGHT ALT");
    } else if (mod === "ctrl" || mod === "control") {
      modifiers.add("LEFT CTRL");
      modifiers.add("RIGHT CTRL");
    } else if (mod === "shift") {
      modifiers.add("LEFT SHIFT");
      modifiers.add("RIGHT SHIFT");
    } else if (
      mod === "meta" ||
      mod === "super" ||
      mod === "command" ||
      mod === "commandorcontrol" ||
      mod === "cmdorctrl"
    ) {
      modifiers.add("LEFT META");
      modifiers.add("RIGHT META");
    }
  }

  // Map the key part to node-global-key-listener name
  const keyMap: Record<string, string> = {
    space: "SPACE",
    enter: "RETURN",
    return: "RETURN",
    escape: "ESCAPE",
    tab: "TAB",
    backspace: "BACKSPACE",
    delete: "DELETE",
    up: "UP ARROW",
    down: "DOWN ARROW",
    left: "LEFT ARROW",
    right: "RIGHT ARROW",
  };

  const mappedKey = keyMap[key.toLowerCase()] || key.toUpperCase();

  return { modifiers, key: mappedKey };
}

// Check if the required modifier keys are held down
function modifiersMatch(
  modifiers: Set<string>,
  isDown: IGlobalKeyDownMap,
): boolean {
  if (modifiers.size === 0) return true;

  // Group modifiers by type (left/right variants)
  const groups: string[][] = [];
  const seen = new Set<string>();

  for (const mod of modifiers) {
    if (seen.has(mod)) continue;
    // Find the paired variant
    if (mod.startsWith("LEFT ")) {
      const right = `RIGHT ${mod.slice(5)}`;
      groups.push([mod, right]);
      seen.add(mod);
      seen.add(right);
    } else if (mod.startsWith("RIGHT ")) {
      const left = `LEFT ${mod.slice(6)}`;
      groups.push([left, mod]);
      seen.add(mod);
      seen.add(left);
    } else {
      groups.push([mod]);
      seen.add(mod);
    }
  }

  // Each group must have at least one key held
  return groups.every((group) =>
    group.some((k) => isDown[k as keyof IGlobalKeyDownMap]),
  );
}

// Validate that an accelerator string is safe
function isValidAccelerator(accel: string): boolean {
  if (!accel || typeof accel !== "string") return false;
  if (!/^[\x20-\x7E]+$/.test(accel)) return false;
  if (!accel.includes("+") && !/^F\d{1,2}$/.test(accel)) return false;
  if (accel.endsWith("+")) return false;
  const parts = accel.split("+");
  if (parts.some((p) => !p.trim())) return false;
  return true;
}

function loadHotkeyFromDB(): string | undefined {
  try {
    const dbPath = process.env.FREESTYLE_DB_PATH;
    if (dbPath) {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(dbPath);
      const row = db
        .prepare("SELECT value FROM settings WHERE key = 'hotkey'")
        .get() as { value: string } | undefined;
      db.close();
      if (row?.value && isValidAccelerator(row.value)) {
        return row.value;
      }
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

function registerHotkey(hotkey?: string): void {
  // Tear down previous listener
  if (keyListener) {
    keyListener.kill();
    keyListener = null;
  }
  hotkeyPressed = false;

  if (!hotkey) {
    hotkey = loadHotkeyFromDB();
  }

  const accel = hotkey && isValidAccelerator(hotkey) ? hotkey : DEFAULT_HOTKEY;
  const { modifiers, key: triggerKey } = parseAccelerator(accel);

  keyListener = new GlobalKeyboardListener();

  const listener = (e: IGlobalKeyEvent, isDown: IGlobalKeyDownMap): void => {
    if (e.name !== triggerKey) return;

    if (e.state === "DOWN" && !hotkeyPressed) {
      // Check modifiers match
      if (!modifiersMatch(modifiers, isDown)) return;

      hotkeyPressed = true;
      showPill();
      mainWindow?.webContents.send("hotkey:down");
    } else if (e.state === "UP" && hotkeyPressed) {
      hotkeyPressed = false;
      mainWindow?.webContents.send("hotkey:up");
    }
  };

  keyListener.addListener(listener);
}

// Clean up key listener on quit
app.on("will-quit", () => {
  if (keyListener) {
    keyListener.kill();
    keyListener = null;
  }
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
