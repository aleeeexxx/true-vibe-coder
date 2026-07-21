import { Button, Key, keyboard, mouse } from "@nut-tree-fork/nut-js";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  findConnectedShokzMediaRemotes,
  type MediaRemoteDeviceCandidate,
} from "./mediaRemoteDevices";
import {
  chooseLiveIntentTarget,
  chooseProjectedIntentTarget,
  type PointerIntentTarget,
} from "./pointerAssistIntent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "ture vibe coder";
const execFileAsync = promisify(execFile);

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, "../..");

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

// Apple TV Remote is exposed to Chromium as a Bluetooth HID device.
app.commandLine.appendSwitch("disable-hid-blocklist");

if (process.platform === "darwin") {
  app.setName(APP_NAME);
  const appDataPath = app.getPath("appData");
  const userDataPath = path.join(appDataPath, APP_NAME);

  if (!existsSync(userDataPath)) {
    for (const legacyName of [
      "True White Color",
      "Lounge Control",
    ]) {
      const legacyPath = path.join(appDataPath, legacyName);
      if (!existsSync(legacyPath)) {
        continue;
      }

      try {
        renameSync(legacyPath, userDataPath);
      } catch {
        cpSync(legacyPath, userDataPath, { recursive: true });
      }
      break;
    }
  }

  app.setPath("userData", userDataPath);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
let isQuitting = false;
let appleRemoteHelper: ChildProcess | null = null;
let appleRemoteHelperBuffer = "";
let pointerAssistHelper: ChildProcess | null = null;
let mediaRemoteHelper: ChildProcess | null = null;
let mediaRemoteHelperBuffer = "";
let connectedMediaRemoteDevices: MediaRemoteDeviceCandidate[] = [];
let mediaRemoteCaptureRegistered = false;
let mediaRemoteSessionActive = false;
let mediaRemoteEventSequence = 0;
let mediaRemoteMappingKey: string | null = null;
let mediaRemoteLastCommand: string | null = null;
let mediaRemoteExecutionQueue: Promise<void> = Promise.resolve();
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");

type HidDeviceCandidate = {
  deviceId: string;
  name: string;
  vendorId: number;
  productId: number;
};

type PointerAssistTarget = {
  id: string;
  kind: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  actionable?: boolean;
};

type PointerAssistConfig = {
  enabled: boolean;
  radius: number;
  strength: number;
  snapThreshold: number;
};

type PointerAssistDirection = "up" | "down" | "left" | "right";

type PointerAssistNudgeOptions = {
  heldMs: number;
  repeatIndex: number;
  phase: "press" | "repeat" | "release";
};

type PointerAssistScrollDirection = "up" | "down";

type PointerAssistContinuousScrollState = {
  direction: PointerAssistScrollDirection;
  velocity: number;
  remainder: number;
  lastTickAt: number;
  activeUntil: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type PointerAssistVisualState = {
  enabled: boolean;
  locked: boolean;
  targetId: string | null;
  targetRole: string | null;
  targetKind: string | null;
  targetRect: DisplayBounds | null;
  reason: string;
};

const APPLE_HID_VENDOR_IDS = new Set([0x05ac, 0x004c]);
const REMOTE_HID_NAME_PATTERN = /\b(apple\s*tv|siri|remote)\b/i;
const EXCLUDED_HID_NAME_PATTERN =
  /\b(keyboard|mouse|trackpad|touchpad|audio|headset)\b/i;
let hidDeviceAccessConfigured = false;
let pointerAssistTargets: PointerAssistTarget[] = [];
let pointerAssistTargetsUpdatedAt = 0;
let pointerAssistLockedTargetId: string | null = null;
let pointerAssistLockedUntil = 0;
let pointerAssistStickyEscapeTargetId: string | null = null;
let pointerAssistStickyEscapeDelta: Point = { x: 0, y: 0 };
let pointerAssistElasticPoint: Point | null = null;
let pointerAssistElasticVelocity: Point = { x: 0, y: 0 };
let pointerAssistElasticLastAt = 0;
let pointerAssistLastMoveAt = 0;
let pointerAssistInputVelocity: Point = { x: 0, y: 0 };
let pointerAssistLastInputAt = 0;
let pointerAssistAnimationGeneration = 0;
let pointerAssistSuppressedTargetId: string | null = null;
let pointerAssistSuppressedUntil = 0;
let pointerAssistScrollState: PointerAssistContinuousScrollState | null = null;
let pointerAssistConfig: PointerAssistConfig = {
  enabled: false,
  radius: 118,
  strength: 0.78,
  snapThreshold: 28,
};

function isHidDeviceCandidate(device: unknown): device is HidDeviceCandidate {
  if (!device || typeof device !== "object") {
    return false;
  }

  const candidate = device as Partial<HidDeviceCandidate>;
  return (
    typeof candidate.deviceId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.vendorId === "number" &&
    typeof candidate.productId === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPointerAssistTarget(value: unknown): value is PointerAssistTarget {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.role === "string" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.priority === "number"
  );
}

function updatePointerAssistTargets(message: unknown) {
  if (!isRecord(message) || message.type !== "pointer-assist-targets") {
    return;
  }

  pointerAssistTargets = Array.isArray(message.targets)
    ? message.targets.filter(isPointerAssistTarget)
    : [];
  pointerAssistTargetsUpdatedAt = Date.now();
}

function isLikelyAppleRemoteHidDevice(device: HidDeviceCandidate): boolean {
  if (REMOTE_HID_NAME_PATTERN.test(device.name)) {
    return true;
  }

  if (!APPLE_HID_VENDOR_IDS.has(device.vendorId)) {
    return false;
  }

  return !EXCLUDED_HID_NAME_PATTERN.test(device.name);
}

function findAppleRemoteHidDevice(
  devices: HidDeviceCandidate[]
): HidDeviceCandidate | undefined {
  const namedRemote = devices.find((device) =>
    REMOTE_HID_NAME_PATTERN.test(device.name)
  );
  if (namedRemote) {
    return namedRemote;
  }

  const appleRemote = devices.find(isLikelyAppleRemoteHidDevice);
  if (appleRemote) {
    return appleRemote;
  }

  const nonExcludedDevices = devices.filter(
    (device) => !EXCLUDED_HID_NAME_PATTERN.test(device.name)
  );

  return nonExcludedDevices.length === 1 ? nonExcludedDevices[0] : undefined;
}

function configureHidDeviceAccess(browserWindow: BrowserWindow) {
  if (hidDeviceAccessConfigured) {
    return;
  }

  hidDeviceAccessConfigured = true;
  const session = browserWindow.webContents.session;

  session.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "hid";
  });

  session.setDevicePermissionHandler((details) => {
    return (
      details.deviceType === "hid" && isHidDeviceCandidate(details.device)
    );
  });

  session.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();

    const device = findAppleRemoteHidDevice(
      details.deviceList.filter(isHidDeviceCandidate)
    );

    callback(device?.deviceId ?? null);
  });
}

function getAppleRemoteHelperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "apple-remote-helper");
  }

  return path.join(process.env.APP_ROOT, "dist-native", "apple-remote-helper");
}

function getMediaRemoteHelperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "media-remote-helper");
  }

  return path.join(process.env.APP_ROOT, "dist-native", "media-remote-helper");
}

function broadcastAppleRemoteMessage(message: unknown) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("apple-remote-native-message", message);
    }
  });
}

function handleAppleRemoteHelperLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return;
  }

  try {
    const message = JSON.parse(trimmedLine);
    broadcastAppleRemoteMessage(message);
  } catch (error) {
    console.warn("Unable to parse Apple Remote helper output:", trimmedLine, error);
  }
}

function handlePointerAssistHelperLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return;
  }

  try {
    updatePointerAssistTargets(JSON.parse(trimmedLine));
  } catch (error) {
    console.warn("Unable to parse pointer assist helper output:", trimmedLine, error);
  }
}

function startAppleRemoteHelper() {
  if (process.platform !== "darwin") {
    return { success: false, error: "Apple TV Remote helper only supports macOS." };
  }

  if (appleRemoteHelper && !appleRemoteHelper.killed) {
    return { success: true };
  }

  const helperPath = getAppleRemoteHelperPath();
  appleRemoteHelperBuffer = "";
  const helper = spawn(helperPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  appleRemoteHelper = helper;

  helper.stdout?.on("data", (chunk) => {
    appleRemoteHelperBuffer += chunk.toString();
    const lines = appleRemoteHelperBuffer.split(/\r?\n/);
    appleRemoteHelperBuffer = lines.pop() ?? "";
    lines.forEach(handleAppleRemoteHelperLine);
  });

  helper.stderr?.on("data", (chunk) => {
    console.warn("Apple Remote helper:", chunk.toString());
  });

  helper.on("error", (error) => {
    broadcastAppleRemoteMessage({
      type: "error",
      message: `Failed to start Apple Remote helper: ${error.message}`,
    });
    appleRemoteHelper = null;
  });

  helper.on("exit", (code, signal) => {
    if (appleRemoteHelperBuffer.trim()) {
      handleAppleRemoteHelperLine(appleRemoteHelperBuffer);
      appleRemoteHelperBuffer = "";
    }

    broadcastAppleRemoteMessage({
      type: "helper-exit",
      code,
      signal,
    });
    appleRemoteHelper = null;
  });

  return { success: true };
}

function stopAppleRemoteHelper() {
  if (appleRemoteHelper && !appleRemoteHelper.killed) {
    appleRemoteHelper.kill();
  }

  appleRemoteHelper = null;
  appleRemoteHelperBuffer = "";
}

function startPointerAssistHelper() {
  if (process.platform !== "darwin") {
    return { success: false, error: "Pointer assist only supports macOS." };
  }

  if (pointerAssistHelper && !pointerAssistHelper.killed) {
    return { success: true };
  }

  const helperPath = getAppleRemoteHelperPath();
  const helper = spawn(helperPath, ["--pointer-assist"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let helperBuffer = "";
  pointerAssistHelper = helper;

  helper.stdout?.on("data", (chunk) => {
    if (pointerAssistHelper !== helper) {
      return;
    }

    helperBuffer += chunk.toString();
    const lines = helperBuffer.split(/\r?\n/);
    helperBuffer = lines.pop() ?? "";
    lines.forEach(handlePointerAssistHelperLine);
  });

  helper.stderr?.on("data", (chunk) => {
    console.warn("Pointer assist helper:", chunk.toString());
  });

  helper.on("error", (error) => {
    console.warn(`Failed to start pointer assist helper: ${error.message}`);
    if (pointerAssistHelper === helper) {
      pointerAssistHelper = null;
    }
  });

  helper.on("exit", () => {
    if (pointerAssistHelper !== helper) {
      return;
    }

    if (helperBuffer.trim()) {
      handlePointerAssistHelperLine(helperBuffer);
    }
    pointerAssistHelper = null;
    pointerAssistTargets = [];
    pointerAssistTargetsUpdatedAt = 0;
  });

  return { success: true };
}

function stopPointerAssistHelper() {
  const helper = pointerAssistHelper;
  if (helper && helper.exitCode === null) {
    helper.kill("SIGTERM");
    setTimeout(() => {
      if (helper.exitCode === null) {
        helper.kill("SIGKILL");
      }
    }, 400);
  }

  pointerAssistHelper = null;
  pointerAssistTargets = [];
  pointerAssistTargetsUpdatedAt = 0;
}

async function listConnectedMediaRemoteDevices() {
  if (process.platform !== "darwin") {
    connectedMediaRemoteDevices = [];
    return { success: true, devices: connectedMediaRemoteDevices };
  }

  try {
    const { stdout } = await execFileAsync(
      "/usr/sbin/system_profiler",
      ["SPBluetoothDataType", "-json"],
      {
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );
    const profile = JSON.parse(stdout);
    connectedMediaRemoteDevices = findConnectedShokzMediaRemotes(profile);
    return { success: true, devices: connectedMediaRemoteDevices };
  } catch (error) {
    connectedMediaRemoteDevices = [];
    return {
      success: false,
      devices: connectedMediaRemoteDevices,
      error: `Unable to inspect connected Bluetooth media devices: ${String(error)}`,
    };
  }
}

function broadcastMediaRemoteInput(command = "toggle") {
  mediaRemoteEventSequence += 1;
  mediaRemoteLastCommand = command;
  const device = connectedMediaRemoteDevices[0] ?? null;
  const payload = {
    type: "play-pause",
    sequence: mediaRemoteEventSequence,
    timestamp: Date.now(),
    deviceId: device?.id ?? null,
    command,
  };

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("media-remote-input", payload);
    }
  });

  broadcastMediaRemoteStatus();
}

function broadcastMediaRemoteStatus(error?: string) {
  const payload = {
    success: !error,
    registered: mediaRemoteCaptureRegistered,
    active: mediaRemoteSessionActive,
    inputCount: mediaRemoteEventSequence,
    lastCommand: mediaRemoteLastCommand,
    error,
  };

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("media-remote-status", payload);
    }
  });
}

function handleMediaRemoteHelperLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return;
  }

  try {
    const message = JSON.parse(trimmedLine);
    if (!isRecord(message) || typeof message.type !== "string") {
      return;
    }

    if (message.type === "media-remote-input") {
      const command =
        typeof message.command === "string" ? message.command : "toggle";
      broadcastMediaRemoteInput(command);
      queueMediaRemoteMappingExecution(mediaRemoteMappingKey);
      return;
    }

    if (message.type === "media-remote-status") {
      mediaRemoteSessionActive = message.active === true;
      broadcastMediaRemoteStatus();
      return;
    }

    if (message.type === "error") {
      const error =
        typeof message.message === "string"
          ? message.message
          : "The media remote helper reported an error.";
      broadcastMediaRemoteStatus(error);
    }
  } catch (error) {
    console.warn("Unable to parse media remote helper output:", trimmedLine, error);
  }
}

function startMediaRemoteHelper() {
  if (process.platform !== "darwin") {
    return {
      success: false,
      registered: false,
      active: false,
      error: "Bluetooth media remote mapping is only available on macOS.",
    };
  }

  if (mediaRemoteHelper && mediaRemoteHelper.exitCode === null) {
    return {
      success: true,
      registered: true,
      active: mediaRemoteSessionActive,
    };
  }

  const helperPath = getMediaRemoteHelperPath();
  if (!existsSync(helperPath)) {
    return {
      success: false,
      registered: false,
      active: false,
      error: `Media remote helper was not found at ${helperPath}.`,
    };
  }

  mediaRemoteHelperBuffer = "";
  mediaRemoteSessionActive = false;
  const helper = spawn(helperPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  mediaRemoteHelper = helper;
  mediaRemoteCaptureRegistered = true;

  helper.stdout?.on("data", (chunk) => {
    if (mediaRemoteHelper !== helper) {
      return;
    }

    mediaRemoteHelperBuffer += chunk.toString();
    const lines = mediaRemoteHelperBuffer.split(/\r?\n/);
    mediaRemoteHelperBuffer = lines.pop() ?? "";
    lines.forEach(handleMediaRemoteHelperLine);
  });

  helper.stderr?.on("data", (chunk) => {
    console.warn("Media remote helper:", chunk.toString());
  });

  helper.on("error", (error) => {
    if (mediaRemoteHelper !== helper) {
      return;
    }

    mediaRemoteHelper = null;
    mediaRemoteCaptureRegistered = false;
    mediaRemoteSessionActive = false;
    broadcastMediaRemoteStatus(
      `Failed to start media remote helper: ${error.message}`
    );
  });

  helper.on("exit", (code, signal) => {
    if (mediaRemoteHelper !== helper) {
      return;
    }

    if (mediaRemoteHelperBuffer.trim()) {
      handleMediaRemoteHelperLine(mediaRemoteHelperBuffer);
    }
    mediaRemoteHelperBuffer = "";
    mediaRemoteHelper = null;
    mediaRemoteCaptureRegistered = false;
    mediaRemoteSessionActive = false;

    const expectedExit = code === 0 || signal === "SIGTERM" || signal === "SIGKILL";
    broadcastMediaRemoteStatus(
      expectedExit
        ? undefined
        : `Media remote helper exited unexpectedly with code ${String(code)}.`
    );
  });

  return { success: true, registered: true, active: false };
}

function stopMediaRemoteHelper() {
  const helper = mediaRemoteHelper;
  mediaRemoteHelper = null;
  mediaRemoteHelperBuffer = "";
  mediaRemoteCaptureRegistered = false;
  mediaRemoteSessionActive = false;

  if (helper && helper.exitCode === null) {
    helper.kill("SIGTERM");
    setTimeout(() => {
      if (helper.exitCode === null) {
        helper.kill("SIGKILL");
      }
    }, 500);
  }
}

function setMediaRemoteCaptureConfiguration(
  configuration:
    | boolean
    | { enabled?: boolean; key?: string | null }
) {
  const enabled =
    typeof configuration === "boolean"
      ? configuration
      : configuration?.enabled === true;
  mediaRemoteMappingKey =
    enabled &&
    typeof configuration === "object" &&
    typeof configuration.key === "string" &&
    configuration.key.trim()
      ? configuration.key
      : null;

  if (!enabled) {
    stopMediaRemoteHelper();
    return { success: true, registered: false, active: false };
  }

  return startMediaRemoteHelper();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1580,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#edf2f0",
    icon: path.join(process.env.VITE_PUBLIC, "icon.png"),
    show: true,
    skipTaskbar: false,
    webPreferences: {
      preload,
      backgroundThrottling: false,
    },
  });

  configureHidDeviceAccess(win);

  if (VITE_DEV_SERVER_URL) {
    // #298
    win.loadURL(VITE_DEV_SERVER_URL);
    // Open devTool if the app is not packaged
    // win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      win?.hide();
    }
  });
}

// Check and request accessibility permissions on macOS
function checkAccessibilityPermissions() {
  if (process.platform === "darwin") {
    const hasAccess = systemPreferences.isTrustedAccessibilityClient(false);
    if (!hasAccess) {
      console.warn(
        "Accessibility permissions not granted. Please grant accessibility permissions in System Preferences > Security & Privacy > Privacy > Accessibility"
      );
    } else {
      console.log("Accessibility permissions granted");
    }
  }
}

function hasAccessibilityPermission(): boolean {
  return (
    process.platform !== "darwin" ||
    systemPreferences.isTrustedAccessibilityClient(false)
  );
}

function accessibilityPermissionError() {
  return {
    success: false,
    error:
      `Accessibility permission is required for ${APP_NAME} to control the keyboard and mouse.`,
  };
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Key mapping for nut-js - special keys
const keyMap: Record<string, Key> = {
  Meta: process.platform === "darwin" ? Key.LeftCmd : Key.LeftSuper,
  Cmd: Key.LeftCmd,
  Command: Key.LeftCmd,
  Super: Key.LeftSuper,
  Space: Key.Space,
  Enter: Key.Return,
  Return: Key.Return,
  NumpadEnter: Key.Enter,
  Escape: Key.Escape,
  Backspace: Key.Backspace,
  Tab: Key.Tab,
  Delete: Key.Delete,
  ArrowUp: Key.Up,
  ArrowDown: Key.Down,
  ArrowLeft: Key.Left,
  ArrowRight: Key.Right,
  Home: Key.Home,
  End: Key.End,
  PageUp: Key.PageUp,
  PageDown: Key.PageDown,
  Insert: Key.Insert,
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,
  Shift: Key.LeftShift,
  Control: Key.LeftControl,
  Ctrl: Key.LeftControl,
  Alt: Key.LeftAlt,
  Option: Key.LeftAlt,
};

// Mapping for single character keys to Key enum
const charKeyMap: Record<string, Key> = {
  a: Key.A,
  b: Key.B,
  c: Key.C,
  d: Key.D,
  e: Key.E,
  f: Key.F,
  g: Key.G,
  h: Key.H,
  i: Key.I,
  j: Key.J,
  k: Key.K,
  l: Key.L,
  m: Key.M,
  n: Key.N,
  o: Key.O,
  p: Key.P,
  q: Key.Q,
  r: Key.R,
  s: Key.S,
  t: Key.T,
  u: Key.U,
  v: Key.V,
  w: Key.W,
  x: Key.X,
  y: Key.Y,
  z: Key.Z,
  "0": Key.Num0,
  "1": Key.Num1,
  "2": Key.Num2,
  "3": Key.Num3,
  "4": Key.Num4,
  "5": Key.Num5,
  "6": Key.Num6,
  "7": Key.Num7,
  "8": Key.Num8,
  "9": Key.Num9,
  "-": Key.Minus,
  "=": Key.Equal,
  "[": Key.LeftBracket,
  "]": Key.RightBracket,
  "\\": Key.Backslash,
  ";": Key.Semicolon,
  "'": Key.Quote,
  ",": Key.Comma,
  ".": Key.Period,
  "/": Key.Slash,
  "`": Key.Grave,
};
keyboard.config.autoDelayMs = 0;
const KEY_TAP_DURATION_MS = 140;
const KEY_SETTLE_DELAY_MS = 24;
const MODIFIER_KEY_PAIRS = [
  [Key.LeftShift, Key.RightShift],
  [Key.LeftControl, Key.RightControl],
  [Key.LeftAlt, Key.RightAlt],
  [Key.LeftSuper, Key.RightSuper],
  [Key.LeftCmd, Key.RightCmd],
];

type HeldShortcutModifierSequence = {
  modifiers: Key[];
  primaryKeys: Key[];
  fullSequence?: Key[];
};

const heldShortcutModifierSequences = new Map<
  string,
  HeldShortcutModifierSequence
>();

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Convert key name to nut-js Key enum
function getNutKey(key: string): Key | null {
  // Check if it's a special key
  if (keyMap[key] !== undefined) {
    return keyMap[key];
  }
  // Single character keys
  if (key.length === 1) {
    const lowerKey = key.toLowerCase();
    if (charKeyMap[lowerKey]) {
      return charKeyMap[lowerKey];
    }
  }
  return null;
}

function getNutKeySequence(key: string): Key[] | null {
  const parts = key.includes("+")
    ? key.split("+").map((part) => part.trim()).filter(Boolean)
    : [key.trim()];
  const nutKeys = parts.map((part) => getNutKey(part));

  if (nutKeys.length === 0 || nutKeys.some((nutKey) => nutKey === null)) {
    return null;
  }

  return nutKeys as Key[];
}

// Check if a key is a modifier key
function isModifierKey(key: Key): boolean {
  return MODIFIER_KEY_PAIRS.some((pair) => pair.includes(key));
}

function orderKeySequenceForPress(keys: Key[]): Key[] {
  return [
    ...keys.filter(isModifierKey),
    ...keys.filter((key) => !isModifierKey(key)),
  ];
}

function orderKeySequenceForRelease(keys: Key[]): Key[] {
  return [...orderKeySequenceForPress(keys)].reverse();
}

function splitShortcutSequence(keys: Key[]): {
  modifiers: Key[];
  primaryKeys: Key[];
} {
  const orderedKeys = orderKeySequenceForPress(keys);
  return {
    modifiers: orderedKeys.filter(isModifierKey),
    primaryKeys: orderedKeys.filter((key) => !isModifierKey(key)),
  };
}

async function pressKeySequence(keys: Key[]) {
  for (const key of orderKeySequenceForPress(keys)) {
    await keyboard.pressKey(key);
    await delay(KEY_SETTLE_DELAY_MS);
  }
}

async function releaseKeySequence(keys: Key[]) {
  for (const key of orderKeySequenceForRelease(keys)) {
    await keyboard.releaseKey(key);
    await delay(KEY_SETTLE_DELAY_MS);
  }
}

async function tapKeySequence(keys: Key[]) {
  await pressKeySequence(keys);
  await delay(KEY_TAP_DURATION_MS);
  await releaseKeySequence(keys);
}

async function releaseKeysBestEffort(keys: Key[]) {
  for (const key of keys) {
    try {
      await keyboard.releaseKey(key);
      await delay(KEY_SETTLE_DELAY_MS);
    } catch {
      // Best-effort cleanup after a partial shortcut simulation.
    }
  }
}

function getModifierCleanupKeys(keys: Key[]): Key[] {
  const cleanupKeys = new Set<Key>();

  keys.filter(isModifierKey).forEach((modifierKey) => {
    const pair = MODIFIER_KEY_PAIRS.find((candidatePair) =>
      candidatePair.includes(modifierKey)
    );
    (pair ?? [modifierKey]).forEach((key) => cleanupKeys.add(key));
  });

  return Array.from(cleanupKeys);
}

async function releaseAllKnownModifiersBestEffort() {
  await releaseKeysBestEffort(MODIFIER_KEY_PAIRS.flat());
}

let keyboardSimulationQueue: Promise<void> = Promise.resolve();

function enqueueKeyboardSimulation<T>(operation: () => Promise<T>): Promise<T> {
  const queuedOperation = keyboardSimulationQueue
    .catch(() => undefined)
    .then(operation);
  keyboardSimulationQueue = queuedOperation.then(
    () => undefined,
    () => undefined
  );
  return queuedOperation;
}

async function executeMediaRemoteMapping(mappingKey: string) {
  if (!hasAccessibilityPermission()) {
    throw new Error(accessibilityPermissionError().error);
  }

  if (mappingKey.startsWith("Mouse")) {
    const button =
      mappingKey === "MouseLeft"
        ? Button.LEFT
        : mappingKey === "MouseRight"
          ? Button.RIGHT
          : mappingKey === "MouseMiddle"
            ? Button.MIDDLE
            : undefined;
    if (button === undefined) {
      throw new Error(`Unknown mouse button: ${mappingKey}`);
    }

    await mouse.pressButton(button);
    await delay(48);
    await mouse.releaseButton(button);
    return;
  }

  const keys = getNutKeySequence(mappingKey);
  if (!keys) {
    throw new Error(`Unsupported key combo: ${mappingKey}`);
  }

  await enqueueKeyboardSimulation(() => tapKeySequence(keys));
}

function queueMediaRemoteMappingExecution(mappingKey: string | null) {
  if (!mappingKey) {
    return;
  }

  mediaRemoteExecutionQueue = mediaRemoteExecutionQueue
    .catch(() => undefined)
    .then(() => executeMediaRemoteMapping(mappingKey))
    .then(() => broadcastMediaRemoteStatus())
    .catch((error) => {
      broadcastMediaRemoteStatus(
        `Unable to send the mapped headset shortcut: ${String(error)}`
      );
    });
}

async function pressShortcutAndHoldModifiers(shortcutKey: string, keys: Key[]) {
  if (heldShortcutModifierSequences.has(shortcutKey)) {
    return;
  }

  try {
    await pressKeySequence(keys);
    heldShortcutModifierSequences.set(shortcutKey, {
      modifiers: [],
      primaryKeys: [],
      fullSequence: keys,
    });
  } catch (error) {
    await releaseKeysBestEffort(orderKeySequenceForRelease(keys));
    throw error;
  }
}

async function releaseShortcutHeldModifiers(shortcutKey: string, keys: Key[]) {
  const heldShortcut = heldShortcutModifierSequences.get(shortcutKey);
  heldShortcutModifierSequences.delete(shortcutKey);

  if (heldShortcut?.fullSequence) {
    await releaseKeySequence(heldShortcut.fullSequence);
    await releaseKeysBestEffort(getModifierCleanupKeys(heldShortcut.fullSequence));
    await releaseAllKnownModifiersBestEffort();
    return;
  }

  const { modifiers, primaryKeys } =
    heldShortcut ?? splitShortcutSequence(keys);

  await releaseKeysBestEffort([
    ...primaryKeys.slice().reverse(),
    ...modifiers.slice().reverse(),
  ]);
  await releaseKeysBestEffort(getModifierCleanupKeys(keys));
  await releaseAllKnownModifiersBestEffort();
}

type Point = {
  x: number;
  y: number;
};

type DisplayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PointerAssistCandidate = PointerAssistTarget & {
  targetPoint: Point;
  distance: number;
  currentDistance: number;
  captureProgress: number;
  effectiveRadius: number;
  score: number;
};

type PointerAssistCaptureMargins = {
  x: number;
  y: number;
};

type PointerAssistMotion = {
  velocity: Point;
  speed: number;
  projectedPoint: Point;
};

function isPointInBounds(point: Point, bounds: DisplayBounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resetPointerAssistMotion() {
  pointerAssistInputVelocity = { x: 0, y: 0 };
  pointerAssistLastInputAt = 0;
}

function updatePointerAssistMotion(
  currentPoint: Point,
  nextPoint: Point
): PointerAssistMotion {
  const now = Date.now();
  const hadPreviousInput = pointerAssistLastInputAt > 0;
  const elapsedSeconds = hadPreviousInput
    ? clamp((now - pointerAssistLastInputAt) / 1000, 1 / 240, 0.08)
    : 1 / 60;
  pointerAssistLastInputAt = now;

  const instantaneousVelocity = {
    x: (nextPoint.x - currentPoint.x) / elapsedSeconds,
    y: (nextPoint.y - currentPoint.y) / elapsedSeconds,
  };
  const velocityBlend = hadPreviousInput ? 0.42 : 1;
  pointerAssistInputVelocity = {
    x:
      pointerAssistInputVelocity.x * (1 - velocityBlend) +
      instantaneousVelocity.x * velocityBlend,
    y:
      pointerAssistInputVelocity.y * (1 - velocityBlend) +
      instantaneousVelocity.y * velocityBlend,
  };

  const speed = Math.hypot(
    pointerAssistInputVelocity.x,
    pointerAssistInputVelocity.y
  );
  const projectionTime = clamp(0.04 + speed / 12000, 0.04, 0.11);
  const projectedDelta = {
    x: pointerAssistInputVelocity.x * projectionTime,
    y: pointerAssistInputVelocity.y * projectionTime,
  };
  const projectedDistance = Math.hypot(projectedDelta.x, projectedDelta.y);
  const projectionScale = projectedDistance > 180 ? 180 / projectedDistance : 1;

  return {
    velocity: { ...pointerAssistInputVelocity },
    speed,
    projectedPoint: constrainPointToDisplays({
      x: nextPoint.x + projectedDelta.x * projectionScale,
      y: nextPoint.y + projectedDelta.y * projectionScale,
    }),
  };
}

function normalizePointerAssistNudgeOptions(
  value: unknown
): PointerAssistNudgeOptions {
  if (!isRecord(value)) {
    return { heldMs: 0, repeatIndex: 0, phase: "press" };
  }

  const heldMs = clamp(Number(value.heldMs ?? 0), 0, 60000);
  const repeatIndex = Math.floor(
    clamp(Number(value.repeatIndex ?? 0), 0, 10000)
  );
  const phase =
    value.phase === "repeat" || value.phase === "release"
      ? value.phase
      : "press";

  return {
    heldMs,
    repeatIndex,
    phase,
  };
}

function clampPointToBounds(point: Point, bounds: DisplayBounds): Point {
  return {
    x: clamp(point.x, bounds.x, bounds.x + bounds.width - 1),
    y: clamp(point.y, bounds.y, bounds.y + bounds.height - 1),
  };
}

function squaredDistance(a: Point, b: Point): number {
  const deltaX = a.x - b.x;
  const deltaY = a.y - b.y;
  return deltaX * deltaX + deltaY * deltaY;
}

function constrainPointToDisplays(point: Point): Point {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) {
    return point;
  }

  if (displays.some((display) => isPointInBounds(point, display.bounds))) {
    return point;
  }

  let closestPoint = clampPointToBounds(point, displays[0].bounds);
  let closestDistance = squaredDistance(point, closestPoint);

  for (let index = 1; index < displays.length; index += 1) {
    const candidatePoint = clampPointToBounds(point, displays[index].bounds);
    const candidateDistance = squaredDistance(point, candidatePoint);

    if (candidateDistance < closestDistance) {
      closestPoint = candidatePoint;
      closestDistance = candidateDistance;
    }
  }

  return closestPoint;
}

function pointAtRectCenter(rect: DisplayBounds): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function rectsOverlapOnAxis(
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number
): number {
  return Math.max(
    0,
    Math.min(firstStart + firstLength, secondStart + secondLength) -
      Math.max(firstStart, secondStart)
  );
}

function closestPointInRect(point: Point, rect: DisplayBounds): Point {
  return {
    x: clamp(point.x, rect.x, rect.x + rect.width),
    y: clamp(point.y, rect.y, rect.y + rect.height),
  };
}

function pointIsInExpandedRect(
  point: Point,
  rect: DisplayBounds,
  expansion: number
): boolean {
  return (
    point.x >= rect.x - expansion &&
    point.x <= rect.x + rect.width + expansion &&
    point.y >= rect.y - expansion &&
    point.y <= rect.y + rect.height + expansion
  );
}

function distanceBetweenPoints(first: Point, second: Point): number {
  return Math.sqrt(squaredDistance(first, second));
}

function getPointerAssistTargetPoint(
  target: PointerAssistTarget,
  point: Point
): Point {
  if (
    target.kind === "window-edge" ||
    target.kind === "display-edge" ||
    isScrollBarAccessibilityTarget(target)
  ) {
    return closestPointInRect(point, target);
  }

  return pointAtRectCenter(target);
}

function getPreferredPointerAssistCaptureMargins(
  target: PointerAssistTarget
): PointerAssistCaptureMargins {
  const radiusScale = clamp(pointerAssistConfig.radius / 118, 0.45, 1.55);

  if (isScrollBarAccessibilityTarget(target)) {
    const thinSide = Math.min(target.width, target.height);
    const margin = clamp(
      (8 + thinSide * 0.24) * radiusScale,
      7,
      18
    );
    return { x: margin, y: margin };
  }

  const smallSide = Math.min(target.width, target.height);
  const smallTargetBoost = clamp((44 - smallSide) * 0.38, 0, 12);
  const baseMargin =
    (pointerAssistConfig.snapThreshold * 0.52 + 8 + smallTargetBoost) *
    radiusScale;

  return {
    x: clamp(baseMargin + target.width * 0.035, 12, 38),
    y: clamp(baseMargin + target.height * 0.035, 12, 38),
  };
}

function getPointerAssistCaptureMetrics(
  point: Point,
  target: PointerAssistTarget,
  margins: PointerAssistCaptureMargins
) {
  const overflowX = Math.max(
    target.x - point.x,
    0,
    point.x - (target.x + target.width)
  );
  const overflowY = Math.max(
    target.y - point.y,
    0,
    point.y - (target.y + target.height)
  );
  const normalizedX =
    margins.x <= 0 ? (overflowX > 0 ? Infinity : 0) : overflowX / margins.x;
  const normalizedY =
    margins.y <= 0 ? (overflowY > 0 ? Infinity : 0) : overflowY / margins.y;
  const normalizedDistance = Math.max(normalizedX, normalizedY);

  return {
    distance: Math.sqrt(overflowX * overflowX + overflowY * overflowY),
    normalizedDistance,
    inRange: normalizedDistance <= 1,
  };
}

function isSmallAccessibilityTarget(target: PointerAssistTarget): boolean {
  if (target.kind !== "accessibility") {
    return false;
  }

  const supportedRoles = new Set([
    "AXButton",
    "AXCheckBox",
    "AXRadioButton",
    "AXPopUpButton",
    "AXMenuButton",
    "AXDisclosureTriangle",
    "AXMenuItem",
    "AXLink",
  ]);
  if (!supportedRoles.has(target.role) && target.actionable !== true) {
    return false;
  }

  const area = target.width * target.height;
  return target.width <= 144 && target.height <= 72 && area <= 7600;
}

function isListLikeAccessibilityTarget(target: PointerAssistTarget): boolean {
  if (target.kind !== "accessibility") {
    return false;
  }

  const supportedRoles = new Set([
    "AXButton",
    "AXCheckBox",
    "AXRadioButton",
    "AXPopUpButton",
    "AXMenuButton",
    "AXDisclosureTriangle",
    "AXCell",
    "AXRow",
    "AXMenuItem",
    "AXLink",
  ]);
  if (!supportedRoles.has(target.role) && target.actionable !== true) {
    return false;
  }

  const area = target.width * target.height;
  return target.height <= 72 && target.width <= 760 && area <= 42000;
}

function isNavigablePointerAssistTarget(target: PointerAssistTarget): boolean {
  return isSmallAccessibilityTarget(target) || isScrollBarAccessibilityTarget(target);
}

function isScrollBarAccessibilityTarget(target: PointerAssistTarget): boolean {
  if (target.kind !== "accessibility" || target.role !== "AXScrollBar") {
    return false;
  }

  const thinSide = Math.min(target.width, target.height);
  const longSide = Math.max(target.width, target.height);
  return thinSide <= 32 && longSide >= 44;
}

function getFreshSmallPointerAssistTargets(): PointerAssistTarget[] {
  return Date.now() - pointerAssistTargetsUpdatedAt < 1500
    ? pointerAssistTargets
        .filter(isNavigablePointerAssistTarget)
        .filter((target) => !pointerAssistTargetIsSuppressed(target))
    : [];
}

function getFreshNavigablePointerAssistTargets(): PointerAssistTarget[] {
  return Date.now() - pointerAssistTargetsUpdatedAt < 1500
    ? pointerAssistTargets.filter(isNavigablePointerAssistTarget)
    : [];
}

function clearPointerAssistLock() {
  const hadLock = Boolean(pointerAssistLockedTargetId || pointerAssistLockedUntil);
  pointerAssistLockedTargetId = null;
  pointerAssistLockedUntil = 0;
  pointerAssistStickyEscapeTargetId = null;
  pointerAssistStickyEscapeDelta = { x: 0, y: 0 };
  pointerAssistElasticPoint = null;
  pointerAssistElasticVelocity = { x: 0, y: 0 };
  pointerAssistElasticLastAt = 0;
  pointerAssistLastMoveAt = 0;
  if (hadLock) {
    broadcastPointerAssistState("clear");
  }
}

function resetPointerAssistStickyEscape(targetId: string | null = null) {
  pointerAssistStickyEscapeTargetId = targetId;
  pointerAssistStickyEscapeDelta = { x: 0, y: 0 };
  pointerAssistElasticPoint = null;
  pointerAssistElasticVelocity = { x: 0, y: 0 };
  pointerAssistElasticLastAt = 0;
  pointerAssistLastMoveAt = 0;
  pointerAssistSuppressedTargetId = null;
  pointerAssistSuppressedUntil = 0;
}

function suppressPointerAssistTarget(targetId: string, durationMs = 420) {
  pointerAssistSuppressedTargetId = targetId;
  pointerAssistSuppressedUntil = Date.now() + durationMs;
}

function pointerAssistTargetIsSuppressed(target: PointerAssistTarget): boolean {
  if (!pointerAssistSuppressedTargetId) {
    return false;
  }

  if (Date.now() > pointerAssistSuppressedUntil) {
    pointerAssistSuppressedTargetId = null;
    pointerAssistSuppressedUntil = 0;
    return false;
  }

  return target.id === pointerAssistSuppressedTargetId;
}

function getLockedSmallPointerAssistTarget(): PointerAssistTarget | null {
  if (!pointerAssistLockedTargetId || Date.now() > pointerAssistLockedUntil) {
    clearPointerAssistLock();
    return null;
  }

  return (
    getFreshSmallPointerAssistTargets().find(
      (target) => target.id === pointerAssistLockedTargetId
    ) ?? null
  );
}

function getLockedNavigablePointerAssistTarget(): PointerAssistTarget | null {
  if (!pointerAssistLockedTargetId || Date.now() > pointerAssistLockedUntil) {
    clearPointerAssistLock();
    return null;
  }

  return (
    getFreshNavigablePointerAssistTargets().find(
      (target) => target.id === pointerAssistLockedTargetId
    ) ?? null
  );
}

function createPointerAssistState(reason: string): PointerAssistVisualState {
  const target =
    pointerAssistLockedTargetId && Date.now() <= pointerAssistLockedUntil
      ? pointerAssistTargets.find(
          (candidate) => candidate.id === pointerAssistLockedTargetId
        )
      : null;

  return {
    enabled: pointerAssistConfig.enabled,
    locked: Boolean(target),
    targetId: target?.id ?? null,
    targetRole: target?.role ?? null,
    targetKind: target?.kind ?? null,
    targetRect: target
      ? {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        }
      : null,
    reason,
  };
}

function broadcastPointerAssistState(reason: string) {
  const state = createPointerAssistState(reason);
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send("pointer-assist-state", state);
    }
  });
}

function createPointerIntentTargets(
  targets: PointerAssistTarget[],
  referencePoint: Point
): PointerIntentTarget[] {
  return targets.map((target) => {
    const margins = getPreferredPointerAssistCaptureMargins(target);
    return {
      id: target.id,
      rect: {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
      },
      targetPoint: getPointerAssistTargetPoint(target, referencePoint),
      priority: target.priority,
      captureX: margins.x,
      captureY: margins.y,
    };
  });
}

function findSmallPointerAssistTargetAtPoint(point: Point): PointerAssistTarget | null {
  let bestTarget: PointerAssistTarget | null = null;
  let bestScore = Infinity;
  const targets = getFreshSmallPointerAssistTargets();

  targets.forEach((target) => {
    const margins = { x: 2, y: 2 };
    const capture = getPointerAssistCaptureMetrics(point, target, margins);
    if (!capture.inRange) {
      return;
    }

    const distance = distanceBetweenPoints(
      point,
      getPointerAssistTargetPoint(target, point)
    );
    const score = capture.normalizedDistance * 1000 + distance;
    if (score < bestScore) {
      bestTarget = target;
      bestScore = score;
    }
  });

  return bestTarget;
}

function getPointerNavigationReferencePoint(
  target: PointerAssistTarget,
  point: Point
): Point {
  return !isSmallAccessibilityTarget(target) && isListLikeAccessibilityTarget(target)
    ? closestPointInRect(point, target)
    : getPointerAssistTargetPoint(target, point);
}

function getPointerAssistCandidates(
  currentPoint: Point,
  nextPoint: Point,
  motion: PointerAssistMotion
): PointerAssistCandidate[] {
  const targets = getFreshSmallPointerAssistTargets();
  const selected = chooseLiveIntentTarget(
    createPointerIntentTargets(targets, nextPoint),
    {
      currentPoint,
      nextPoint,
      velocity: motion.velocity,
    }
  );
  if (!selected) {
    return [];
  }

  const target = targets.find((candidate) => candidate.id === selected.id);
  if (!target) {
    return [];
  }

  const targetPoint = getPointerAssistTargetPoint(target, nextPoint);
  const margins = getPreferredPointerAssistCaptureMargins(target);
  return [
    {
      ...target,
      targetPoint,
      distance: selected.distance,
      currentDistance: distanceBetweenPoints(currentPoint, targetPoint),
      captureProgress: selected.captureProgress,
      effectiveRadius: Math.max(margins.x, margins.y, 1),
      score: selected.score,
    },
  ];
}

function elasticPointerAssistPoint(
  currentPoint: Point,
  desiredPoint: Point,
  targetPoint: Point,
  strength: number
): Point {
  const anchor = pointerAssistElasticPoint ?? currentPoint;
  const now = Date.now();
  const elapsedSeconds = pointerAssistElasticLastAt
    ? clamp((now - pointerAssistElasticLastAt) / 1000, 1 / 240, 1 / 30)
    : 1 / 60;
  pointerAssistElasticLastAt = now;
  const frameScale = clamp(elapsedSeconds * 60, 0.5, 2);
  const targetBias = clamp(0.08 + strength * 0.12, 0.1, 0.2);
  const biasedDesired = {
    x: desiredPoint.x + (targetPoint.x - desiredPoint.x) * targetBias,
    y: desiredPoint.y + (targetPoint.y - desiredPoint.y) * targetBias,
  };
  const spring = clamp((0.14 + strength * 0.18) * frameScale, 0.1, 0.58);
  const damping = Math.pow(0.7, frameScale);
  pointerAssistElasticVelocity = {
    x:
      (pointerAssistElasticVelocity.x +
        (biasedDesired.x - anchor.x) * spring) *
      damping,
    y:
      (pointerAssistElasticVelocity.y +
        (biasedDesired.y - anchor.y) * spring) *
      damping,
  };
  const directResponse = clamp(0.12 * frameScale, 0.07, 0.24);
  const nextElasticPoint = {
    x:
      anchor.x +
      pointerAssistElasticVelocity.x +
      (biasedDesired.x - anchor.x) * directResponse,
    y:
      anchor.y +
      pointerAssistElasticVelocity.y +
      (biasedDesired.y - anchor.y) * directResponse,
  };

  pointerAssistElasticPoint = nextElasticPoint;
  return nextElasticPoint;
}

function findCurrentPointerAssistTarget(point: Point): PointerAssistTarget | null {
  const targets = getFreshNavigablePointerAssistTargets();
  if (targets.length === 0) {
    return null;
  }

  const lockedTarget =
    pointerAssistLockedTargetId && Date.now() <= pointerAssistLockedUntil
      ? targets.find((target) => target.id === pointerAssistLockedTargetId)
      : undefined;
  if (lockedTarget) {
    return lockedTarget;
  }

  let bestTarget: PointerAssistTarget | null = null;
  let bestDistance = Infinity;

  targets.forEach((target) => {
    const targetPoint = getPointerNavigationReferencePoint(target, point);
    const distance = distanceBetweenPoints(point, targetPoint);
    const nearRadius =
      (isListLikeAccessibilityTarget(target)
        ? 24
        : Math.max(42, pointerAssistConfig.snapThreshold * 1.8)) +
      Math.max(target.width, target.height) * 0.35;

    if (distance <= nearRadius && distance < bestDistance) {
      bestTarget = target;
      bestDistance = distance;
    }
  });

  return bestTarget;
}

function findDirectionalPointerAssistTarget(
  currentTarget: PointerAssistTarget,
  direction: PointerAssistDirection
): PointerAssistTarget | null {
  const currentCenter = pointAtRectCenter(currentTarget);
  const isHorizontal = direction === "left" || direction === "right";
  const forwardSign = direction === "right" || direction === "down" ? 1 : -1;
  const minForwardGap = 4;
  const sameBandTolerance = isHorizontal ? 42 : 68;

  let bestTarget: PointerAssistTarget | null = null;
  let bestScore = Infinity;

  getFreshNavigablePointerAssistTargets().forEach((target) => {
    if (target.id === currentTarget.id) {
      return;
    }

    const targetCenter = pointAtRectCenter(target);
    const forwardDistance = isHorizontal
      ? (targetCenter.x - currentCenter.x) * forwardSign
      : (targetCenter.y - currentCenter.y) * forwardSign;
    if (forwardDistance <= minForwardGap) {
      return;
    }

    const crossDistance = isHorizontal
      ? Math.abs(targetCenter.y - currentCenter.y)
      : Math.abs(targetCenter.x - currentCenter.x);
    const axisOverlap = isHorizontal
      ? rectsOverlapOnAxis(
          currentTarget.y,
          currentTarget.height,
          target.y,
          target.height
        )
      : rectsOverlapOnAxis(
          currentTarget.x,
          currentTarget.width,
          target.x,
          target.width
        );

    if (crossDistance > sameBandTolerance && axisOverlap <= 0) {
      return;
    }

    const score =
      forwardDistance +
      crossDistance * (isHorizontal ? 3.2 : 2.4) -
      axisOverlap * 0.8;

    if (score < bestScore) {
      bestTarget = target;
      bestScore = score;
    }
  });

  return bestTarget;
}

const POINTER_ASSIST_SCROLL_FRAME_MS = 16;
const POINTER_ASSIST_SCROLL_PRESS_GRACE_MS = 380;
const POINTER_ASSIST_SCROLL_REPEAT_GRACE_MS = 140;
const POINTER_ASSIST_SCROLL_BASE_VELOCITY = 48;
const POINTER_ASSIST_SCROLL_MAX_VELOCITY = 132;

function getPointerAssistScrollVelocity(options: PointerAssistNudgeOptions) {
  const holdAcceleration = Math.min(62, options.heldMs * 0.045);
  const repeatAcceleration = Math.min(32, options.repeatIndex * 2.4);

  return clamp(
    POINTER_ASSIST_SCROLL_BASE_VELOCITY +
      holdAcceleration +
      repeatAcceleration,
    POINTER_ASSIST_SCROLL_BASE_VELOCITY,
    POINTER_ASSIST_SCROLL_MAX_VELOCITY
  );
}

function stopPointerAssistContinuousScroll(
  direction?: PointerAssistScrollDirection
) {
  if (!pointerAssistScrollState) {
    return;
  }

  if (direction && pointerAssistScrollState.direction !== direction) {
    return;
  }

  if (pointerAssistScrollState.timer) {
    clearTimeout(pointerAssistScrollState.timer);
  }

  pointerAssistScrollState = null;
}

async function tickPointerAssistContinuousScroll() {
  const state = pointerAssistScrollState;
  if (!state) {
    return;
  }

  state.timer = null;
  const now = Date.now();
  if (now > state.activeUntil) {
    stopPointerAssistContinuousScroll();
    return;
  }

  const elapsedSeconds = clamp(now - state.lastTickAt, 8, 40) / 1000;
  state.lastTickAt = now;
  state.remainder += state.velocity * elapsedSeconds;

  const scrollSteps = Math.min(4, Math.floor(state.remainder));
  if (scrollSteps > 0) {
    state.remainder -= scrollSteps;
    try {
      if (state.direction === "up") {
        await mouse.scrollUp(scrollSteps);
      } else {
        await mouse.scrollDown(scrollSteps);
      }
    } catch (error) {
      console.error("Error during pointer assist continuous scroll:", error);
      stopPointerAssistContinuousScroll();
      return;
    }
  }

  if (pointerAssistScrollState !== state) {
    return;
  }

  state.timer = setTimeout(
    () => void tickPointerAssistContinuousScroll(),
    POINTER_ASSIST_SCROLL_FRAME_MS
  );
}

function updatePointerAssistContinuousScroll(
  direction: PointerAssistScrollDirection,
  options: PointerAssistNudgeOptions
) {
  if (options.phase === "release") {
    stopPointerAssistContinuousScroll(direction);
    return { success: true, handled: true, action: "scroll-stop" };
  }

  const now = Date.now();
  const velocity = getPointerAssistScrollVelocity(options);
  const activeGrace =
    options.phase === "press"
      ? POINTER_ASSIST_SCROLL_PRESS_GRACE_MS
      : POINTER_ASSIST_SCROLL_REPEAT_GRACE_MS;
  const existingState =
    pointerAssistScrollState?.direction === direction
      ? pointerAssistScrollState
      : null;

  if (!existingState) {
    stopPointerAssistContinuousScroll();
    pointerAssistScrollState = {
      direction,
      velocity,
      remainder: 0,
      lastTickAt: now,
      activeUntil: now + activeGrace,
      timer: null,
    };
    void tickPointerAssistContinuousScroll();
    return { success: true, handled: true, action: "scroll", velocity };
  }

  existingState.velocity = Math.max(
    velocity,
    existingState.velocity * 0.45 + velocity * 0.55
  );
  existingState.activeUntil = now + activeGrace;

  if (!existingState.timer) {
    void tickPointerAssistContinuousScroll();
  }

  return {
    success: true,
    handled: true,
    action: "scroll",
    velocity: existingState.velocity,
  };
}

async function handlePointerAssistNudge(
  direction: PointerAssistDirection,
  options: PointerAssistNudgeOptions
) {
  if (direction === "up" || direction === "down") {
    if (options.phase === "release") {
      return updatePointerAssistContinuousScroll(direction, options);
    }

    const lockedTarget = getLockedNavigablePointerAssistTarget();
    if (lockedTarget) {
      stopPointerAssistContinuousScroll();
      const nextTarget = findDirectionalPointerAssistTarget(
        lockedTarget,
        direction
      );

      if (!nextTarget) {
        return { success: true, handled: false, action: "locked-no-target" };
      }

      const targetPoint = constrainPointToDisplays(
        getPointerAssistTargetPoint(nextTarget, await mouse.getPosition())
      );
      pointerAssistLockedTargetId = nextTarget.id;
      pointerAssistLockedUntil = Date.now() + 2200;
      resetPointerAssistStickyEscape(nextTarget.id);
      broadcastPointerAssistState("nudge-jump");
      await mouse.setPosition({
        x: Math.round(targetPoint.x),
        y: Math.round(targetPoint.y),
      });
      return {
        success: true,
        handled: true,
        action: "jump",
        targetId: nextTarget.id,
      };
    }

    return updatePointerAssistContinuousScroll(direction, options);
  }

  if (options.phase === "release") {
    return { success: true, handled: false };
  }

  if (!pointerAssistConfig.enabled) {
    return { success: true, handled: false };
  }

  const currentPoint = await mouse.getPosition();
  const currentTarget = findCurrentPointerAssistTarget(currentPoint);
  if (!currentTarget) {
    clearPointerAssistLock();
    return { success: true, handled: false };
  }

  const nextTarget = findDirectionalPointerAssistTarget(currentTarget, direction);
  if (nextTarget) {
    const targetPoint = constrainPointToDisplays(
      getPointerAssistTargetPoint(nextTarget, currentPoint)
    );
    pointerAssistLockedTargetId = nextTarget.id;
    pointerAssistLockedUntil = Date.now() + 2200;
    resetPointerAssistStickyEscape(nextTarget.id);
    broadcastPointerAssistState("nudge-jump");
    await mouse.setPosition({
      x: Math.round(targetPoint.x),
      y: Math.round(targetPoint.y),
    });
    return {
      success: true,
      handled: true,
      action: "jump",
      targetId: nextTarget.id,
    };
  }

  return { success: true, handled: false };
}

function applyLockedPointerAssist(
  currentPoint: Point,
  nextPoint: Point,
  motion: PointerAssistMotion
): Point | null {
  const lockedTarget =
    getLockedSmallPointerAssistTarget() ??
    findSmallPointerAssistTargetAtPoint(currentPoint);
  if (!lockedTarget) {
    return null;
  }

  if (pointerAssistStickyEscapeTargetId !== lockedTarget.id) {
    pointerAssistLockedTargetId = lockedTarget.id;
    resetPointerAssistStickyEscape(lockedTarget.id);
    broadcastPointerAssistState("sticky-lock");
  }

  const movementDelta = {
    x: nextPoint.x - currentPoint.x,
    y: nextPoint.y - currentPoint.y,
  };
  const now = Date.now();
  const elapsedMs = pointerAssistLastMoveAt
    ? now - pointerAssistLastMoveAt
    : 16;
  pointerAssistLastMoveAt = now;
  const escapeDecay = Math.pow(0.94, clamp(elapsedMs / 16, 1, 12));
  pointerAssistStickyEscapeDelta = {
    x: pointerAssistStickyEscapeDelta.x * escapeDecay + movementDelta.x,
    y: pointerAssistStickyEscapeDelta.y * escapeDecay + movementDelta.y,
  };

  const targetPoint = getPointerAssistTargetPoint(lockedTarget, nextPoint);
  const targetSize = Math.max(lockedTarget.width, lockedTarget.height);
  const targetSmallSide = Math.min(lockedTarget.width, lockedTarget.height);
  const releaseDistance = clamp(
    pointerAssistConfig.snapThreshold * 0.78 + targetSmallSide * 0.58,
    32,
    68
  );
  const stickyExpansion = clamp(releaseDistance * 0.95, 34, 74);
  const escapeDistance = distanceBetweenPoints(
    { x: 0, y: 0 },
    pointerAssistStickyEscapeDelta
  );
  const movementDistance = distanceBetweenPoints({ x: 0, y: 0 }, movementDelta);
  const isOutsideTargetCore = !pointIsInExpandedRect(
    nextPoint,
    lockedTarget,
    Math.min(18, targetSize * 0.22)
  );
  const shouldReleaseByFlick =
    motion.speed >= 760 &&
    movementDistance >= Math.max(6, targetSmallSide * 0.16) &&
    isOutsideTargetCore;
  const shouldReleaseByDrift = escapeDistance >= releaseDistance;

  if (shouldReleaseByFlick || shouldReleaseByDrift) {
    const escapeVector =
      escapeDistance > 0.01
        ? {
            x: pointerAssistStickyEscapeDelta.x / escapeDistance,
            y: pointerAssistStickyEscapeDelta.y / escapeDistance,
          }
        : { x: 0, y: 0 };
    const releaseBoost = clamp(6 + (escapeDistance - releaseDistance) * 0.22, 6, 16);
    const releasedPoint = constrainPointToDisplays({
      x: nextPoint.x + escapeVector.x * releaseBoost,
      y: nextPoint.y + escapeVector.y * releaseBoost,
    });
    clearPointerAssistLock();
    suppressPointerAssistTarget(lockedTarget.id, 320);
    return releasedPoint;
  }

  pointerAssistLockedUntil = now + 1400;

  const distance = distanceBetweenPoints(nextPoint, targetPoint);
  const stickyRadius =
    Math.max(lockedTarget.width, lockedTarget.height) / 2 + stickyExpansion;
  const radiusProgress = clamp(1 - distance / stickyRadius, 0, 1);
  const escapeProgress = clamp(escapeDistance / releaseDistance, 0, 1);
  const parallaxLimit = clamp(targetSmallSide * 0.28, 4, 12);
  const parallaxDistance = Math.min(parallaxLimit, escapeDistance * 0.18);
  const parallaxPoint =
    escapeDistance > 0.01
      ? {
          x:
            targetPoint.x +
            (pointerAssistStickyEscapeDelta.x / escapeDistance) * parallaxDistance,
          y:
            targetPoint.y +
            (pointerAssistStickyEscapeDelta.y / escapeDistance) * parallaxDistance,
        }
      : targetPoint;
  const magneticWeight = clamp(
    0.7 + pointerAssistConfig.strength * 0.12 + radiusProgress * 0.08 -
      escapeProgress * 0.14,
    0.62,
    0.92
  );

  const desiredPoint = {
    x: nextPoint.x + (parallaxPoint.x - nextPoint.x) * magneticWeight,
    y: nextPoint.y + (parallaxPoint.y - nextPoint.y) * magneticWeight,
  };

  return elasticPointerAssistPoint(
    currentPoint,
    desiredPoint,
    parallaxPoint,
    magneticWeight
  );
}

function applyPointerAssist(currentPoint: Point, nextPoint: Point): Point {
  if (!pointerAssistConfig.enabled) {
    clearPointerAssistLock();
    resetPointerAssistMotion();
    return nextPoint;
  }

  const motion = updatePointerAssistMotion(currentPoint, nextPoint);

  if (Date.now() > pointerAssistLockedUntil) {
    clearPointerAssistLock();
  }

  const lockedPoint = applyLockedPointerAssist(currentPoint, nextPoint, motion);
  if (lockedPoint) {
    return lockedPoint;
  }

  const candidates = getPointerAssistCandidates(currentPoint, nextPoint, motion).sort(
    (first, second) => second.score - first.score
  );
  const target = candidates[0];
  if (!target) {
    pointerAssistElasticPoint = null;
    pointerAssistElasticVelocity = { x: 0, y: 0 };
    pointerAssistElasticLastAt = 0;
    return nextPoint;
  }

  pointerAssistLockedTargetId = target.id;
  pointerAssistLockedUntil = Date.now() + 1400;
  resetPointerAssistStickyEscape(target.id);
  broadcastPointerAssistState("snap");

  const magneticWeight = clamp(
    0.1 +
      pointerAssistConfig.strength *
        target.captureProgress *
        target.captureProgress *
        0.62 +
      (target.captureProgress >= 0.74 ? 0.2 : 0),
    0.08,
    0.88
  );

  const desiredPoint = {
    x: nextPoint.x + (target.targetPoint.x - nextPoint.x) * magneticWeight,
    y: nextPoint.y + (target.targetPoint.y - nextPoint.y) * magneticWeight,
  };

  return elasticPointerAssistPoint(
    currentPoint,
    desiredPoint,
    target.targetPoint,
    magneticWeight
  );
}

function getProjectedPointerAssistTarget(
  currentPoint: Point,
  projectedPoint: Point,
  speed: number
): PointerAssistTarget | null {
  const targets = getFreshSmallPointerAssistTargets();
  const searchRadius = clamp(
    pointerAssistConfig.snapThreshold * 0.9 + 16 + speed * 0.016,
    30,
    72
  );
  const selected = chooseProjectedIntentTarget(
    createPointerIntentTargets(targets, projectedPoint),
    {
      currentPoint,
      nextPoint: projectedPoint,
      velocity: pointerAssistInputVelocity,
    },
    searchRadius
  );

  return selected
    ? targets.find((target) => target.id === selected.id) ?? null
    : null;
}

function getPointerAssistGestureProjection(currentPoint: Point): {
  point: Point;
  speed: number;
} | null {
  if (!pointerAssistLastInputAt || Date.now() - pointerAssistLastInputAt > 180) {
    return null;
  }

  const speed = Math.hypot(
    pointerAssistInputVelocity.x,
    pointerAssistInputVelocity.y
  );
  if (speed < 90) {
    return null;
  }

  const projectionTime = clamp(0.055 + speed / 9000, 0.055, 0.14);
  const projectedDelta = {
    x: pointerAssistInputVelocity.x * projectionTime,
    y: pointerAssistInputVelocity.y * projectionTime,
  };
  const projectedDistance = Math.hypot(projectedDelta.x, projectedDelta.y);
  const projectionScale = projectedDistance > 190 ? 190 / projectedDistance : 1;

  return {
    point: constrainPointToDisplays({
      x: currentPoint.x + projectedDelta.x * projectionScale,
      y: currentPoint.y + projectedDelta.y * projectionScale,
    }),
    speed,
  };
}

async function animatePointerAssistSnap(
  target: PointerAssistTarget,
  currentPoint: Point,
  reason: string
): Promise<boolean> {
  const generation = ++pointerAssistAnimationGeneration;
  const targetPoint = constrainPointToDisplays(
    getPointerAssistTargetPoint(target, currentPoint)
  );
  pointerAssistLockedTargetId = target.id;
  pointerAssistLockedUntil = Date.now() + 1600;
  resetPointerAssistStickyEscape(target.id);
  broadcastPointerAssistState(reason);

  const frameCount = 10;
  for (let frame = 1; frame <= frameCount; frame += 1) {
    if (generation !== pointerAssistAnimationGeneration) {
      return false;
    }

    const progress = frame / frameCount;
    const springProgress =
      1 - Math.exp(-6.2 * progress) * Math.cos(8.4 * progress);
    const nextPoint = constrainPointToDisplays({
      x: currentPoint.x + (targetPoint.x - currentPoint.x) * springProgress,
      y: currentPoint.y + (targetPoint.y - currentPoint.y) * springProgress,
    });
    await mouse.setPosition({
      x: Math.round(nextPoint.x),
      y: Math.round(nextPoint.y),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 12));
  }

  if (generation !== pointerAssistAnimationGeneration) {
    return false;
  }

  pointerAssistElasticPoint = targetPoint;
  pointerAssistElasticVelocity = { x: 0, y: 0 };
  pointerAssistElasticLastAt = 0;
  resetPointerAssistMotion();
  return true;
}

// Handle mouse movement requests
ipcMain.handle("mouse-move", async (_event, deltaX: number, deltaY: number) => {
  try {
    if (!hasAccessibilityPermission()) {
      return accessibilityPermissionError();
    }

    pointerAssistAnimationGeneration += 1;
    const currentPos = await mouse.getPosition();

    const nextPosition = constrainPointToDisplays({
      x: currentPos.x + Math.round(deltaX),
      y: currentPos.y + Math.round(deltaY),
    });

    const assistedPosition = constrainPointToDisplays(
      applyPointerAssist(currentPos, nextPosition)
    );

    await mouse.setPosition({
      x: Math.round(assistedPosition.x),
      y: Math.round(assistedPosition.y),
    });

    return { success: true };
  } catch (error) {
    console.error("Error moving mouse:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("pointer-assist-end-gesture", async () => {
  try {
    if (!pointerAssistConfig.enabled || !hasAccessibilityPermission()) {
      resetPointerAssistMotion();
      return { success: true, handled: false };
    }

    const currentPoint = await mouse.getPosition();
    const lockedTarget = getLockedSmallPointerAssistTarget();
    if (lockedTarget) {
      const handled = await animatePointerAssistSnap(
        lockedTarget,
        currentPoint,
        "gesture-settle"
      );
      return { success: true, handled, targetId: lockedTarget.id };
    }

    const projection = getPointerAssistGestureProjection(currentPoint);
    if (!projection) {
      resetPointerAssistMotion();
      return { success: true, handled: false };
    }

    const target = getProjectedPointerAssistTarget(
      currentPoint,
      projection.point,
      projection.speed
    );
    if (!target) {
      resetPointerAssistMotion();
      return { success: true, handled: false };
    }

    const handled = await animatePointerAssistSnap(
      target,
      currentPoint,
      "inertia-snap"
    );
    return { success: true, handled, targetId: target.id };
  } catch (error) {
    resetPointerAssistMotion();
    return { success: false, handled: false, error: String(error) };
  }
});

ipcMain.handle(
  "pointer-assist-config",
  async (_event, config: Partial<PointerAssistConfig>) => {
    const nextConfig = config ?? {};
    pointerAssistConfig = {
      enabled: Boolean(nextConfig.enabled),
      radius: clamp(Number(nextConfig.radius ?? pointerAssistConfig.radius), 12, 260),
      strength: clamp(
        Number(nextConfig.strength ?? pointerAssistConfig.strength),
        0.05,
        1
      ),
      snapThreshold: clamp(
        Number(nextConfig.snapThreshold ?? pointerAssistConfig.snapThreshold),
        0,
        120
      ),
    };

    if (pointerAssistConfig.enabled) {
      startPointerAssistHelper();
    } else {
      pointerAssistAnimationGeneration += 1;
      clearPointerAssistLock();
      resetPointerAssistMotion();
      stopPointerAssistHelper();
    }

    broadcastPointerAssistState("config");
    return { success: true, config: pointerAssistConfig };
  }
);

ipcMain.handle("pointer-assist-get-config", async () => {
  return { success: true, config: pointerAssistConfig };
});

ipcMain.handle("pointer-assist-get-state", async () => {
  return { success: true, state: createPointerAssistState("get-state") };
});

ipcMain.handle(
  "pointer-assist-nudge",
  async (_event, direction: PointerAssistDirection, rawOptions?: unknown) => {
    try {
      if (!hasAccessibilityPermission()) {
        return accessibilityPermissionError();
      }

      if (
        direction !== "up" &&
        direction !== "down" &&
        direction !== "left" &&
        direction !== "right"
      ) {
        return { success: false, handled: false, error: "Invalid direction." };
      }

      return await handlePointerAssistNudge(
        direction,
        normalizePointerAssistNudgeOptions(rawOptions)
      );
    } catch (error) {
      console.error("Error nudging pointer assist target:", error);
      return { success: false, handled: false, error: String(error) };
    }
  }
);

// Mouse button mapping
const mouseButtonMap: Record<string, Button> = {
  MouseLeft: Button.LEFT,
  MouseRight: Button.RIGHT,
  MouseMiddle: Button.MIDDLE,
};

// Handle mouse button toggle requests
ipcMain.handle(
  "mouse-button-toggle",
  async (_event, button: string, down: boolean) => {
    try {
      if (!hasAccessibilityPermission()) {
        return accessibilityPermissionError();
      }

      const nutButton = mouseButtonMap[button];
      if (nutButton === undefined) {
        console.warn(`Unknown mouse button: ${button}`);
        return { success: false, error: `Unknown mouse button: ${button}` };
      }

      if (down) {
        await mouse.pressButton(nutButton);
      } else {
        await mouse.releaseButton(nutButton);
      }

      return { success: true };
    } catch (error) {
      console.error("Error simulating mouse button:", error);
      return { success: false, error: String(error) };
    }
  }
);


// Handle key toggle requests
ipcMain.handle("key-toggle", async (_event, key: string, down: boolean) => {
  try {
    if (!hasAccessibilityPermission()) {
      return accessibilityPermissionError();
    }

    const nutKeys = getNutKeySequence(key);
    if (!nutKeys) {
      console.warn(`Unsupported key combo: ${key}`);
      return { success: false, error: `Unsupported key combo: ${key}` };
    }

    await enqueueKeyboardSimulation(() =>
      down ? pressKeySequence(nutKeys) : releaseKeySequence(nutKeys)
    );

    return { success: true };
  } catch (error) {
    console.error("Error simulating key:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  "key-shortcut-hold-toggle",
  async (_event, key: string, down: boolean) => {
    try {
      if (!hasAccessibilityPermission()) {
        return accessibilityPermissionError();
      }

      const nutKeys = getNutKeySequence(key);
      if (!nutKeys) {
        console.warn(`Unsupported key combo: ${key}`);
        return { success: false, error: `Unsupported key combo: ${key}` };
      }

      await enqueueKeyboardSimulation(() =>
        down
          ? pressShortcutAndHoldModifiers(key, nutKeys)
          : releaseShortcutHeldModifiers(key, nutKeys)
      );

      return { success: true };
    } catch (error) {
      console.error("Error simulating shortcut hold:", error);
      return { success: false, error: String(error) };
    }
  }
);

ipcMain.handle("key-tap", async (_event, key: string) => {
  try {
    if (!hasAccessibilityPermission()) {
      return accessibilityPermissionError();
    }

    const nutKeys = getNutKeySequence(key);
    if (!nutKeys) {
      console.warn(`Unsupported key combo: ${key}`);
      return { success: false, error: `Unsupported key combo: ${key}` };
    }

    await enqueueKeyboardSimulation(() => tapKeySequence(nutKeys));
    return { success: true };
  } catch (error) {
    console.error("Error tapping key:", error);
    try {
      const nutKeys = getNutKeySequence(key);
      if (nutKeys) {
        await releaseKeySequence(nutKeys);
      }
    } catch {
      // Best-effort cleanup after a failed shortcut tap.
    }
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("apple-remote-start", async () => startAppleRemoteHelper());
ipcMain.handle("apple-remote-stop", async () => {
  stopAppleRemoteHelper();
  return { success: true };
});
ipcMain.handle("media-remote-list-devices", async () =>
  listConnectedMediaRemoteDevices()
);
ipcMain.handle(
  "media-remote-configure",
  async (
    _event,
    configuration: boolean | { enabled?: boolean; key?: string | null }
  ) => setMediaRemoteCaptureConfiguration(configuration)
);
ipcMain.handle("media-remote-status", async () => ({
  success: true,
  registered: mediaRemoteCaptureRegistered,
  active: mediaRemoteSessionActive,
  inputCount: mediaRemoteEventSequence,
  lastCommand: mediaRemoteLastCommand,
}));
ipcMain.handle("open-bluetooth-settings", async () => {
  if (process.platform !== "darwin") {
    return { success: false, error: "Bluetooth Settings is only available on macOS." };
  }

  try {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.BluetoothSettings"
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

app.setLoginItemSettings({
  openAtLogin: true,
});


let tray = null;

function createTray() {
  const trayIconPath = path.join(
    process.env.VITE_PUBLIC,
    "tureVibeCoderTemplate.png"
  );
  const image = nativeImage.createFromPath(trayIconPath);
  image.setTemplateImage(true);

  tray = new Tray(image);

  const loginSettings = app.getLoginItemSettings();

  const contextMenu = Menu.buildFromTemplate([
    { label: `Show ${APP_NAME}`, click: () => { win?.show(); win?.focus(); } },
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: loginSettings.openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
        });
      },
    },
    {
      label: 'Show in Dock',
      type: 'checkbox',
      checked: app.dock?.isVisible() ?? true,
      visible: process.platform === 'darwin',
      click: (menuItem) => {
        if (menuItem.checked) {
          app.dock?.show();
        } else {
          app.dock?.hide();
        }
      },
    },
    { type: 'separator' },
    {
      label: `Quit ${APP_NAME}`,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },

  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  createWindow();
  // Check permissions
  checkAccessibilityPermissions();
  void releaseAllKnownModifiersBestEffort();

  createTray();
});

app.on("before-quit", () => {
  isQuitting = true;
  void releaseAllKnownModifiersBestEffort();
  stopAppleRemoteHelper();
  stopPointerAssistHelper();
  stopMediaRemoteHelper();
});
