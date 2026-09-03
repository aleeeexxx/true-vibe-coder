import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MOUSE_INVERT_X,
  DEFAULT_MOUSE_INVERT_Y,
  DEFAULT_MOUSE_ROTATION,
  DEFAULT_MOUSE_SENSITIVITY,
} from "../constants/defaults";
import {
  normalizePointerRotation,
  PointerRotation,
} from "../utils/pointerRotation";
import {
  accumulateClickpadRingScroll,
  getClickpadClockwiseDeltaFromPoints,
  getClickpadGestureZone,
  isTrackableClickpadContact,
  type ClickpadGestureZone,
} from "../utils/clickpadGesture";

const STORAGE_KEY = "apple-remote-mappings";
const REMOTE_SESSION_ACTIVE_KEY = "apple-remote-session-active";
const APPLE_VENDOR_FILTERS: HIDDeviceFilter[] = [
  { vendorId: 0x05ac },
  { vendorId: 0x004c },
];
const APPLE_VENDOR_IDS = new Set([0x05ac, 0x004c]);
const REMOTE_NAME_PATTERN = /\b(apple\s*tv|siri|remote)\b/i;
const EXCLUDED_DEVICE_NAME_PATTERN =
  /\b(keyboard|mouse|trackpad|touchpad|audio|headset)\b/i;
const CURSOR_LEARNING_WINDOW_MS = 1800;
const MAX_CURSOR_SAMPLE_COUNT = 240;
const TOUCHPAD_CURSOR_MAPPING_REPORT_ID = -1;
const TOUCHPAD_CURSOR_BASE_SPEED = 1600;
const DEFAULT_TOUCHPAD_CONTACT_SENSITIVITY = 0.55;
const BUTTON_HOLD_THRESHOLD_MS = 550;
const BUTTON_PRESS_RESET_MS = 260;
const BUTTON_VISUAL_FLASH_MS = 160;
const REMOTE_TAP_MOUSE_DURATION_MS = 70;
const BACKSPACE_REPEAT_INITIAL_DELAY_MS = 220;
const BACKSPACE_REPEAT_INTERVAL_MS = 32;
const BACKSPACE_REPEAT_TAP_DURATION_MS = 12;
const DIRECTION_NUDGE_REPEAT_INITIAL_DELAY_MS = 280;
const DIRECTION_NUDGE_REPEAT_MAX_INTERVAL_MS = 70;
const DIRECTION_NUDGE_REPEAT_MIN_INTERVAL_MS = 34;
const TOUCHPAD_VISUAL_RELEASE_MS = 140;
const TOUCHPAD_RING_RELEASE_GRACE_MS = 280;
const TOUCHPAD_MIN_DELTA = 0.001;
const TOUCHPAD_MAX_DELTA = 0.35;
const TOUCHPAD_PRESS_LOCK_STALE_MS = 1800;
const DIRECTION_NAMES = ["up", "down", "left", "right"] as const;
const CLICKPAD_DIRECTION_USAGE_PAGE = 12;
const CLICKPAD_DIRECTION_USAGES = {
  up: 66,
  down: 67,
  left: 68,
  right: 69,
} as const;
type AppleRemoteClickpadDirection = (typeof DIRECTION_NAMES)[number];
const CLICKPAD_CENTER_USAGE = 128;
const TOUCHPAD_PRESS_LOCK_VISUAL_KEYS = new Set([
  `${CLICKPAD_DIRECTION_USAGE_PAGE}:${CLICKPAD_DIRECTION_USAGES.up}`,
  `${CLICKPAD_DIRECTION_USAGE_PAGE}:${CLICKPAD_DIRECTION_USAGES.down}`,
  `${CLICKPAD_DIRECTION_USAGE_PAGE}:${CLICKPAD_DIRECTION_USAGES.left}`,
  `${CLICKPAD_DIRECTION_USAGE_PAGE}:${CLICKPAD_DIRECTION_USAGES.right}`,
  `${CLICKPAD_DIRECTION_USAGE_PAGE}:${CLICKPAD_CENTER_USAGE}`,
]);

export const APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY =
  "__apple_remote_toggle_pointer_assist__";
export const APPLE_REMOTE_POINTER_ASSIST_TOGGLE_LABEL =
  "Toggle Magnetic Cursor";

export type AppleRemoteCursorMode =
  | "absolute-delta"
  | "relative-signed"
  | "directional-pad";

export type AppleRemoteCursorLearningMode = "auto" | "touchpad";

export type AppleRemoteModelKind =
  | "siri-remote-1"
  | "siri-remote-2"
  | "siri-remote-3"
  | "apple-remote-ir"
  | "unknown";

export interface AppleRemoteModelInfo {
  kind: AppleRemoteModelKind;
  displayName: string;
  generationLabel: string;
  connectorLabel: string;
  bodyStyle: "black-glass" | "silver-clickpad" | "aluminum-ir" | "generic";
  hasMotionSensors: boolean;
  motionSensorConfidence: "known" | "inferred" | "unknown";
}

export function getAppleRemoteModelInfo(
  productId: number
): AppleRemoteModelInfo {
  switch (productId) {
    case 0x0266:
    case 0x026d:
      return {
        kind: "siri-remote-1",
        displayName: "Siri Remote",
        generationLabel: "1st generation",
        connectorLabel: "Lightning",
        bodyStyle: "black-glass",
        hasMotionSensors: true,
        motionSensorConfidence: "known",
      };
    case 0x0314:
      return {
        kind: "siri-remote-2",
        displayName: "Siri Remote",
        generationLabel: "2nd generation",
        connectorLabel: "Lightning",
        bodyStyle: "silver-clickpad",
        hasMotionSensors: false,
        motionSensorConfidence: "inferred",
      };
    case 0x0315:
      return {
        kind: "siri-remote-3",
        displayName: "Siri Remote",
        generationLabel: "3rd generation",
        connectorLabel: "USB-C",
        bodyStyle: "silver-clickpad",
        hasMotionSensors: false,
        motionSensorConfidence: "known",
      };
    default:
      return {
        kind: "unknown",
        displayName: "Apple TV Remote",
        generationLabel: "Unknown generation",
        connectorLabel: "Unknown connector",
        bodyStyle: "generic",
        hasMotionSensors: false,
        motionSensorConfidence: "unknown",
      };
  }
}

export interface AppleRemoteDeviceState {
  id: string;
  name: string;
  vendorId: number;
  productId: number;
  opened: boolean;
  serialNumber?: string;
  modelInfo: AppleRemoteModelInfo;
}

export interface AppleRemoteButtonControl {
  type: "byte-value";
  reportId: number;
  byteIndex: number;
  value: number;
}

export interface AppleRemoteNativeButtonControl {
  type: "native-value";
  eventKey: string;
  usagePage: number;
  usage: number;
  cookie: number;
  reportId: number;
  value: number;
}

export type AppleRemoteButtonControlUnion =
  | AppleRemoteButtonControl
  | AppleRemoteNativeButtonControl;

export type AppleRemoteButtonTrigger = "press" | "hold";
export type AppleRemoteButtonOutputMode = "tap" | "hold" | "hold-modifiers";

export interface AppleRemoteButtonMapping {
  controlKey: string;
  control: AppleRemoteButtonControlUnion;
  key: string;
  label: string;
  trigger: AppleRemoteButtonTrigger;
  outputMode: AppleRemoteButtonOutputMode;
}

export interface AppleRemoteActiveButtonState {
  usagePage: number;
  usage: number;
  trigger: AppleRemoteButtonTrigger;
}

export interface AppleRemoteCursorSource {
  type?: "byte";
  byteIndex: number;
  width: 1 | 2;
  endian?: "little" | "big";
}

export interface AppleRemoteNativeCursorSource {
  type: "native";
  eventKey: string;
  usagePage: number;
  usage: number;
  cookie: number;
  reportId: number;
  logicalMin: number;
  logicalMax: number;
  isRelative: boolean;
}

export type AppleRemoteCursorSourceUnion =
  | AppleRemoteCursorSource
  | AppleRemoteNativeCursorSource;

export interface AppleRemoteDirectionalCursorControl {
  usagePage: number;
  usage: number;
  value: number;
}

export interface AppleRemoteDirectionalCursorControls {
  up: AppleRemoteDirectionalCursorControl;
  down: AppleRemoteDirectionalCursorControl;
  left: AppleRemoteDirectionalCursorControl;
  right: AppleRemoteDirectionalCursorControl;
}

export interface AppleRemoteCursorMapping {
  reportId: number;
  xSource: AppleRemoteCursorSourceUnion;
  ySource: AppleRemoteCursorSourceUnion;
  directionControls?: AppleRemoteDirectionalCursorControls;
  mode: AppleRemoteCursorMode;
  sensitivity: number;
  touchpadContactSensitivity: number;
  invertX: boolean;
  invertY: boolean;
  rotation: PointerRotation;
}

export interface AppleRemoteMapping {
  deviceId: string;
  buttonMappings: AppleRemoteButtonMapping[];
  cursorMapping?: AppleRemoteCursorMapping;
}

function createDefaultDirectionalCursorControls(): AppleRemoteDirectionalCursorControls {
  return {
    up: {
      usagePage: CLICKPAD_DIRECTION_USAGE_PAGE,
      usage: CLICKPAD_DIRECTION_USAGES.up,
      value: 1,
    },
    down: {
      usagePage: CLICKPAD_DIRECTION_USAGE_PAGE,
      usage: CLICKPAD_DIRECTION_USAGES.down,
      value: 1,
    },
    left: {
      usagePage: CLICKPAD_DIRECTION_USAGE_PAGE,
      usage: CLICKPAD_DIRECTION_USAGES.left,
      value: 1,
    },
    right: {
      usagePage: CLICKPAD_DIRECTION_USAGE_PAGE,
      usage: CLICKPAD_DIRECTION_USAGES.right,
      value: 1,
    },
  };
}

function createDefaultTouchpadCursorMapping(
  existingMapping?: AppleRemoteCursorMapping
): AppleRemoteCursorMapping {
  return {
    reportId: TOUCHPAD_CURSOR_MAPPING_REPORT_ID,
    xSource: { type: "byte", byteIndex: 0, width: 1 },
    ySource: { type: "byte", byteIndex: 1, width: 1 },
    directionControls: undefined,
    mode: "absolute-delta",
    sensitivity: existingMapping?.sensitivity ?? DEFAULT_MOUSE_SENSITIVITY,
    touchpadContactSensitivity:
      existingMapping?.touchpadContactSensitivity ??
      DEFAULT_TOUCHPAD_CONTACT_SENSITIVITY,
    invertX: existingMapping?.invertX ?? DEFAULT_MOUSE_INVERT_X,
    invertY: existingMapping?.invertY ?? DEFAULT_MOUSE_INVERT_Y,
    rotation: normalizePointerRotation(
      existingMapping?.rotation ?? DEFAULT_MOUSE_ROTATION
    ),
  };
}

function supportsTouchpadCursor(
  device: AppleRemoteDeviceState
): boolean {
  return device.modelInfo.bodyStyle === "silver-clickpad";
}

function ensureDefaultTouchpadCursorMapping(
  previousMappings: AppleRemoteMapping[],
  device: AppleRemoteDeviceState
): AppleRemoteMapping[] {
  if (!supportsTouchpadCursor(device)) {
    return previousMappings;
  }

  const existingMapping = previousMappings.find(
    (mapping) => mapping.deviceId === device.id
  );

  if (
    existingMapping?.cursorMapping &&
    existingMapping.cursorMapping.mode !== "directional-pad"
  ) {
    return previousMappings;
  }

  const cursorMapping = createDefaultTouchpadCursorMapping(
    existingMapping?.cursorMapping
  );

  if (!existingMapping) {
    return [
      ...previousMappings,
      {
        deviceId: device.id,
        buttonMappings: [],
        cursorMapping,
      },
    ];
  }

  return previousMappings.map((mapping) =>
    mapping.deviceId === device.id
      ? {
          ...mapping,
          cursorMapping,
        }
      : mapping
  );
}

type CursorSample = {
  deviceId: string;
  reportId: number;
  bytes: number[];
};

type CursorCandidate = {
  reportId: number;
  source: AppleRemoteCursorSourceUnion;
  score: number;
};

export interface AppleRemoteNativeDevice {
  id: string;
  serviceId: string;
  name: string;
  vendorId: number;
  productId: number;
  serialNumber?: string;
  locationId?: number;
  primaryUsagePage?: number;
  primaryUsage?: number;
}

export interface AppleRemoteNativeInput {
  type: "input";
  deviceId: string;
  serviceId: string;
  eventKey: string;
  usagePage: number;
  usage: number;
  cookie: number;
  reportId: number;
  value: number;
  logicalMin: number;
  logicalMax: number;
  isRelative: boolean;
}

export interface AppleRemoteNativeRawInput {
  type: "raw-input";
  deviceId: string;
  serviceId: string;
  reportId: number;
  bytes: number[];
}

export interface AppleRemoteTouchpadInput {
  type: "touchpad";
  deviceId?: string;
  mtDeviceId: number;
  frame: number;
  touchId: number;
  state: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  size: number;
  width?: number;
  height?: number;
}

export interface AppleRemoteTouchpadVisualState {
  deviceId: string;
  x: number;
  y: number;
  size: number;
  active: boolean;
  gestureZone: ClickpadGestureZone;
}

interface AppleRemoteSpecialActionHandlers {
  onTogglePointerAssist?: () => void;
}

type AppleRemoteNativeMessage =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "warning"; message: string; code?: number }
  | { type: "touchpad-error"; message: string }
  | {
      type: "touchpad-ready";
      deviceId?: string;
      mtDeviceId: number;
      width: number;
      height: number;
      startResult?: number;
    }
  | { type: "helper-exit"; code?: number | null; signal?: string | null }
  | { type: "device-connected"; device: AppleRemoteNativeDevice }
  | { type: "device-disconnected"; deviceId: string; serviceId?: string }
  | AppleRemoteNativeRawInput
  | AppleRemoteTouchpadInput
  | AppleRemoteNativeInput;

type NativeCursorSample = {
  deviceId: string;
  eventKey: string;
  source: AppleRemoteNativeCursorSource;
  value: number;
};

type TouchpadCursorState = {
  deviceId: string;
  touchId: number;
  frame: number;
  x: number;
  y: number;
  gestureZone: ClickpadGestureZone;
  ringAngleRemainder: number;
  ringScrollLocked: boolean;
};

type ButtonHoldState = {
  active: boolean;
  holdTriggered: boolean;
  timerId: number | null;
};

type ButtonMappingGroup = {
  physicalKey: string;
  active: boolean;
  mappings: AppleRemoteButtonMapping[];
};

type PendingMouseMovement = {
  deltaX: number;
  deltaY: number;
};

type PendingTouchpadScroll = {
  deltaY: number;
};

type KeyRepeatState = {
  timeoutId: number | null;
  intervalId: number | null;
  inFlight: boolean;
};

type DirectionNudgeRepeatState = {
  direction: AppleRemoteClickpadDirection;
  timeoutId: number | null;
  inFlight: boolean;
  startedAt: number;
  repeatIndex: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidCursorSource(
  value: unknown
): value is AppleRemoteCursorSourceUnion {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "native") {
    return (
      typeof value.eventKey === "string" &&
      typeof value.usagePage === "number" &&
      typeof value.usage === "number" &&
      typeof value.cookie === "number" &&
      typeof value.reportId === "number" &&
      typeof value.logicalMin === "number" &&
      typeof value.logicalMax === "number" &&
      typeof value.isRelative === "boolean"
    );
  }

  const width = value.width;
  return (
    (value.type === undefined || value.type === "byte") &&
    typeof value.byteIndex === "number" &&
    Number.isInteger(value.byteIndex) &&
    value.byteIndex >= 0 &&
    (width === 1 || width === 2) &&
    (value.endian === undefined ||
      value.endian === "little" ||
      value.endian === "big")
  );
}

function isValidButtonControl(
  value: unknown
): value is AppleRemoteButtonControlUnion {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "native-value") {
    return (
      typeof value.eventKey === "string" &&
      typeof value.usagePage === "number" &&
      typeof value.usage === "number" &&
      typeof value.cookie === "number" &&
      typeof value.reportId === "number" &&
      typeof value.value === "number"
    );
  }

  return (
    value.type === "byte-value" &&
    typeof value.reportId === "number" &&
    Number.isInteger(value.reportId) &&
    typeof value.byteIndex === "number" &&
    Number.isInteger(value.byteIndex) &&
    value.byteIndex >= 0 &&
    typeof value.value === "number" &&
    Number.isInteger(value.value) &&
    value.value >= 0 &&
    value.value <= 255
  );
}

function isValidDirectionalCursorControl(
  value: unknown
): value is AppleRemoteDirectionalCursorControl {
  return (
    isRecord(value) &&
    typeof value.usagePage === "number" &&
    typeof value.usage === "number" &&
    typeof value.value === "number"
  );
}

function isValidDirectionalCursorControls(
  value: unknown
): value is AppleRemoteDirectionalCursorControls {
  return (
    isRecord(value) &&
    DIRECTION_NAMES.every((direction) =>
      isValidDirectionalCursorControl(value[direction])
    )
  );
}

function isValidButtonMapping(
  value: unknown
): value is AppleRemoteButtonMapping {
  return (
    isRecord(value) &&
    isValidButtonControl(value.control) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    (value.trigger === undefined ||
      value.trigger === "press" ||
      value.trigger === "hold") &&
    (value.outputMode === undefined ||
      value.outputMode === "tap" ||
      value.outputMode === "hold" ||
      value.outputMode === "hold-modifiers")
  );
}

function isCodexHoldShortcut(key: string): boolean {
  const parts = key
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  return (
    parts.length === 3 &&
    parts.includes("ctrl") &&
    parts.includes("shift") &&
    parts.includes("d")
  );
}

function normalizeButtonOutputMode(
  value: unknown,
  key: string,
  trigger: AppleRemoteButtonTrigger
): AppleRemoteButtonOutputMode {
  if (isCodexHoldShortcut(key)) {
    return "hold-modifiers";
  }

  if (value === "tap" || value === "hold" || value === "hold-modifiers") {
    return value;
  }

  if (trigger === "hold") {
    return "hold";
  }

  return "tap";
}

function buttonMappingHoldsOutput(
  buttonMapping: Pick<AppleRemoteButtonMapping, "outputMode">
): boolean {
  return (
    buttonMapping.outputMode === "hold" ||
    buttonMapping.outputMode === "hold-modifiers"
  );
}

function isAppleRemoteSpecialActionKey(key: string): boolean {
  return key === APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY;
}

function isTouchpadPressLockInput(input: AppleRemoteNativeInput): boolean {
  return TOUCHPAD_PRESS_LOCK_VISUAL_KEYS.has(
    `${input.usagePage}:${input.usage}`
  );
}

function pruneStaleTouchpadPressLocks(
  locks: Map<string, number>,
  deviceId?: string
) {
  const now = Date.now();
  Array.from(locks.entries()).forEach(([key, lockedAt]) => {
    if (deviceId && !key.startsWith(`${deviceId}:`)) {
      return;
    }

    if (now - lockedAt > TOUCHPAD_PRESS_LOCK_STALE_MS) {
      locks.delete(key);
    }
  });
}

function touchpadPressLockIsActive(
  locks: Map<string, number>,
  deviceId: string
): boolean {
  pruneStaleTouchpadPressLocks(locks, deviceId);
  return Array.from(locks.keys()).some((pressLockKey) =>
    pressLockKey.startsWith(`${deviceId}:`)
  );
}

function isClickpadDirectionInput(input: AppleRemoteNativeInput): boolean {
  return getClickpadDirectionInputDirection(input) !== null;
}

function getClickpadDirectionInputDirection(
  input: AppleRemoteNativeInput
): AppleRemoteClickpadDirection | null {
  if (input.usagePage !== CLICKPAD_DIRECTION_USAGE_PAGE) {
    return null;
  }

  return (
    DIRECTION_NAMES.find(
      (direction) => CLICKPAD_DIRECTION_USAGES[direction] === input.usage
    ) ?? null
  );
}

function getClickpadDirectionStateKey(input: AppleRemoteNativeInput): string {
  return `${input.deviceId}:${input.usagePage}:${input.usage}`;
}

function clearClickpadDirectionStatesForDevice(
  states: Map<string, boolean>,
  deviceId: string
) {
  Array.from(states.keys()).forEach((key) => {
    if (key.startsWith(`${deviceId}:`)) {
      states.delete(key);
    }
  });
}

function clickpadDirectionInputIsActive(input: AppleRemoteNativeInput): boolean {
  return input.value !== 0;
}

function getDirectionNudgeRepeatInterval(
  heldMs: number,
  repeatIndex: number
): number {
  const holdProgress = clamp(heldMs / 1200, 0, 1);
  const repeatProgress = clamp(repeatIndex / 12, 0, 1);
  const acceleratedInterval =
    DIRECTION_NUDGE_REPEAT_MAX_INTERVAL_MS -
    (DIRECTION_NUDGE_REPEAT_MAX_INTERVAL_MS -
      DIRECTION_NUDGE_REPEAT_MIN_INTERVAL_MS) *
      Math.max(holdProgress, repeatProgress);

  return Math.round(
    clamp(
      acceleratedInterval,
      DIRECTION_NUDGE_REPEAT_MIN_INTERVAL_MS,
      DIRECTION_NUDGE_REPEAT_MAX_INTERVAL_MS
    )
  );
}

function normalizeButtonMapping(
  value: unknown
): AppleRemoteButtonMapping | null {
  if (!isValidButtonMapping(value)) {
    return null;
  }

  const trigger = value.trigger ?? "press";
  const outputMode = normalizeButtonOutputMode(
    value.outputMode,
    value.key,
    trigger
  );

  return {
    ...value,
    trigger,
    outputMode,
    controlKey: getAppleRemoteButtonControlKey(value.control, trigger),
  };
}

function normalizeCursorMode(value: unknown): AppleRemoteCursorMode {
  if (value === "relative-signed" || value === "directional-pad") {
    return value;
  }

  return "absolute-delta";
}

function normalizeTouchpadContactSensitivity(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_TOUCHPAD_CONTACT_SENSITIVITY;
  }

  return clamp(value, 0.1, 1);
}

function normalizeCursorMapping(
  value: unknown
): AppleRemoteCursorMapping | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.reportId !== "number" ||
    !Number.isInteger(value.reportId) ||
    !isValidCursorSource(value.xSource) ||
    !isValidCursorSource(value.ySource)
  ) {
    return undefined;
  }

  const mode = normalizeCursorMode(value.mode);
  const directionControls = isValidDirectionalCursorControls(
    value.directionControls
  )
    ? value.directionControls
    : mode === "directional-pad"
      ? createDefaultDirectionalCursorControls()
      : undefined;

  const normalizedMapping: AppleRemoteCursorMapping = {
    reportId: value.reportId,
    xSource: value.xSource,
    ySource: value.ySource,
    directionControls,
    mode,
    sensitivity:
      typeof value.sensitivity === "number"
        ? value.sensitivity
        : DEFAULT_MOUSE_SENSITIVITY,
    touchpadContactSensitivity: normalizeTouchpadContactSensitivity(
      value.touchpadContactSensitivity
    ),
    invertX:
      typeof value.invertX === "boolean"
        ? value.invertX
        : DEFAULT_MOUSE_INVERT_X,
    invertY:
      typeof value.invertY === "boolean"
        ? value.invertY
        : DEFAULT_MOUSE_INVERT_Y,
    rotation: normalizePointerRotation(value.rotation),
  };

  return mode === "directional-pad"
    ? createDefaultTouchpadCursorMapping(normalizedMapping)
    : normalizedMapping;
}

function normalizeStoredMappings(value: unknown): AppleRemoteMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((mappingValue) => {
    if (!isRecord(mappingValue) || typeof mappingValue.deviceId !== "string") {
      return [];
    }

    return [
      {
        deviceId: mappingValue.deviceId,
        buttonMappings: Array.isArray(mappingValue.buttonMappings)
          ? mappingValue.buttonMappings.flatMap((buttonMappingValue) => {
              const buttonMapping = normalizeButtonMapping(buttonMappingValue);
              return buttonMapping ? [buttonMapping] : [];
            })
          : [],
        cursorMapping: normalizeCursorMapping(mappingValue.cursorMapping),
      },
    ];
  });
}

export function getAppleRemoteDeviceId(device: HIDDevice): string {
  const productName = device.productName || "Apple TV Remote";
  return `${device.vendorId.toString(16)}:${device.productId.toString(
    16
  )}:${productName}`;
}

function getAppleRemoteDeviceName(device: HIDDevice): string {
  return device.productName || "Apple TV Remote";
}

function isLikelyAppleRemoteDevice(device: HIDDevice): boolean {
  const productName = getAppleRemoteDeviceName(device);

  if (REMOTE_NAME_PATTERN.test(productName)) {
    return true;
  }

  if (!APPLE_VENDOR_IDS.has(device.vendorId)) {
    return false;
  }

  return !EXCLUDED_DEVICE_NAME_PATTERN.test(productName);
}

function toDeviceState(device: HIDDevice): AppleRemoteDeviceState {
  const modelInfo = getAppleRemoteModelInfo(device.productId);
  const fallbackName = getAppleRemoteDeviceName(device);
  const name =
    modelInfo.kind === "unknown"
      ? fallbackName
      : `${modelInfo.displayName} (${modelInfo.generationLabel})`;

  return {
    id: getAppleRemoteDeviceId(device),
    name,
    vendorId: device.vendorId,
    productId: device.productId,
    opened: device.opened,
    modelInfo,
  };
}

function nativeDeviceToDeviceState(
  device: AppleRemoteNativeDevice
): AppleRemoteDeviceState {
  const modelInfo = getAppleRemoteModelInfo(device.productId);
  const name =
    modelInfo.kind === "unknown"
      ? device.name || "Apple TV Remote"
      : `${modelInfo.displayName} (${modelInfo.generationLabel})`;

  return {
    id: device.id,
    name,
    vendorId: device.vendorId,
    productId: device.productId,
    opened: true,
    serialNumber: device.serialNumber || undefined,
    modelInfo,
  };
}

function isAppleRemoteNativeMessage(
  value: unknown
): value is AppleRemoteNativeMessage {
  return isRecord(value) && typeof value.type === "string";
}

function bytesFromDataView(data: DataView): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < data.byteLength; index += 1) {
    bytes.push(data.getUint8(index));
  }
  return bytes;
}

function getReportKey(deviceId: string, reportId: number): string {
  return `${deviceId}:${reportId}`;
}

export function getAppleRemoteButtonControlKey(
  control: AppleRemoteButtonControlUnion,
  trigger: AppleRemoteButtonTrigger = "press"
): string {
  let baseKey: string;

  if (control.type === "native-value") {
    baseKey = `native:${control.usagePage}:${control.usage}:${control.value}`;
  } else {
    baseKey = `${control.reportId}:${control.byteIndex}:${control.value}`;
  }

  return `${trigger}:${baseKey}`;
}

function getAppleRemotePhysicalControlKey(
  control: AppleRemoteButtonControlUnion
): string {
  if (control.type === "native-value") {
    return `native:${control.usagePage}:${control.usage}:${control.value}`;
  }

  return `${control.reportId}:${control.byteIndex}:${control.value}`;
}

function getAppleRemoteNativeVisualControlKey(
  usagePage: number,
  usage: number
): string {
  return `native:${usagePage}:${usage}`;
}

function getAppleRemoteNativeControlName(
  usagePage: number,
  usage: number
): string | null {
  const key = `${usagePage}:${usage}`;
  const names: Record<string, string> = {
    "1:129": "Power",
    "1:134": "Back",
    "12:1": "Consumer Control",
    "12:4": "Siri / Voice",
    "12:64": "Menu",
    "12:65": "Menu Pick",
    "12:66": "Clickpad Up",
    "12:67": "Clickpad Down",
    "12:68": "Clickpad Left",
    "12:69": "Clickpad Right",
    "12:96": "TV / Home",
    "12:128": "Clickpad Center",
    "12:205": "Play/Pause",
    "12:226": "Mute",
    "12:233": "Volume Up",
    "12:234": "Volume Down",
    "12:514": "TV / Home",
  };

  return names[key] ?? null;
}

export function formatAppleRemoteButtonControl(
  control: AppleRemoteButtonControlUnion
): string {
  if (control.type === "native-value") {
    const name = getAppleRemoteNativeControlName(
      control.usagePage,
      control.usage
    );
    return name ?? `Usage ${control.usagePage}:${control.usage}`;
  }

  return `Report ${control.reportId}, byte ${control.byteIndex + 1} = 0x${control.value
    .toString(16)
    .padStart(2, "0")}`;
}

export function formatAppleRemoteCursorSource(
  source: AppleRemoteCursorSourceUnion
): string {
  if (source.type === "native") {
    return `usage ${source.usagePage}:${source.usage}`;
  }

  if (source.width === 1) {
    return `byte ${source.byteIndex + 1}`;
  }

  const endian = source.endian === "big" ? "BE" : "LE";
  return `bytes ${source.byteIndex + 1}-${source.byteIndex + 2} ${endian}`;
}

function detectButtonControl(
  reportId: number,
  bytes: number[],
  previousBytes?: number[]
): AppleRemoteButtonControl | null {
  const changed = bytes
    .map((value, byteIndex) => ({
      byteIndex,
      value,
      previousValue: previousBytes?.[byteIndex] ?? 0,
    }))
    .filter(
      ({ value, previousValue }) => value !== previousValue && value !== 0
    );

  const selectedChange =
    changed.find(({ value }) => value !== 255) ?? changed[0];

  if (selectedChange) {
    return {
      type: "byte-value",
      reportId,
      byteIndex: selectedChange.byteIndex,
      value: selectedChange.value,
    };
  }

  const nonZeroIndex = bytes.findIndex((value) => value !== 0);
  if (nonZeroIndex === -1) {
    return null;
  }

  return {
    type: "byte-value",
    reportId,
    byteIndex: nonZeroIndex,
    value: bytes[nonZeroIndex],
  };
}

function controlIsActive(
  control: AppleRemoteButtonControl,
  reportId: number,
  bytes: number[]
): boolean {
  return (
    control.reportId === reportId && bytes[control.byteIndex] === control.value
  );
}

function nativeButtonControlMatchesInput(
  control: AppleRemoteNativeButtonControl,
  input: AppleRemoteNativeInput
): boolean {
  return (
    control.usagePage === input.usagePage &&
    control.usage === input.usage
  );
}

function isConsumerSelectorInput(input: AppleRemoteNativeInput): boolean {
  return input.usagePage === 12 && input.usage === 1;
}

function nativeButtonControlIsActive(
  control: AppleRemoteNativeButtonControl,
  input: AppleRemoteNativeInput
): boolean {
  return nativeButtonControlMatchesInput(control, input) &&
    input.value === control.value;
}

function resolveNativeButtonInput(
  input: AppleRemoteNativeInput,
  selectorValues: Map<string, number>
): AppleRemoteNativeInput {
  if (!isConsumerSelectorInput(input)) {
    return input;
  }

  const selectorKey = `${input.deviceId}:${input.eventKey}`;

  if (input.value !== 0) {
    selectorValues.set(selectorKey, input.value);
    return {
      ...input,
      usage: input.value,
      value: 1,
    };
  }

  const previousUsage = selectorValues.get(selectorKey);
  selectorValues.delete(selectorKey);

  if (!previousUsage) {
    return input;
  }

  return {
    ...input,
    usage: previousUsage,
    value: 0,
  };
}

function addButtonMappingGroup(
  groups: Map<string, ButtonMappingGroup>,
  mapping: AppleRemoteButtonMapping,
  active: boolean
) {
  const physicalKey = getAppleRemotePhysicalControlKey(mapping.control);
  const existingGroup = groups.get(physicalKey);

  if (existingGroup) {
    existingGroup.active = existingGroup.active || active;
    existingGroup.mappings.push(mapping);
    return;
  }

  groups.set(physicalKey, {
    physicalKey,
    active,
    mappings: [mapping],
  });
}

function isNativeCursorSource(
  source: AppleRemoteCursorSourceUnion
): source is AppleRemoteNativeCursorSource {
  return source.type === "native";
}

function sourceEndIndex(source: AppleRemoteCursorSource): number {
  return source.byteIndex + source.width - 1;
}

function sourcesOverlap(
  first: AppleRemoteCursorSourceUnion,
  second: AppleRemoteCursorSourceUnion
): boolean {
  if (isNativeCursorSource(first) || isNativeCursorSource(second)) {
    return (
      isNativeCursorSource(first) &&
      isNativeCursorSource(second) &&
      first.eventKey === second.eventKey
    );
  }

  return (
    first.byteIndex <= sourceEndIndex(second) &&
    second.byteIndex <= sourceEndIndex(first)
  );
}

function readUnsignedSource(
  bytes: number[],
  source: AppleRemoteCursorSource
): number | null {
  if (source.byteIndex < 0 || source.byteIndex >= bytes.length) {
    return null;
  }

  if (source.width === 1) {
    return bytes[source.byteIndex];
  }

  const nextIndex = source.byteIndex + 1;
  if (nextIndex >= bytes.length) {
    return null;
  }

  const first = bytes[source.byteIndex];
  const second = bytes[nextIndex];
  return source.endian === "big"
    ? (first << 8) | second
    : first | (second << 8);
}

function createCursorSources(byteLength: number): AppleRemoteCursorSource[] {
  const sources: AppleRemoteCursorSource[] = [];

  for (let byteIndex = 0; byteIndex < byteLength; byteIndex += 1) {
    sources.push({ byteIndex, width: 1 });
  }

  for (let byteIndex = 0; byteIndex < byteLength - 1; byteIndex += 1) {
    sources.push({ byteIndex, width: 2, endian: "little" });
    sources.push({ byteIndex, width: 2, endian: "big" });
  }

  return sources;
}

function scoreCursorSource(
  reportId: number,
  source: AppleRemoteCursorSource,
  samples: CursorSample[]
): CursorCandidate {
  let score = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previousValue = readUnsignedSource(samples[index - 1].bytes, source);
    const currentValue = readUnsignedSource(samples[index].bytes, source);

    if (previousValue === null || currentValue === null) {
      continue;
    }

    score += Math.abs(currentValue - previousValue);
  }

  return { reportId, source, score };
}

function learnCursorMappingFromSamples(
  samples: CursorSample[]
): AppleRemoteCursorMapping | null {
  const samplesByReport = new Map<number, CursorSample[]>();

  samples.forEach((sample) => {
    const reportSamples = samplesByReport.get(sample.reportId) ?? [];
    reportSamples.push(sample);
    samplesByReport.set(sample.reportId, reportSamples);
  });

  const candidates: CursorCandidate[] = [];

  samplesByReport.forEach((reportSamples, reportId) => {
    if (reportSamples.length < 3) {
      return;
    }

    const byteLength = Math.max(
      ...reportSamples.map((sample) => sample.bytes.length)
    );

    createCursorSources(byteLength).forEach((source) => {
      const candidate = scoreCursorSource(reportId, source, reportSamples);
      if (candidate.score > 0) {
        candidates.push(candidate);
      }
    });
  });

  candidates.sort((first, second) => second.score - first.score);

  for (const xCandidate of candidates) {
    const yCandidate = candidates.find(
      (candidate) =>
        candidate.reportId === xCandidate.reportId &&
        candidate !== xCandidate &&
        !sourcesOverlap(candidate.source, xCandidate.source)
    );

    if (yCandidate) {
      return {
        reportId: xCandidate.reportId,
        xSource: xCandidate.source,
        ySource: yCandidate.source,
        mode: "absolute-delta",
        sensitivity: DEFAULT_MOUSE_SENSITIVITY,
        touchpadContactSensitivity: DEFAULT_TOUCHPAD_CONTACT_SENSITIVITY,
        invertX: DEFAULT_MOUSE_INVERT_X,
        invertY: DEFAULT_MOUSE_INVERT_Y,
        rotation: DEFAULT_MOUSE_ROTATION,
      };
    }
  }

  return null;
}

function createNativeCursorSource(
  input: AppleRemoteNativeInput
): AppleRemoteNativeCursorSource {
  return {
    type: "native",
    eventKey: input.eventKey,
    usagePage: input.usagePage,
    usage: input.usage,
    cookie: input.cookie,
    reportId: input.reportId,
    logicalMin: input.logicalMin,
    logicalMax: input.logicalMax,
    isRelative: input.isRelative,
  };
}

function scoreNativeCursorSamples(
  samples: NativeCursorSample[]
): CursorCandidate[] {
  const samplesByEvent = new Map<string, NativeCursorSample[]>();

  samples.forEach((sample) => {
    const eventSamples = samplesByEvent.get(sample.eventKey) ?? [];
    eventSamples.push(sample);
    samplesByEvent.set(sample.eventKey, eventSamples);
  });

  const candidates: CursorCandidate[] = [];

  samplesByEvent.forEach((eventSamples) => {
    if (eventSamples.length < 3) {
      return;
    }

    let score = 0;
    for (let index = 1; index < eventSamples.length; index += 1) {
      score += Math.abs(eventSamples[index].value - eventSamples[index - 1].value);
    }

    if (score > 0) {
      candidates.push({
        reportId: eventSamples[0].source.reportId,
        source: eventSamples[0].source,
        score,
      });
    }
  });

  return candidates.sort((first, second) => second.score - first.score);
}

function learnNativeCursorMappingFromSamples(
  samples: NativeCursorSample[]
): AppleRemoteCursorMapping | null {
  const candidates = scoreNativeCursorSamples(samples);

  for (const xCandidate of candidates) {
    const yCandidate = candidates.find(
      (candidate) =>
        candidate !== xCandidate && !sourcesOverlap(candidate.source, xCandidate.source)
    );

    if (yCandidate) {
      return {
        reportId: xCandidate.reportId,
        xSource: xCandidate.source,
        ySource: yCandidate.source,
        mode: "absolute-delta",
        sensitivity: DEFAULT_MOUSE_SENSITIVITY,
        touchpadContactSensitivity: DEFAULT_TOUCHPAD_CONTACT_SENSITIVITY,
        invertX: DEFAULT_MOUSE_INVERT_X,
        invertY: DEFAULT_MOUSE_INVERT_Y,
        rotation: DEFAULT_MOUSE_ROTATION,
      };
    }
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function transformCursorDelta(
  rawX: number,
  rawY: number,
  rotation: PointerRotation,
  invertX: boolean,
  invertY: boolean
): { x: number; y: number } {
  let x = rawX;
  let y = rawY;

  switch (normalizePointerRotation(rotation)) {
    case 90:
      x = -rawY;
      y = rawX;
      break;
    case 180:
      x = -rawX;
      y = -rawY;
      break;
    case 270:
      x = rawY;
      y = -rawX;
      break;
  }

  if (invertX) x = -x;
  if (invertY) y = -y;

  return { x, y };
}

function getTouchpadContactThreshold(contactSensitivity: number): number {
  const normalizedSensitivity =
    normalizeTouchpadContactSensitivity(contactSensitivity);
  return 0.8 - normalizedSensitivity * 0.7;
}

function isActiveTouchpadState(
  input: AppleRemoteTouchpadInput,
  contactSensitivity: number
): boolean {
  if (input.state <= 0) {
    return false;
  }

  return input.size >= getTouchpadContactThreshold(contactSensitivity);
}

function resolveTouchpadDeviceId(
  input: AppleRemoteTouchpadInput,
  devices: AppleRemoteDeviceState[],
  mappings: AppleRemoteMapping[]
): string | null {
  if (
    input.deviceId &&
    devices.some((device) => device.id === input.deviceId)
  ) {
    return input.deviceId;
  }

  const mappedSilverRemote = devices.find(
    (device) =>
      supportsTouchpadCursor(device) &&
      mappings.some((mapping) => mapping.deviceId === device.id)
  );

  if (mappedSilverRemote) {
    return mappedSilverRemote.id;
  }

  return devices.find(supportsTouchpadCursor)?.id ?? null;
}

function calculateTouchpadCursorDelta(
  mapping: AppleRemoteCursorMapping,
  input: AppleRemoteTouchpadInput,
  previousState: TouchpadCursorState
): { x: number; y: number } | null {
  const deltaX = input.x - previousState.x;
  const deltaY = input.y - previousState.y;

  if (
    Math.abs(deltaX) < TOUCHPAD_MIN_DELTA &&
    Math.abs(deltaY) < TOUCHPAD_MIN_DELTA
  ) {
    return null;
  }

  if (
    Math.abs(deltaX) > TOUCHPAD_MAX_DELTA ||
    Math.abs(deltaY) > TOUCHPAD_MAX_DELTA
  ) {
    return null;
  }

  const transformed = transformCursorDelta(
    deltaX,
    -deltaY,
    mapping.rotation,
    mapping.invertX,
    mapping.invertY
  );

  const scale = mapping.sensitivity * TOUCHPAD_CURSOR_BASE_SPEED;

  return {
    x: clamp(transformed.x * scale, -80, 80),
    y: clamp(transformed.y * scale, -80, 80),
  };
}

export function useAppleRemote(
  specialActions: AppleRemoteSpecialActionHandlers = {}
) {
  const [devices, setDevices] = useState<AppleRemoteDeviceState[]>([]);
  const [mappings, setMappings] = useState<AppleRemoteMapping[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [learningButtonDeviceId, setLearningButtonDeviceId] = useState<
    string | null
  >(null);
  const [pendingButtonControl, setPendingButtonControl] =
    useState<AppleRemoteButtonControlUnion | null>(null);
  const [learningCursorDeviceId, setLearningCursorDeviceId] = useState<
    string | null
  >(null);
  const [learningCursorMode, setLearningCursorMode] =
    useState<AppleRemoteCursorLearningMode>("auto");
  const [pendingCursorMapping, setPendingCursorMapping] =
    useState<AppleRemoteCursorMapping | null>(null);
  const [cursorSampleCount, setCursorSampleCount] = useState(0);
  const [activeButtonStates, setActiveButtonStates] = useState<
    Record<string, AppleRemoteActiveButtonState>
  >({});
  const [touchpadVisualState, setTouchpadVisualState] =
    useState<AppleRemoteTouchpadVisualState | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(
    () => localStorage.getItem(REMOTE_SESSION_ACTIVE_KEY) !== "false"
  );

  const deviceRefs = useRef<Map<string, HIDDevice>>(new Map());
  const isSessionActiveRef = useRef(isSessionActive);
  const reportHandlersRef = useRef<
    Map<string, (event: HIDInputReportEvent) => void>
  >(new Map());
  const previousReportsRef = useRef<Map<string, number[]>>(new Map());
  const devicesRef = useRef<AppleRemoteDeviceState[]>([]);
  const mappingsRef = useRef<AppleRemoteMapping[]>([]);
  const learningButtonDeviceIdRef = useRef<string | null>(null);
  const learningCursorDeviceIdRef = useRef<string | null>(null);
  const learningCursorModeRef =
    useRef<AppleRemoteCursorLearningMode>("auto");
  const cursorSamplesRef = useRef<CursorSample[]>([]);
  const nativeCursorSamplesRef = useRef<NativeCursorSample[]>([]);
  const clickpadDirectionStatesRef = useRef<Map<string, boolean>>(new Map());
  const directionNudgeRepeatTimersRef = useRef<
    Map<string, DirectionNudgeRepeatState>
  >(new Map());
  const touchpadCursorStateRef = useRef<TouchpadCursorState | null>(null);
  const touchpadVisualReleaseTimerRef = useRef<number | null>(null);
  const touchpadRingReleaseTimerRef = useRef<number | null>(null);
  const touchpadPressLockKeysRef = useRef<Map<string, number>>(new Map());
  const buttonHoldStatesRef = useRef<Map<string, ButtonHoldState>>(new Map());
  const visualHoldTimersRef = useRef<Map<string, number>>(new Map());
  const visualReleaseTimersRef = useRef<Map<string, number>>(new Map());
  const visualActiveSinceRef = useRef<Map<string, number>>(new Map());
  const keyHoldersRef = useRef<Map<string, Set<string>>>(new Map());
  const keyRepeatTimersRef = useRef<Map<string, KeyRepeatState>>(new Map());
  const previousButtonStatesRef = useRef<Map<string, boolean>>(new Map());
  const pendingMouseMovementsRef = useRef<Map<string, PendingMouseMovement>>(
    new Map()
  );
  const pendingTouchpadScrollsRef = useRef<Map<string, PendingTouchpadScroll>>(
    new Map()
  );
  const nativeSelectorValuesRef = useRef<Map<string, number>>(new Map());
  const onTogglePointerAssistRef = useRef<
    AppleRemoteSpecialActionHandlers["onTogglePointerAssist"]
  >(specialActions.onTogglePointerAssist);

  const isSupported =
    typeof window !== "undefined" &&
    (window.ipcRenderer !== undefined || navigator.hid !== undefined);

  useEffect(() => {
    return () => {
      directionNudgeRepeatTimersRef.current.forEach((repeatState) => {
        if (repeatState.timeoutId !== null) {
          window.clearTimeout(repeatState.timeoutId);
        }
      });
      directionNudgeRepeatTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    mappingsRef.current = mappings;
  }, [mappings]);

  useEffect(() => {
    isSessionActiveRef.current = isSessionActive;
    localStorage.setItem(
      REMOTE_SESSION_ACTIVE_KEY,
      isSessionActive ? "true" : "false"
    );
  }, [isSessionActive]);

  useEffect(() => {
    onTogglePointerAssistRef.current = specialActions.onTogglePointerAssist;
  }, [specialActions.onTogglePointerAssist]);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    learningButtonDeviceIdRef.current = learningButtonDeviceId;
  }, [learningButtonDeviceId]);

  useEffect(() => {
    learningCursorDeviceIdRef.current = learningCursorDeviceId;
  }, [learningCursorDeviceId]);

  useEffect(() => {
    learningCursorModeRef.current = learningCursorMode;
  }, [learningCursorMode]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      setMappings(normalizeStoredMappings(JSON.parse(saved)));
    } catch (error) {
      console.error("Failed to load Apple Remote mappings:", error);
    }
  }, []);

  useEffect(() => {
    if (mappings.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
  }, [mappings]);

  useEffect(() => {
    return () => {
      buttonHoldStatesRef.current.forEach((state) => {
        if (state.timerId !== null) {
          window.clearTimeout(state.timerId);
        }
      });
      buttonHoldStatesRef.current.clear();
      if (touchpadVisualReleaseTimerRef.current !== null) {
        window.clearTimeout(touchpadVisualReleaseTimerRef.current);
        touchpadVisualReleaseTimerRef.current = null;
      }
      if (touchpadRingReleaseTimerRef.current !== null) {
        window.clearTimeout(touchpadRingReleaseTimerRef.current);
        touchpadRingReleaseTimerRef.current = null;
      }
      visualHoldTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      visualHoldTimersRef.current.clear();
      visualReleaseTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      visualReleaseTimersRef.current.clear();
      visualActiveSinceRef.current.clear();
      keyRepeatTimersRef.current.forEach((state) => {
        if (state.timeoutId !== null) {
          window.clearTimeout(state.timeoutId);
        }
        if (state.intervalId !== null) {
          window.clearInterval(state.intervalId);
        }
      });
      keyRepeatTimersRef.current.clear();
      touchpadPressLockKeysRef.current.clear();
      pendingMouseMovementsRef.current.clear();
      pendingTouchpadScrollsRef.current.clear();
    };
  }, []);

  const simulateKeyPress = useCallback(
    async (
      key: string,
      pressed: boolean,
      stateKey: string,
      outputMode: AppleRemoteButtonOutputMode = "hold"
    ) => {
      const previousState = previousButtonStatesRef.current.get(stateKey);
      if (previousState === pressed) {
        return;
      }

      previousButtonStatesRef.current.set(stateKey, pressed);

      if (isAppleRemoteSpecialActionKey(key)) {
        if (pressed && key === APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY) {
          onTogglePointerAssistRef.current?.();
        }
        return;
      }

      const holderKey = `${outputMode}:${key}`;

      if (!keyHoldersRef.current.has(holderKey)) {
        keyHoldersRef.current.set(holderKey, new Set());
      }

      const holders = keyHoldersRef.current.get(holderKey)!;
      const wasPressed = holders.size > 0;

      if (pressed) {
        holders.add(stateKey);

        if (wasPressed) {
          return;
        }

        try {
          let result: { success: boolean; error?: string } | undefined;
          if (key.startsWith("Mouse")) {
            result = await window.mouseSimulator?.buttonToggle(key, true);
          } else if (outputMode === "hold-modifiers") {
            result = await window.keySimulator.keyShortcutHoldToggle(key, true);
          } else {
            result = await window.keySimulator.keyToggle(key, true);
          }

          if (result && !result.success) {
            setConnectionError(result.error ?? "Input simulation failed.");
            holders.delete(stateKey);
            previousButtonStatesRef.current.delete(stateKey);
          }
        } catch (error) {
          console.error("Error pressing Apple Remote mapping:", error);
          setConnectionError(String(error));
          holders.delete(stateKey);
          previousButtonStatesRef.current.delete(stateKey);
        }

        return;
      }

      holders.delete(stateKey);

      if (!wasPressed || holders.size > 0) {
        return;
      }

      try {
        let result: { success: boolean; error?: string } | undefined;
        if (key.startsWith("Mouse")) {
          result = await window.mouseSimulator?.buttonToggle(key, false);
        } else if (outputMode === "hold-modifiers") {
          result = await window.keySimulator.keyShortcutHoldToggle(key, false);
        } else {
          result = await window.keySimulator.keyToggle(key, false);
        }

        if (result && !result.success) {
          setConnectionError(result.error ?? "Input simulation failed.");
        }
      } catch (error) {
        console.error("Error releasing Apple Remote mapping:", error);
        setConnectionError(String(error));
      }
    },
    []
  );

  const simulateKeyTap = useCallback(
    async (key: string, stateKey: string) => {
      previousButtonStatesRef.current.delete(stateKey);
      keyHoldersRef.current.get(`hold:${key}`)?.delete(stateKey);
      keyHoldersRef.current.get(`hold-modifiers:${key}`)?.delete(stateKey);

      if (isAppleRemoteSpecialActionKey(key)) {
        if (key === APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY) {
          onTogglePointerAssistRef.current?.();
        }
        return;
      }

      try {
        let result: { success: boolean; error?: string } | undefined;
        if (key.startsWith("Mouse")) {
          result = await window.mouseSimulator?.buttonToggle(key, true);
          if (result && !result.success) {
            setConnectionError(result.error ?? "Input simulation failed.");
            return;
          }

          await delay(REMOTE_TAP_MOUSE_DURATION_MS);
          result = await window.mouseSimulator?.buttonToggle(key, false);
        } else {
          result = await window.keySimulator.keyTap(key);
        }

        if (result && !result.success) {
          setConnectionError(result.error ?? "Input simulation failed.");
        }
      } catch (error) {
        console.error("Error tapping Apple Remote mapping:", error);
        setConnectionError(String(error));
      }
    },
    []
  );

  const stopKeyAutoRepeat = useCallback((stateKey: string) => {
    const repeatState = keyRepeatTimersRef.current.get(stateKey);
    if (!repeatState) {
      return;
    }

    if (repeatState.timeoutId !== null) {
      window.clearTimeout(repeatState.timeoutId);
    }
    if (repeatState.intervalId !== null) {
      window.clearInterval(repeatState.intervalId);
    }

    keyRepeatTimersRef.current.delete(stateKey);
  }, []);

  const startKeyAutoRepeat = useCallback(
    (key: string, stateKey: string, initialDelay: number) => {
      if (key !== "Backspace" || keyRepeatTimersRef.current.has(stateKey)) {
        return;
      }

      const repeatState: KeyRepeatState = {
        timeoutId: null,
        intervalId: null,
        inFlight: false,
      };

      const sendRepeat = async () => {
        if (repeatState.inFlight) {
          return;
        }

        repeatState.inFlight = true;
        try {
          let result = await window.keySimulator.keyToggle(key, true);
          if (result && !result.success) {
            setConnectionError(result.error ?? "Input simulation failed.");
            stopKeyAutoRepeat(stateKey);
            return;
          }

          await delay(BACKSPACE_REPEAT_TAP_DURATION_MS);
          result = await window.keySimulator.keyToggle(key, false);
          if (result && !result.success) {
            setConnectionError(result.error ?? "Input simulation failed.");
            stopKeyAutoRepeat(stateKey);
          }
        } catch (error) {
          console.error("Error repeating Apple Remote mapping:", error);
          setConnectionError(String(error));
          stopKeyAutoRepeat(stateKey);
        } finally {
          repeatState.inFlight = false;
        }
      };

      repeatState.timeoutId = window.setTimeout(() => {
        repeatState.timeoutId = null;
        void sendRepeat();
        repeatState.intervalId = window.setInterval(
          () => void sendRepeat(),
          BACKSPACE_REPEAT_INTERVAL_MS
        );
      }, initialDelay);

      keyRepeatTimersRef.current.set(stateKey, repeatState);
    },
    [stopKeyAutoRepeat]
  );

  const stopKeyAutoRepeatsForPrefix = useCallback(
    (prefix: string) => {
      Array.from(keyRepeatTimersRef.current.keys())
        .filter((stateKey) => stateKey.startsWith(prefix))
        .forEach(stopKeyAutoRepeat);
    },
    [stopKeyAutoRepeat]
  );

  const processButtonMappingGroup = useCallback(
    (deviceId: string, group: ButtonMappingGroup) => {
      const pressMappings = group.mappings.filter(
        (buttonMapping) => buttonMapping.trigger === "press"
      );
      const holdMappings = group.mappings.filter(
        (buttonMapping) => buttonMapping.trigger === "hold"
      );
      const pressHoldMappings = pressMappings.filter(
        (buttonMapping) => buttonMappingHoldsOutput(buttonMapping)
      );
      const pressTapMappings = pressMappings.filter(
        (buttonMapping) => !buttonMappingHoldsOutput(buttonMapping)
      );
      const groupStateKey = `apple-remote-${deviceId}-button-${group.physicalKey}`;

      if (holdMappings.length === 0) {
        const existingState = buttonHoldStatesRef.current.get(groupStateKey);

        if (group.active) {
          if (existingState?.active) {
            return;
          }

          const timerId =
            pressHoldMappings.length === 0
              ? window.setTimeout(() => {
                  buttonHoldStatesRef.current.delete(groupStateKey);
                }, BUTTON_PRESS_RESET_MS)
              : null;

          buttonHoldStatesRef.current.set(groupStateKey, {
            active: true,
            holdTriggered: false,
            timerId,
          });

          pressTapMappings.forEach((buttonMapping) => {
            const mappingStateKey = `${groupStateKey}-${buttonMapping.controlKey}`;
            simulateKeyTap(
              buttonMapping.key,
              mappingStateKey
            );
            startKeyAutoRepeat(
              buttonMapping.key,
              mappingStateKey,
              BACKSPACE_REPEAT_INITIAL_DELAY_MS
            );
          });
          pressHoldMappings.forEach((buttonMapping) => {
            simulateKeyPress(
              buttonMapping.key,
              true,
              `${groupStateKey}-${buttonMapping.controlKey}`,
              buttonMapping.outputMode
            );
          });
          return;
        }

        if (existingState?.timerId != null) {
          window.clearTimeout(existingState.timerId);
        }

        if (existingState?.active) {
          stopKeyAutoRepeatsForPrefix(groupStateKey);
          pressHoldMappings.forEach((buttonMapping) => {
            simulateKeyPress(
              buttonMapping.key,
              false,
              `${groupStateKey}-${buttonMapping.controlKey}`,
              buttonMapping.outputMode
            );
          });
        }

        buttonHoldStatesRef.current.delete(groupStateKey);
        stopKeyAutoRepeatsForPrefix(groupStateKey);
        return;
      }

      const existingState = buttonHoldStatesRef.current.get(groupStateKey) ?? {
        active: false,
        holdTriggered: false,
        timerId: null,
      };

      if (group.active) {
        if (existingState.active) {
          return;
        }

        const state: ButtonHoldState = {
          active: true,
          holdTriggered: false,
          timerId: null,
        };

        state.timerId = window.setTimeout(() => {
          const latestState = buttonHoldStatesRef.current.get(groupStateKey);
          if (!latestState?.active || latestState.holdTriggered) {
            return;
          }

          latestState.holdTriggered = true;
          holdMappings.forEach((buttonMapping) => {
            const mappingStateKey = `${groupStateKey}-${buttonMapping.controlKey}`;
            if (buttonMappingHoldsOutput(buttonMapping)) {
              simulateKeyPress(
                buttonMapping.key,
                true,
                mappingStateKey,
                buttonMapping.outputMode
              );
            } else {
              simulateKeyTap(
                buttonMapping.key,
                mappingStateKey
              );
              startKeyAutoRepeat(
                buttonMapping.key,
                mappingStateKey,
                BACKSPACE_REPEAT_INTERVAL_MS
              );
            }
          });
        }, BUTTON_HOLD_THRESHOLD_MS);

        buttonHoldStatesRef.current.set(groupStateKey, state);
        return;
      }

      if (existingState.timerId !== null) {
        window.clearTimeout(existingState.timerId);
      }

      if (existingState.active && existingState.holdTriggered) {
        stopKeyAutoRepeatsForPrefix(groupStateKey);
        holdMappings
          .filter((buttonMapping) => buttonMappingHoldsOutput(buttonMapping))
          .forEach((buttonMapping) => {
          simulateKeyPress(
            buttonMapping.key,
            false,
            `${groupStateKey}-${buttonMapping.controlKey}`,
            buttonMapping.outputMode
          );
        });
      } else if (existingState.active) {
        stopKeyAutoRepeatsForPrefix(groupStateKey);
        pressTapMappings.forEach((buttonMapping) => {
          simulateKeyTap(
            buttonMapping.key,
            `${groupStateKey}-${buttonMapping.controlKey}`
          );
        });
      }

      buttonHoldStatesRef.current.delete(groupStateKey);
      stopKeyAutoRepeatsForPrefix(groupStateKey);
    },
    [
      simulateKeyPress,
      simulateKeyTap,
      startKeyAutoRepeat,
      stopKeyAutoRepeatsForPrefix,
    ]
  );

  const updateNativeButtonVisualState = useCallback(
    (input: AppleRemoteNativeInput) => {
      const visualKey = getAppleRemoteNativeVisualControlKey(
        input.usagePage,
        input.usage
      );
      const existingHoldTimerId = visualHoldTimersRef.current.get(visualKey);
      const existingReleaseTimerId =
        visualReleaseTimersRef.current.get(visualKey);
      const pressLockKey = `${input.deviceId}:${input.usagePage}:${input.usage}`;

      if (isTouchpadPressLockInput(input)) {
        if (input.value === 0) {
          touchpadPressLockKeysRef.current.delete(pressLockKey);
        } else {
          touchpadPressLockKeysRef.current.set(pressLockKey, Date.now());
          if (touchpadRingReleaseTimerRef.current !== null) {
            window.clearTimeout(touchpadRingReleaseTimerRef.current);
            touchpadRingReleaseTimerRef.current = null;
          }
          touchpadCursorStateRef.current = null;
        }
      }

      if (input.value === 0) {
        if (existingHoldTimerId !== undefined) {
          window.clearTimeout(existingHoldTimerId);
          visualHoldTimersRef.current.delete(visualKey);
        }

        const activeSince = visualActiveSinceRef.current.get(visualKey);
        const elapsed = activeSince ? Date.now() - activeSince : BUTTON_VISUAL_FLASH_MS;
        const remainingDelay = Math.max(0, BUTTON_VISUAL_FLASH_MS - elapsed);

        const clearVisualState = () => {
          visualReleaseTimersRef.current.delete(visualKey);
          visualActiveSinceRef.current.delete(visualKey);
          setActiveButtonStates((currentStates) => {
            if (!currentStates[visualKey]) {
              return currentStates;
            }

            const nextStates = { ...currentStates };
            delete nextStates[visualKey];
            return nextStates;
          });
        };

        if (remainingDelay === 0) {
          clearVisualState();
        } else if (existingReleaseTimerId === undefined) {
          visualReleaseTimersRef.current.set(
            visualKey,
            window.setTimeout(clearVisualState, remainingDelay)
          );
        }
        return;
      }

      if (existingReleaseTimerId !== undefined) {
        window.clearTimeout(existingReleaseTimerId);
        visualReleaseTimersRef.current.delete(visualKey);
      }

      visualActiveSinceRef.current.set(visualKey, Date.now());
      setActiveButtonStates((currentStates) => ({
        ...currentStates,
        [visualKey]: {
          usagePage: input.usagePage,
          usage: input.usage,
          trigger: "press",
        },
      }));

      if (existingHoldTimerId !== undefined) {
        return;
      }

      const timerId = window.setTimeout(() => {
        visualHoldTimersRef.current.delete(visualKey);
        setActiveButtonStates((currentStates) => {
          if (!currentStates[visualKey]) {
            return currentStates;
          }

          return {
            ...currentStates,
            [visualKey]: {
              ...currentStates[visualKey],
              trigger: "hold",
            },
          };
        });
      }, BUTTON_HOLD_THRESHOLD_MS);

      visualHoldTimersRef.current.set(visualKey, timerId);
    },
    []
  );

  const moveMouse = useCallback(
    (deviceId: string, deltaX: number, deltaY: number) => {
      const mouseSimulator = window.mouseSimulator;
      if (!mouseSimulator) {
        return;
      }

      if (Math.abs(deltaX) < 0.2 && Math.abs(deltaY) < 0.2) {
        return;
      }

      const stateKey = `apple-remote-${deviceId}-cursor`;
      const queuedMovement = pendingMouseMovementsRef.current.get(stateKey);
      if (queuedMovement) {
        queuedMovement.deltaX = clamp(queuedMovement.deltaX + deltaX, -160, 160);
        queuedMovement.deltaY = clamp(queuedMovement.deltaY + deltaY, -160, 160);
        return;
      }

      const sendMovement = (nextDeltaX: number, nextDeltaY: number) => {
        pendingMouseMovementsRef.current.set(stateKey, {
          deltaX: 0,
          deltaY: 0,
        });

        mouseSimulator
          .moveMouse(nextDeltaX, nextDeltaY)
          .catch((error) => {
            console.error("Error moving mouse from Apple Remote:", error);
          })
          .finally(() => {
            const nextQueuedMovement =
              pendingMouseMovementsRef.current.get(stateKey);

            if (!nextQueuedMovement) {
              return;
            }

            if (
              Math.abs(nextQueuedMovement.deltaX) < 0.2 &&
              Math.abs(nextQueuedMovement.deltaY) < 0.2
            ) {
              pendingMouseMovementsRef.current.delete(stateKey);
              return;
            }

            const queuedDeltaX = nextQueuedMovement.deltaX;
            const queuedDeltaY = nextQueuedMovement.deltaY;
            nextQueuedMovement.deltaX = 0;
            nextQueuedMovement.deltaY = 0;
            sendMovement(queuedDeltaX, queuedDeltaY);
          });
      };

      sendMovement(deltaX, deltaY);
    },
    []
  );

  const scrollTouchpad = useCallback((deviceId: string, deltaY: number) => {
    const scrollPixels = window.mouseSimulator?.scrollPixels;
    if (!scrollPixels || Math.abs(deltaY) < 0.5) {
      return;
    }

    const stateKey = `apple-remote-${deviceId}-ring-scroll`;
    const queuedScroll = pendingTouchpadScrollsRef.current.get(stateKey);
    if (queuedScroll) {
      queuedScroll.deltaY = clamp(queuedScroll.deltaY + deltaY, -240, 240);
      return;
    }

    const sendScroll = (nextDeltaY: number) => {
      pendingTouchpadScrollsRef.current.set(stateKey, { deltaY: 0 });
      scrollPixels(nextDeltaY)
        .catch((error) => {
          console.error("Error scrolling from Apple Remote clickpad:", error);
        })
        .finally(() => {
          const nextQueuedScroll = pendingTouchpadScrollsRef.current.get(stateKey);
          if (!nextQueuedScroll) {
            return;
          }

          if (Math.abs(nextQueuedScroll.deltaY) < 0.5) {
            pendingTouchpadScrollsRef.current.delete(stateKey);
            return;
          }

          const queuedDeltaY = nextQueuedScroll.deltaY;
          nextQueuedScroll.deltaY = 0;
          sendScroll(queuedDeltaY);
        });
    };

    sendScroll(deltaY);
  }, []);

  const handleInputReport = useCallback(
    (deviceId: string, event: HIDInputReportEvent) => {
      const bytes = bytesFromDataView(event.data);
      const reportKey = getReportKey(deviceId, event.reportId);
      const previousBytes = previousReportsRef.current.get(reportKey);

      if (learningButtonDeviceIdRef.current === deviceId) {
        const control = detectButtonControl(
          event.reportId,
          bytes,
          previousBytes
        );

        if (control) {
          setPendingButtonControl(control);
          setLearningButtonDeviceId(null);
        }
      }

      if (learningCursorDeviceIdRef.current === deviceId) {
        cursorSamplesRef.current.push({
          deviceId,
          reportId: event.reportId,
          bytes,
        });

        if (cursorSamplesRef.current.length > MAX_CURSOR_SAMPLE_COUNT) {
          cursorSamplesRef.current.shift();
        }

        setCursorSampleCount(cursorSamplesRef.current.length);
      }

      const mapping = mappingsRef.current.find((item) => item.deviceId === deviceId);

      if (mapping) {
        const buttonGroups = new Map<string, ButtonMappingGroup>();

        mapping.buttonMappings.forEach((buttonMapping) => {
          if (buttonMapping.control.type !== "byte-value") {
            return;
          }

          addButtonMappingGroup(
            buttonGroups,
            buttonMapping,
            controlIsActive(buttonMapping.control, event.reportId, bytes)
          );
        });

        buttonGroups.forEach((group) => {
          processButtonMappingGroup(deviceId, group);
        });

      }

      previousReportsRef.current.set(reportKey, bytes);
    },
    [processButtonMappingGroup]
  );

  const handleNativeRawInput = useCallback(
    (input: AppleRemoteNativeRawInput) => {
      const reportKey = getReportKey(input.deviceId, input.reportId);

      if (learningCursorDeviceIdRef.current === input.deviceId) {
        cursorSamplesRef.current.push({
          deviceId: input.deviceId,
          reportId: input.reportId,
          bytes: input.bytes,
        });

        if (cursorSamplesRef.current.length > MAX_CURSOR_SAMPLE_COUNT) {
          cursorSamplesRef.current.shift();
        }

        setCursorSampleCount(cursorSamplesRef.current.length);
      }

      previousReportsRef.current.set(reportKey, input.bytes);
    },
    []
  );

  const clearTouchpadVisual = useCallback((deviceId?: string) => {
    if (touchpadVisualReleaseTimerRef.current !== null) {
      window.clearTimeout(touchpadVisualReleaseTimerRef.current);
      touchpadVisualReleaseTimerRef.current = null;
    }

    touchpadVisualReleaseTimerRef.current = window.setTimeout(() => {
      touchpadVisualReleaseTimerRef.current = null;
      setTouchpadVisualState((currentState) => {
        if (!currentState || (deviceId && currentState.deviceId !== deviceId)) {
          return currentState;
        }

        return null;
      });
    }, TOUCHPAD_VISUAL_RELEASE_MS);
  }, []);

  const updateTouchpadVisual = useCallback(
    (
      deviceId: string,
      input: AppleRemoteTouchpadInput,
      gestureZone: ClickpadGestureZone
    ) => {
      if (touchpadVisualReleaseTimerRef.current !== null) {
        window.clearTimeout(touchpadVisualReleaseTimerRef.current);
        touchpadVisualReleaseTimerRef.current = null;
      }

      setTouchpadVisualState({
        deviceId,
        x: clamp(input.x, 0, 1),
        y: clamp(input.y, 0, 1),
        size: clamp(input.size, 0, 1),
        active: true,
        gestureZone,
      });
    },
    []
  );

  const stopDirectionNudgeRepeat = useCallback((stateKey: string) => {
    const repeatState = directionNudgeRepeatTimersRef.current.get(stateKey);
    if (!repeatState) {
      return;
    }

    if (repeatState.timeoutId !== null) {
      window.clearTimeout(repeatState.timeoutId);
    }

    directionNudgeRepeatTimersRef.current.delete(stateKey);
  }, []);

  const stopDirectionNudgeRepeatsForDevice = useCallback(
    (deviceId: string) => {
      Array.from(directionNudgeRepeatTimersRef.current.keys())
        .filter((stateKey) => stateKey.startsWith(`${deviceId}:`))
        .forEach(stopDirectionNudgeRepeat);
    },
    [stopDirectionNudgeRepeat]
  );

  const sendDirectionNudge = useCallback(
    async (
      direction: AppleRemoteClickpadDirection,
      repeatState?: DirectionNudgeRepeatState
    ) => {
      if (repeatState?.inFlight) {
        return;
      }

      if (repeatState) {
        repeatState.inFlight = true;
      }

      try {
        const heldMs = repeatState ? Date.now() - repeatState.startedAt : 0;
        const repeatIndex = repeatState?.repeatIndex ?? 0;
        const result = await window.mouseSimulator?.pointerAssistNudge?.(
          direction,
          {
            heldMs,
            repeatIndex,
            phase: repeatIndex === 0 ? "press" : "repeat",
          }
        );

        if (result && !result.success) {
          setConnectionError(result.error ?? "Pointer assist nudge failed.");
        }
      } catch (error) {
        console.error("Error nudging pointer assist target:", error);
        setConnectionError(String(error));
      } finally {
        if (repeatState) {
          repeatState.inFlight = false;
        }
      }
    },
    []
  );

  const startDirectionNudgeRepeat = useCallback(
    (stateKey: string, direction: AppleRemoteClickpadDirection) => {
      if (directionNudgeRepeatTimersRef.current.has(stateKey)) {
        return;
      }

      const repeatState: DirectionNudgeRepeatState = {
        direction,
        timeoutId: null,
        inFlight: false,
        startedAt: Date.now(),
        repeatIndex: 0,
      };

      const scheduleNextRepeat = (delayMs: number) => {
        repeatState.timeoutId = window.setTimeout(() => {
          const activeState = directionNudgeRepeatTimersRef.current.get(stateKey);
          if (activeState !== repeatState) {
            return;
          }

          repeatState.timeoutId = null;
          repeatState.repeatIndex += 1;
          void sendDirectionNudge(direction, repeatState);

          const heldMs = Date.now() - repeatState.startedAt;
          scheduleNextRepeat(
            getDirectionNudgeRepeatInterval(heldMs, repeatState.repeatIndex)
          );
        }, delayMs);
      };

      directionNudgeRepeatTimersRef.current.set(stateKey, repeatState);
      void sendDirectionNudge(direction, repeatState);
      scheduleNextRepeat(DIRECTION_NUDGE_REPEAT_INITIAL_DELAY_MS);
    },
    [sendDirectionNudge]
  );

  const handleTouchpadInput = useCallback(
    (input: AppleRemoteTouchpadInput) => {
      const deviceId = resolveTouchpadDeviceId(
        input,
        devicesRef.current,
        mappingsRef.current
      );

      if (!deviceId) {
        if (touchpadRingReleaseTimerRef.current !== null) {
          window.clearTimeout(touchpadRingReleaseTimerRef.current);
          touchpadRingReleaseTimerRef.current = null;
        }
        touchpadCursorStateRef.current = null;
        clearTouchpadVisual();
        return;
      }

      const mapping = mappingsRef.current.find(
        (item) => item.deviceId === deviceId
      );
      const cursorMapping =
        mapping?.cursorMapping ?? createDefaultTouchpadCursorMapping();
      const currentState = touchpadCursorStateRef.current;
      const continuesLockedRingContact = Boolean(
        currentState?.deviceId === deviceId &&
          currentState.touchId === input.touchId &&
          currentState.ringScrollLocked &&
          isTrackableClickpadContact(
            input.state,
            input.x,
            input.y,
            input.size
          )
      );

      if (
        !isActiveTouchpadState(
          input,
          cursorMapping.touchpadContactSensitivity
        ) &&
        !continuesLockedRingContact
      ) {
        clearTouchpadVisual(deviceId);
        if (
          currentState?.deviceId === deviceId &&
          currentState.ringScrollLocked
        ) {
          if (touchpadRingReleaseTimerRef.current === null) {
            const heldState = currentState;
            touchpadRingReleaseTimerRef.current = window.setTimeout(() => {
              touchpadRingReleaseTimerRef.current = null;
              if (touchpadCursorStateRef.current !== heldState) {
                return;
              }

              void window.mouseSimulator?.endPointerAssistGesture?.();
              touchpadCursorStateRef.current = null;
            }, TOUCHPAD_RING_RELEASE_GRACE_MS);
          }
          return;
        }

        if (
          currentState?.deviceId === deviceId &&
          currentState.touchId === input.touchId
        ) {
          void window.mouseSimulator?.endPointerAssistGesture?.();
          touchpadCursorStateRef.current = null;
        }
        return;
      }

      const previousState = touchpadCursorStateRef.current;
      const isResumingLockedScroll = Boolean(
        touchpadRingReleaseTimerRef.current !== null &&
          previousState?.deviceId === deviceId &&
          previousState.ringScrollLocked
      );
      if (touchpadRingReleaseTimerRef.current !== null) {
        window.clearTimeout(touchpadRingReleaseTimerRef.current);
        touchpadRingReleaseTimerRef.current = null;
      }
      const isSameTouch =
        previousState?.deviceId === deviceId &&
        previousState.touchId === input.touchId;
      const continuesGesture = isSameTouch || isResumingLockedScroll;
      const gestureZone = getClickpadGestureZone(
        input.x,
        input.y,
        continuesGesture ? previousState?.gestureZone : undefined,
        continuesGesture ? previousState?.ringScrollLocked : false
      );
      updateTouchpadVisual(deviceId, input, gestureZone);

      const touchpadMovementIsLocked = touchpadPressLockIsActive(
        touchpadPressLockKeysRef.current,
        deviceId
      );
      if (touchpadMovementIsLocked) {
        touchpadCursorStateRef.current = null;
        return;
      }

      const nextState: TouchpadCursorState = {
        deviceId,
        touchId: input.touchId,
        frame: input.frame,
        x: input.x,
        y: input.y,
        gestureZone,
        ringAngleRemainder:
          continuesGesture && previousState
            ? previousState.ringAngleRemainder
            : 0,
        ringScrollLocked:
          continuesGesture && previousState
            ? previousState.ringScrollLocked
            : false,
      };

      if (isResumingLockedScroll && !isSameTouch) {
        touchpadCursorStateRef.current = nextState;
        return;
      }

      if (
        !previousState ||
        previousState.deviceId !== deviceId ||
        previousState.touchId !== input.touchId
      ) {
        touchpadCursorStateRef.current = nextState;
        return;
      }

      touchpadCursorStateRef.current = nextState;

      if (gestureZone !== previousState.gestureZone) {
        if (gestureZone === "ring") {
          void window.mouseSimulator?.endPointerAssistGesture?.();
        }
        return;
      }

      if (gestureZone === "ring") {
        const angleDelta = getClickpadClockwiseDeltaFromPoints(
          previousState.x,
          previousState.y,
          nextState.x,
          nextState.y
        );
        const scroll = accumulateClickpadRingScroll(
          previousState.ringAngleRemainder,
          angleDelta
        );
        nextState.ringAngleRemainder = scroll.angleRemainder;
        touchpadCursorStateRef.current = nextState;
        if (scroll.pixels !== 0) {
          nextState.ringScrollLocked = true;
          touchpadCursorStateRef.current = nextState;
          scrollTouchpad(deviceId, scroll.pixels);
        }
        return;
      }

      const delta = calculateTouchpadCursorDelta(
        cursorMapping,
        input,
        previousState
      );

      if (delta) {
        moveMouse(deviceId, delta.x, delta.y);
      }
    },
    [clearTouchpadVisual, moveMouse, scrollTouchpad, updateTouchpadVisual]
  );

  const nudgeClickpadDirection = useCallback(
    (input: AppleRemoteNativeInput) => {
      const direction = getClickpadDirectionInputDirection(input);
      const stateKey = getClickpadDirectionStateKey(input);
      const wasActive = clickpadDirectionStatesRef.current.get(stateKey) ?? false;
      const isActive = clickpadDirectionInputIsActive(input);
      clickpadDirectionStatesRef.current.set(stateKey, isActive);

      if (!direction) {
        return;
      }

      if (isActive && !wasActive) {
        startDirectionNudgeRepeat(stateKey, direction);
        return;
      }

      if (!isActive && wasActive) {
        stopDirectionNudgeRepeat(stateKey);
        const stopScroll = window.mouseSimulator?.pointerAssistNudge?.(
          direction,
          {
            heldMs: 0,
            repeatIndex: 0,
            phase: "release",
          }
        );
        if (stopScroll) {
          void stopScroll.catch((error) => {
            console.error("Error stopping pointer assist scroll:", error);
          });
        }
      }
    },
    [startDirectionNudgeRepeat, stopDirectionNudgeRepeat]
  );

  const handleNativeInput = useCallback(
    (input: AppleRemoteNativeInput) => {
      const buttonInput = resolveNativeButtonInput(
        input,
        nativeSelectorValuesRef.current
      );

      updateNativeButtonVisualState(buttonInput);

      if (
        learningButtonDeviceIdRef.current === buttonInput.deviceId &&
        buttonInput.value !== 0
      ) {
        setPendingButtonControl({
          type: "native-value",
          eventKey: buttonInput.eventKey,
          usagePage: buttonInput.usagePage,
          usage: buttonInput.usage,
          cookie: buttonInput.cookie,
          reportId: buttonInput.reportId,
          value: buttonInput.value,
        });
        setLearningButtonDeviceId(null);
      }

      if (learningCursorDeviceIdRef.current === input.deviceId) {
        nativeCursorSamplesRef.current.push({
          deviceId: input.deviceId,
          eventKey: input.eventKey,
          source: createNativeCursorSource(input),
          value: input.value,
        });

        if (nativeCursorSamplesRef.current.length > MAX_CURSOR_SAMPLE_COUNT) {
          nativeCursorSamplesRef.current.shift();
        }

        setCursorSampleCount(nativeCursorSamplesRef.current.length);
      }

      const mapping = mappingsRef.current.find(
        (item) => item.deviceId === input.deviceId
      );

      if (!mapping) {
        if (isClickpadDirectionInput(input)) {
          nudgeClickpadDirection(input);
        }
        return;
      }

      const buttonGroups = new Map<string, ButtonMappingGroup>();

      mapping.buttonMappings.forEach((buttonMapping) => {
        if (buttonMapping.control.type !== "native-value") {
          return;
        }

        const matchesResolvedInput = nativeButtonControlMatchesInput(
          buttonMapping.control,
          buttonInput
        );
        const matchesRawInput = nativeButtonControlMatchesInput(
          buttonMapping.control,
          input
        );

        if (!matchesResolvedInput && !matchesRawInput) {
          return;
        }

        addButtonMappingGroup(
          buttonGroups,
          buttonMapping,
          matchesResolvedInput
            ? nativeButtonControlIsActive(buttonMapping.control, buttonInput)
            : nativeButtonControlIsActive(buttonMapping.control, input)
        );
      });

      buttonGroups.forEach((group) => {
        processButtonMappingGroup(input.deviceId, group);
      });

      if (isClickpadDirectionInput(input)) {
        nudgeClickpadDirection(input);
        return;
      }
    },
    [nudgeClickpadDirection, processButtonMappingGroup, updateNativeButtonVisualState]
  );

  const handleNativeMessage = useCallback(
    (message: AppleRemoteNativeMessage) => {
      if (!isSessionActiveRef.current) {
        return;
      }

      if (message.type === "device-connected") {
        const deviceState = nativeDeviceToDeviceState(message.device);

        setDevices((previousDevices) => {
          const existingIndex = previousDevices.findIndex(
            (item) => item.id === deviceState.id
          );

          if (existingIndex === -1) {
            return [...previousDevices, deviceState];
          }

          return previousDevices.map((item, index) =>
            index === existingIndex ? deviceState : item
          );
        });
        setMappings((previousMappings) =>
          ensureDefaultTouchpadCursorMapping(previousMappings, deviceState)
        );
        return;
      }

      if (message.type === "device-disconnected") {
        setDevices((previousDevices) =>
          previousDevices.filter((device) => device.id !== message.deviceId)
        );
        clearClickpadDirectionStatesForDevice(
          clickpadDirectionStatesRef.current,
          message.deviceId
        );
        stopDirectionNudgeRepeatsForDevice(message.deviceId);
        setTouchpadVisualState((currentState) =>
          currentState?.deviceId === message.deviceId ? null : currentState
        );
        buttonHoldStatesRef.current.forEach((state) => {
          if (state.timerId !== null) {
            window.clearTimeout(state.timerId);
          }
        });
        buttonHoldStatesRef.current.clear();
        keyRepeatTimersRef.current.forEach((state) => {
          if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
          }
          if (state.intervalId !== null) {
            window.clearInterval(state.intervalId);
          }
        });
        keyRepeatTimersRef.current.clear();
        visualHoldTimersRef.current.forEach((timerId) => {
          window.clearTimeout(timerId);
        });
        visualHoldTimersRef.current.clear();
        visualReleaseTimersRef.current.forEach((timerId) => {
          window.clearTimeout(timerId);
        });
        visualReleaseTimersRef.current.clear();
        visualActiveSinceRef.current.clear();
        keyHoldersRef.current.clear();
        previousButtonStatesRef.current.clear();
        nativeSelectorValuesRef.current.clear();
        touchpadPressLockKeysRef.current.clear();
        setActiveButtonStates({});
        return;
      }

      if (message.type === "input") {
        handleNativeInput(message);
        return;
      }

      if (message.type === "raw-input") {
        handleNativeRawInput(message);
        return;
      }

      if (message.type === "touchpad") {
        handleTouchpadInput(message);
        return;
      }

      if (message.type === "error") {
        setConnectionError(message.message);
        return;
      }

      if (message.type === "warning") {
        setConnectionError(message.message);
      }
    },
    [
      handleNativeInput,
      handleNativeRawInput,
      handleTouchpadInput,
      stopDirectionNudgeRepeatsForDevice,
    ]
  );

  const registerDevice = useCallback(
    async (device: HIDDevice) => {
      const deviceId = getAppleRemoteDeviceId(device);

      if (!isSessionActiveRef.current) {
        if (device.opened) {
          await device.close();
        }
        return null;
      }

      const existingDevice = deviceRefs.current.get(deviceId);
      const existingHandler = reportHandlersRef.current.get(deviceId);

      if (existingDevice && existingHandler) {
        existingDevice.removeEventListener("inputreport", existingHandler);
      }

      if (!device.opened) {
        await device.open();
      }

      const reportHandler = (event: HIDInputReportEvent) => {
        handleInputReport(deviceId, event);
      };

      device.addEventListener("inputreport", reportHandler);
      deviceRefs.current.set(deviceId, device);
      reportHandlersRef.current.set(deviceId, reportHandler);

      const deviceState = toDeviceState(device);

      setDevices((previousDevices) => {
        const existingIndex = previousDevices.findIndex(
          (item) => item.id === deviceState.id
        );

        if (existingIndex === -1) {
          return [...previousDevices, deviceState];
        }

        return previousDevices.map((item, index) =>
          index === existingIndex ? deviceState : item
        );
      });
      setMappings((previousMappings) =>
        ensureDefaultTouchpadCursorMapping(previousMappings, deviceState)
      );

      return deviceId;
    },
    [handleInputReport]
  );

  const refreshDevices = useCallback(async () => {
    if (window.ipcRenderer) {
      const channel = isSessionActiveRef.current
        ? "apple-remote-start"
        : "apple-remote-stop";
      const result = await window.ipcRenderer.invoke(channel);
      if (result?.error) {
        setConnectionError(result.error);
      }
      return;
    }

    if (!navigator.hid) {
      setConnectionError("WebHID is not available in this Electron build.");
      return;
    }

    if (!isSessionActiveRef.current) {
      const openedDevices = Array.from(deviceRefs.current.values());
      await Promise.all(
        openedDevices.map((device) =>
          device.opened ? device.close().catch(() => undefined) : undefined
        )
      );
      deviceRefs.current.clear();
      reportHandlersRef.current.clear();
      setDevices([]);
      return;
    }

    const grantedDevices = await navigator.hid.getDevices();
    const remoteDevices = grantedDevices.filter((device) => {
      const deviceId = getAppleRemoteDeviceId(device);
      return (
        isLikelyAppleRemoteDevice(device) ||
        mappingsRef.current.some((mapping) => mapping.deviceId === deviceId)
      );
    });

    await Promise.all(remoteDevices.map(registerDevice));

    setDevices((previousDevices) =>
      previousDevices.filter((device) =>
        remoteDevices.some(
          (remoteDevice) => getAppleRemoteDeviceId(remoteDevice) === device.id
        )
      )
    );
  }, [registerDevice]);

  useEffect(() => {
    if (!window.ipcRenderer) {
      return;
    }

    const listener = (_event: unknown, message: unknown) => {
      if (isAppleRemoteNativeMessage(message)) {
        handleNativeMessage(message);
      }
    };

    window.ipcRenderer.on("apple-remote-native-message", listener);

    return () => {
      window.ipcRenderer?.off("apple-remote-native-message", listener);
    };
  }, [handleNativeMessage]);

  const connectAppleRemote = useCallback(
    async (allowAnyHidDevice = false) => {
      isSessionActiveRef.current = true;
      setIsSessionActive(true);

      if (window.ipcRenderer) {
        setIsConnecting(true);
        setConnectionError(null);

        try {
          const result = await window.ipcRenderer.invoke("apple-remote-start");
          if (result?.success) {
            return null;
          }

          if (result?.error) {
            setConnectionError(result.error);
          }
        } catch (error) {
          console.error("Failed to start native Apple Remote helper:", error);
          setConnectionError(String(error));
        } finally {
          setIsConnecting(false);
        }
      }

      if (!navigator.hid) {
        setConnectionError("WebHID is not available in this Electron build.");
        return null;
      }

      setIsConnecting(true);
      setConnectionError(null);

      try {
        const requestedDevices = await navigator.hid.requestDevice({
          filters: allowAnyHidDevice ? [] : APPLE_VENDOR_FILTERS,
        });

        if (requestedDevices.length === 0) {
          setConnectionError("No Apple TV Remote was selected.");
          return null;
        }

        const preferredDevice =
          requestedDevices.find(isLikelyAppleRemoteDevice) ??
          requestedDevices[0];

        const deviceIds = await Promise.all(
          requestedDevices.map(registerDevice)
        );

        return (
          deviceIds.find(
            (deviceId) => deviceId === getAppleRemoteDeviceId(preferredDevice)
          ) ?? deviceIds[0] ?? null
        );
      } catch (error) {
        console.error("Failed to connect Apple TV Remote:", error);
        setConnectionError(String(error));
        return null;
      } finally {
        setIsConnecting(false);
      }
    },
    [registerDevice]
  );

  const releaseAppleRemote = useCallback(async () => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false);
    setIsConnecting(false);
    setConnectionError(null);

    const releaseTasks: Array<Promise<unknown>> = [];
    keyHoldersRef.current.forEach((holders, holderKey) => {
      if (holders.size === 0) {
        return;
      }

      const separatorIndex = holderKey.indexOf(":");
      const outputMode = holderKey.slice(0, separatorIndex);
      const key = holderKey.slice(separatorIndex + 1);

      if (key.startsWith("Mouse")) {
        const task = window.mouseSimulator?.buttonToggle(key, false);
        if (task) {
          releaseTasks.push(task.catch(() => undefined));
        }
      } else if (outputMode === "hold-modifiers") {
        releaseTasks.push(
          window.keySimulator
            .keyShortcutHoldToggle(key, false)
            .catch(() => undefined)
        );
      } else {
        releaseTasks.push(
          window.keySimulator.keyToggle(key, false).catch(() => undefined)
        );
      }
    });

    if (window.ipcRenderer) {
      releaseTasks.push(
        window.ipcRenderer.invoke("apple-remote-stop").catch(() => undefined)
      );
    }

    deviceRefs.current.forEach((device, deviceId) => {
      const reportHandler = reportHandlersRef.current.get(deviceId);
      if (reportHandler) {
        device.removeEventListener("inputreport", reportHandler);
      }
      if (device.opened) {
        releaseTasks.push(device.close().catch(() => undefined));
      }
    });

    await Promise.all(releaseTasks);

    directionNudgeRepeatTimersRef.current.forEach((repeatState) => {
      if (repeatState.timeoutId !== null) {
        window.clearTimeout(repeatState.timeoutId);
      }
    });
    buttonHoldStatesRef.current.forEach((state) => {
      if (state.timerId !== null) {
        window.clearTimeout(state.timerId);
      }
    });
    keyRepeatTimersRef.current.forEach((state) => {
      if (state.timeoutId !== null) {
        window.clearTimeout(state.timeoutId);
      }
      if (state.intervalId !== null) {
        window.clearInterval(state.intervalId);
      }
    });
    visualHoldTimersRef.current.forEach((timerId) =>
      window.clearTimeout(timerId)
    );
    visualReleaseTimersRef.current.forEach((timerId) =>
      window.clearTimeout(timerId)
    );
    if (touchpadVisualReleaseTimerRef.current !== null) {
      window.clearTimeout(touchpadVisualReleaseTimerRef.current);
      touchpadVisualReleaseTimerRef.current = null;
    }
    if (touchpadRingReleaseTimerRef.current !== null) {
      window.clearTimeout(touchpadRingReleaseTimerRef.current);
      touchpadRingReleaseTimerRef.current = null;
    }

    deviceRefs.current.clear();
    reportHandlersRef.current.clear();
    previousReportsRef.current.clear();
    clickpadDirectionStatesRef.current.clear();
    directionNudgeRepeatTimersRef.current.clear();
    touchpadCursorStateRef.current = null;
    touchpadPressLockKeysRef.current.clear();
    buttonHoldStatesRef.current.clear();
    visualHoldTimersRef.current.clear();
    visualReleaseTimersRef.current.clear();
    visualActiveSinceRef.current.clear();
    keyHoldersRef.current.clear();
    keyRepeatTimersRef.current.clear();
    previousButtonStatesRef.current.clear();
    pendingMouseMovementsRef.current.clear();
    pendingTouchpadScrollsRef.current.clear();
    nativeSelectorValuesRef.current.clear();
    setDevices([]);
    setActiveButtonStates({});
    setTouchpadVisualState(null);
    setLearningButtonDeviceId(null);
    setLearningCursorDeviceId(null);
    setPendingButtonControl(null);
    setPendingCursorMapping(null);
  }, []);

  useEffect(() => {
    if (!navigator.hid) {
      return;
    }

    refreshDevices().catch((error) => {
      console.error("Failed to refresh Apple Remote devices:", error);
    });

    const handleConnect = (event: HIDConnectionEvent) => {
      if (window.ipcRenderer) {
        return;
      }

      if (!isSessionActiveRef.current) {
        if (event.device.opened) {
          event.device.close().catch(() => undefined);
        }
        return;
      }

      if (isLikelyAppleRemoteDevice(event.device)) {
        registerDevice(event.device).catch((error) => {
          console.error("Failed to open Apple Remote:", error);
        });
      }
    };

    const handleDisconnect = (event: HIDConnectionEvent) => {
      if (window.ipcRenderer) {
        return;
      }

      const deviceId = getAppleRemoteDeviceId(event.device);
      setDevices((previousDevices) =>
        previousDevices.filter((device) => device.id !== deviceId)
      );
      deviceRefs.current.delete(deviceId);
      reportHandlersRef.current.delete(deviceId);
      clearClickpadDirectionStatesForDevice(
        clickpadDirectionStatesRef.current,
        deviceId
      );
      stopDirectionNudgeRepeatsForDevice(deviceId);
      setTouchpadVisualState((currentState) =>
        currentState?.deviceId === deviceId ? null : currentState
      );
      buttonHoldStatesRef.current.forEach((state) => {
        if (state.timerId !== null) {
          window.clearTimeout(state.timerId);
        }
      });
      buttonHoldStatesRef.current.clear();
      keyRepeatTimersRef.current.forEach((state) => {
        if (state.timeoutId !== null) {
          window.clearTimeout(state.timeoutId);
        }
        if (state.intervalId !== null) {
          window.clearInterval(state.intervalId);
        }
      });
      keyRepeatTimersRef.current.clear();
      visualHoldTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      visualHoldTimersRef.current.clear();
      visualReleaseTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      visualReleaseTimersRef.current.clear();
      visualActiveSinceRef.current.clear();
      keyHoldersRef.current.clear();
      previousButtonStatesRef.current.clear();
      nativeSelectorValuesRef.current.clear();
      touchpadPressLockKeysRef.current.clear();
      setActiveButtonStates({});
    };

    navigator.hid.addEventListener("connect", handleConnect);
    navigator.hid.addEventListener("disconnect", handleDisconnect);

    return () => {
      navigator.hid?.removeEventListener("connect", handleConnect);
      navigator.hid?.removeEventListener("disconnect", handleDisconnect);
    };
  }, [
    isSessionActive,
    refreshDevices,
    registerDevice,
    stopDirectionNudgeRepeatsForDevice,
  ]);

  useEffect(() => {
    if (!learningCursorDeviceId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const shouldUseNativeValues = learningCursorModeRef.current !== "touchpad";
      const nativeMapping = shouldUseNativeValues
        ? learnNativeCursorMappingFromSamples(
            nativeCursorSamplesRef.current.filter(
              (sample) => sample.deviceId === learningCursorDeviceId
            )
          )
        : null;
      const mapping =
        nativeMapping ??
        learnCursorMappingFromSamples(
          cursorSamplesRef.current.filter(
            (sample) => sample.deviceId === learningCursorDeviceId
          )
        );

      setPendingCursorMapping(mapping);
      setLearningCursorDeviceId(null);
      setLearningCursorMode("auto");
      setCursorSampleCount(0);

      if (!mapping) {
        setConnectionError("No cursor movement was detected from the remote.");
      }
    }, CURSOR_LEARNING_WINDOW_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [learningCursorDeviceId]);

  const getMapping = useCallback(
    (deviceId: string): AppleRemoteMapping | undefined =>
      mappings.find((mapping) => mapping.deviceId === deviceId),
    [mappings]
  );

  const setButtonMapping = useCallback(
    (
      deviceId: string,
      control: AppleRemoteButtonControlUnion,
      key: string,
      label: string,
      trigger: AppleRemoteButtonTrigger = "press",
      outputMode: AppleRemoteButtonOutputMode = normalizeButtonOutputMode(
        undefined,
        key,
        trigger
      )
    ) => {
      const controlKey = getAppleRemoteButtonControlKey(control, trigger);
      const resolvedOutputMode = normalizeButtonOutputMode(
        outputMode,
        key,
        trigger
      );

      setMappings((previousMappings) => {
        const existingMapping = previousMappings.find(
          (mapping) => mapping.deviceId === deviceId
        );
        const baseMapping =
          existingMapping ??
          ({
            deviceId,
            buttonMappings: [],
          } satisfies AppleRemoteMapping);
        const existingButtonMapping = baseMapping.buttonMappings.find(
          (mapping) => mapping.controlKey === controlKey
        );
        const updatedButtonMapping = {
          controlKey,
          control,
          key,
          label,
          trigger,
          outputMode: resolvedOutputMode,
        };
        const updatedMapping: AppleRemoteMapping = {
          ...baseMapping,
          buttonMappings: existingButtonMapping
            ? baseMapping.buttonMappings.map((mapping) =>
                mapping.controlKey === controlKey
                  ? updatedButtonMapping
                  : mapping
              )
            : [...baseMapping.buttonMappings, updatedButtonMapping],
        };

        return existingMapping
          ? previousMappings.map((mapping) =>
              mapping.deviceId === deviceId ? updatedMapping : mapping
            )
          : [...previousMappings, updatedMapping];
      });

      setPendingButtonControl(null);
      setLearningButtonDeviceId(null);
    },
    []
  );

  const removeButtonMapping = useCallback(
    (deviceId: string, controlKey: string) => {
      setMappings((previousMappings) =>
        previousMappings.map((mapping) =>
          mapping.deviceId === deviceId
            ? {
                ...mapping,
                buttonMappings: mapping.buttonMappings.filter(
                  (buttonMapping) => buttonMapping.controlKey !== controlKey
                ),
              }
            : mapping
        )
      );
    },
    []
  );

  const setCursorMapping = useCallback(
    (deviceId: string, cursorMapping: AppleRemoteCursorMapping) => {
      setMappings((previousMappings) => {
        const existingMapping = previousMappings.find(
          (mapping) => mapping.deviceId === deviceId
        );
        const baseMapping =
          existingMapping ??
          ({
            deviceId,
            buttonMappings: [],
          } satisfies AppleRemoteMapping);
        const updatedMapping = {
          ...baseMapping,
          cursorMapping: {
            ...cursorMapping,
            touchpadContactSensitivity: normalizeTouchpadContactSensitivity(
              cursorMapping.touchpadContactSensitivity
            ),
            rotation: normalizePointerRotation(cursorMapping.rotation),
          },
        };

        return existingMapping
          ? previousMappings.map((mapping) =>
              mapping.deviceId === deviceId ? updatedMapping : mapping
            )
          : [...previousMappings, updatedMapping];
      });

      setPendingCursorMapping(null);
    },
    []
  );

  const removeCursorMapping = useCallback((deviceId: string) => {
    setMappings((previousMappings) =>
      previousMappings.map((mapping) =>
        mapping.deviceId === deviceId
          ? {
              ...mapping,
              cursorMapping: undefined,
            }
          : mapping
      )
    );
    setPendingCursorMapping(null);
  }, []);

  const startButtonLearning = useCallback((deviceId: string) => {
    setConnectionError(null);
    setPendingButtonControl(null);
    setLearningCursorDeviceId(null);
    setLearningButtonDeviceId(deviceId);
  }, []);

  const cancelButtonLearning = useCallback(() => {
    setLearningButtonDeviceId(null);
    setPendingButtonControl(null);
  }, []);

  const startCursorLearning = useCallback(
    (
      deviceId: string,
      mode: AppleRemoteCursorLearningMode = "auto"
    ) => {
      setConnectionError(null);
      cursorSamplesRef.current = [];
      nativeCursorSamplesRef.current = [];
      setCursorSampleCount(0);
      setPendingCursorMapping(null);
      setLearningButtonDeviceId(null);

      const device = devices.find((item) => item.id === deviceId);
      if (
        mode === "auto" &&
        device &&
        supportsTouchpadCursor(device)
      ) {
        setMappings((previousMappings) =>
          ensureDefaultTouchpadCursorMapping(previousMappings, device)
        );
        setLearningCursorDeviceId(null);
        setLearningCursorMode("auto");
        return;
      }

      setLearningCursorMode(mode);
      setLearningCursorDeviceId(deviceId);
    },
    [devices]
  );

  const clearPendingCursorMapping = useCallback(() => {
    setPendingCursorMapping(null);
  }, []);

  return {
    devices,
    mappings,
    isSupported,
    isConnecting,
    isSessionActive,
    connectionError,
    learningButtonDeviceId,
    pendingButtonControl,
    learningCursorDeviceId,
    learningCursorMode,
    pendingCursorMapping,
    cursorSampleCount,
    activeButtonStates,
    touchpadVisualState,
    getMapping,
    connectAppleRemote,
    releaseAppleRemote,
    refreshDevices,
    setButtonMapping,
    removeButtonMapping,
    setCursorMapping,
    removeCursorMapping,
    startButtonLearning,
    cancelButtonLearning,
    startCursorLearning,
    clearPendingCursorMapping,
  };
}
