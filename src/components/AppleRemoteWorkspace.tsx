import {
  ArrowUp,
  Check,
  ChevronLeft,
  Circle,
  Crosshair,
  Play,
  Power,
  Square,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import {
  APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY,
  APPLE_REMOTE_POINTER_ASSIST_TOGGLE_LABEL,
  type AppleRemoteActiveButtonState,
  type AppleRemoteButtonMapping,
  type AppleRemoteDeviceState,
  type AppleRemoteMapping,
  type AppleRemoteTouchpadVisualState,
} from "../hooks/useAppleRemote";
import type {
  PointerAssistConfig,
  PointerAssistVisualState,
} from "../types/global";

type RemoteControlName =
  | "power"
  | "back"
  | "tv"
  | "siri"
  | "playPause"
  | "mute"
  | "volume"
  | "center"
  | "up"
  | "down"
  | "left"
  | "right";

type RemoteControlCandidate = {
  usagePage: number;
  usage: number;
};

type RemoteControlLabels = Record<RemoteControlName, string | undefined>;
type RemoteActiveClasses = Record<RemoteControlName, string>;

type CalloutDefinition = {
  control: RemoteControlName;
  side: "left" | "right";
  top: number;
  targetX: number;
  targetY: number;
  className: string;
};

const REMOTE_BODY_WIDTH = 136;
const REMOTE_CALLOUT_GAP = 38;
const REMOTE_CALLOUT_ANCHOR_Y = 11;
const REMOTE_CALLOUT_DOT_Y_OFFSET = 10;
const REMOTE_CALLOUT_ELBOW_GAP = 22;

const CONTROL_NAMES: RemoteControlName[] = [
  "power",
  "back",
  "tv",
  "siri",
  "playPause",
  "mute",
  "volume",
  "center",
  "up",
  "down",
  "left",
  "right",
];

const REMOTE_CONTROL_CANDIDATES: Record<
  RemoteControlName,
  RemoteControlCandidate[]
> = {
  power: [{ usagePage: 1, usage: 129 }],
  back: [
    { usagePage: 1, usage: 134 },
    { usagePage: 12, usage: 64 },
    { usagePage: 12, usage: 65 },
  ],
  tv: [
    { usagePage: 12, usage: 96 },
    { usagePage: 12, usage: 514 },
  ],
  siri: [{ usagePage: 12, usage: 4 }],
  playPause: [{ usagePage: 12, usage: 205 }],
  mute: [{ usagePage: 12, usage: 226 }],
  volume: [
    { usagePage: 12, usage: 233 },
    { usagePage: 12, usage: 234 },
  ],
  center: [{ usagePage: 12, usage: 128 }],
  up: [{ usagePage: 12, usage: 66 }],
  down: [{ usagePage: 12, usage: 67 }],
  left: [{ usagePage: 12, usage: 68 }],
  right: [{ usagePage: 12, usage: 69 }],
};

const SILVER_CALLOUTS: CalloutDefinition[] = [
  { control: "power", side: "right", top: 4, targetX: 112, targetY: 24, className: "callout-power" },
  { control: "up", side: "left", top: 42, targetX: 68, targetY: 68, className: "callout-up" },
  { control: "center", side: "right", top: 50, targetX: 68, targetY: 110, className: "callout-center" },
  { control: "left", side: "left", top: 96, targetX: 24, targetY: 110, className: "callout-left-direction" },
  { control: "right", side: "right", top: 104, targetX: 112, targetY: 110, className: "callout-right-direction" },
  { control: "down", side: "left", top: 150, targetX: 68, targetY: 152, className: "callout-down" },
  { control: "siri", side: "right", top: 158, targetX: 136, targetY: 110, className: "callout-siri" },
  { control: "back", side: "left", top: 214, targetX: 33, targetY: 205, className: "callout-back" },
  { control: "tv", side: "right", top: 212, targetX: 103, targetY: 205, className: "callout-tv" },
  { control: "mute", side: "right", top: 278, targetX: 103, targetY: 265, className: "callout-mute" },
  { control: "playPause", side: "left", top: 290, targetX: 33, targetY: 265, className: "callout-play" },
  { control: "volume", side: "right", top: 354, targetX: 103, targetY: 346, className: "callout-volume" },
];

const BLACK_CALLOUTS: CalloutDefinition[] = [
  { control: "center", side: "right", top: 52, targetX: 68, targetY: 68, className: "callout-touch-center" },
  { control: "back", side: "left", top: 150, targetX: 35, targetY: 161, className: "callout-back" },
  { control: "tv", side: "right", top: 150, targetX: 101, targetY: 161, className: "callout-tv" },
  { control: "siri", side: "left", top: 210, targetX: 35, targetY: 221, className: "callout-siri" },
  { control: "playPause", side: "right", top: 210, targetX: 101, targetY: 221, className: "callout-play" },
  { control: "volume", side: "right", top: 292, targetX: 68, targetY: 299, className: "callout-volume" },
];

const TEST_LIST_ITEMS = ["Inbox", "Draft", "Review", "Ship", "Archive"];
const TEST_SCROLL_ITEMS = [
  "North",
  "East",
  "South",
  "West",
  "Center",
  "Top",
  "Middle",
  "Bottom",
];
const TEST_ICON_ITEMS: Array<{ label: string; Icon: LucideIcon }> = [
  { label: "Record", Icon: Circle },
  { label: "Send", Icon: ArrowUp },
  { label: "Stop", Icon: Square },
  { label: "Done", Icon: Check },
  { label: "Focus", Icon: Crosshair },
];

function buttonMatchesCandidate(
  buttonMapping: AppleRemoteButtonMapping,
  candidate: RemoteControlCandidate
): boolean {
  if (buttonMapping.control.type !== "native-value") {
    return false;
  }

  return (
    (buttonMapping.control.usagePage === candidate.usagePage &&
      buttonMapping.control.usage === candidate.usage) ||
    (buttonMapping.control.usagePage === 12 &&
      buttonMapping.control.usage === 1 &&
      buttonMapping.control.value === candidate.usage)
  );
}

function getMappingLabel(
  mapping: AppleRemoteMapping | undefined,
  candidates: RemoteControlCandidate[]
): string | undefined {
  const labels = mapping?.buttonMappings
    .filter((buttonMapping) =>
      candidates.some((candidate) =>
        buttonMatchesCandidate(buttonMapping, candidate)
      )
    )
    .map((buttonMapping) => {
      if (buttonMapping.key === APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY) {
        return APPLE_REMOTE_POINTER_ASSIST_TOGGLE_LABEL;
      }

      const holdsOutput =
        buttonMapping.trigger === "hold" ||
        buttonMapping.outputMode === "hold" ||
        buttonMapping.outputMode === "hold-modifiers";
      return holdsOutput ? `Hold ${buttonMapping.label}` : buttonMapping.label;
    });

  return labels?.length ? labels.join(" / ") : undefined;
}

function getActiveClass(
  activeButtonStates: Record<string, AppleRemoteActiveButtonState>,
  candidates: RemoteControlCandidate[]
): string {
  const state = candidates
    .map(
      (candidate) =>
        activeButtonStates[`native:${candidate.usagePage}:${candidate.usage}`]
    )
    .find(Boolean);

  if (!state) {
    return "";
  }

  return state.trigger === "hold" ? "is-hold-active" : "is-press-active";
}

function controlClass(baseClassName: string, activeClassName: string): string {
  return [baseClassName, activeClassName].filter(Boolean).join(" ");
}

function RemoteMappingCallout({
  label,
  side,
  top,
  targetX,
  targetY,
  className,
}: Omit<CalloutDefinition, "control"> & { label?: string }) {
  if (!label) {
    return null;
  }

  const startX =
    side === "left" ? -REMOTE_CALLOUT_GAP : REMOTE_BODY_WIDTH + REMOTE_CALLOUT_GAP;
  const anchorY = top + REMOTE_CALLOUT_ANCHOR_Y;
  const dotY = targetY + REMOTE_CALLOUT_DOT_Y_OFFSET;
  const elbowX =
    side === "left"
      ? Math.min(targetX - REMOTE_CALLOUT_ELBOW_GAP, startX + 48)
      : Math.max(targetX + REMOTE_CALLOUT_ELBOW_GAP, startX - 48);
  const horizontalLength = Math.abs(elbowX - startX);
  const bendDeltaX = targetX - elbowX;
  const bendDeltaY = dotY - anchorY;
  const style = {
    "--callout-top": `${top}px`,
    "--guide-horizontal-length": `${horizontalLength}px`,
    "--guide-horizontal-x": `${startX < elbowX ? 0 : -horizontalLength}px`,
    "--guide-elbow-x": `${elbowX - startX}px`,
    "--guide-bend-length": `${Math.hypot(bendDeltaX, bendDeltaY)}px`,
    "--guide-bend-angle": `${Math.atan2(bendDeltaY, bendDeltaX) * (180 / Math.PI)}deg`,
    "--guide-dot-x": `${targetX - startX}px`,
    "--guide-dot-y": `${dotY - anchorY}px`,
  } as CSSProperties;

  return (
    <span
      className={`apple-remote-callout callout-${side} ${className}`}
      style={style}
    >
      <span className="apple-remote-callout-guide-horizontal" />
      <span className="apple-remote-callout-guide-bend" />
      <span className="apple-remote-callout-dot" />
      <span className="apple-remote-callout-text">{label}</span>
    </span>
  );
}

function MappingCallouts({
  variant,
  labels,
}: {
  variant: "silver" | "black";
  labels: RemoteControlLabels;
}) {
  const definitions = variant === "silver" ? SILVER_CALLOUTS : BLACK_CALLOUTS;

  return (
    <div className={`apple-remote-callouts apple-remote-callouts-${variant}`}>
      {definitions.map(({ control, ...definition }) => (
        <RemoteMappingCallout
          key={control}
          {...definition}
          label={labels[control]}
        />
      ))}
    </div>
  );
}

function TouchContact({
  style,
  gestureZone,
}: {
  style?: CSSProperties;
  gestureZone?: AppleRemoteTouchpadVisualState["gestureZone"];
}) {
  return style ? (
    <span
      className={`apple-remote-touch-contact ${
        gestureZone === "ring" ? "is-ring-scroll" : "is-pointer-move"
      }`}
      style={style}
    />
  ) : null;
}

function SilverRemote({
  active,
  labels,
  touchStyle,
  touchGestureZone,
}: {
  active: RemoteActiveClasses;
  labels: RemoteControlLabels;
  touchStyle?: CSSProperties;
  touchGestureZone?: AppleRemoteTouchpadVisualState["gestureZone"];
}) {
  const clickpadState = [active.up, active.right, active.down, active.left];
  const clickpadClass = clickpadState.includes("is-hold-active")
    ? "is-hold-active"
    : clickpadState.includes("is-press-active")
      ? "is-press-active"
      : "";

  return (
    <>
      <div className="apple-remote-top-row">
        <div className={controlClass("apple-remote-power", active.power)}>
          <span><Power size={12} strokeWidth={2.2} /></span>
        </div>
      </div>
      <div
        className={controlClass(
          `apple-remote-clickpad ${
            touchGestureZone === "ring" ? "is-ring-gesture" : ""
          }`,
          clickpadClass
        )}
      >
        <TouchContact style={touchStyle} gestureZone={touchGestureZone} />
        {(["up", "right", "down", "left"] as const).map((direction) => (
          <span
            key={direction}
            className={controlClass(`clickpad-mark ${direction}`, active[direction])}
          />
        ))}
        <div className={controlClass("apple-remote-clickpad-center", active.center)} />
      </div>
      <div className="apple-remote-button-row">
        <div className={controlClass("apple-remote-button", active.back)}>
          <span><ChevronLeft size={17} strokeWidth={2.2} /></span>
        </div>
        <div className={controlClass("apple-remote-button", active.tv)}><span>TV</span></div>
      </div>
      <div className="apple-remote-button-row">
        <div className={controlClass("apple-remote-button", active.playPause)}>
          <span><Play size={13} fill="currentColor" /></span>
        </div>
        <div className={controlClass("apple-remote-button", active.mute)}>
          <span><VolumeX size={14} strokeWidth={2.2} /></span>
        </div>
      </div>
      <div className="apple-remote-bottom-controls">
        <div className={controlClass("apple-remote-volume", active.volume)}><span>+ / -</span></div>
      </div>
      <div className={controlClass("apple-remote-side-button", active.siri)}><span>Siri</span></div>
      <MappingCallouts variant="silver" labels={labels} />
    </>
  );
}

function BlackRemote({
  active,
  labels,
  touchStyle,
}: {
  active: RemoteActiveClasses;
  labels: RemoteControlLabels;
  touchStyle?: CSSProperties;
}) {
  return (
    <>
      <div className={controlClass("apple-remote-touchpad", active.center)}>
        <TouchContact style={touchStyle} gestureZone="pointer" />
      </div>
      <div className="apple-remote-button-row">
        <div className={controlClass("apple-remote-button", active.back)}><span>Menu</span></div>
        <div className={controlClass("apple-remote-button", active.tv)}><span>TV</span></div>
      </div>
      <div className="apple-remote-button-row">
        <div className={controlClass("apple-remote-button", active.siri)}><span>Siri</span></div>
        <div className={controlClass("apple-remote-button", active.playPause)}>
          <span><Play size={13} fill="currentColor" /></span>
        </div>
      </div>
      <div className={controlClass("apple-remote-volume", active.volume)}><span>+ / -</span></div>
      <MappingCallouts variant="black" labels={labels} />
    </>
  );
}

export function PointerAssistTestPad({
  pointerAssistConfig,
  pointerAssistState,
}: {
  pointerAssistConfig: PointerAssistConfig;
  pointerAssistState: PointerAssistVisualState;
}) {
  const className = [
    "pointer-assist-test-pad",
    pointerAssistState.locked ? "is-pointer-snapped" : "",
    pointerAssistConfig.enabled ? "is-pointer-assist-enabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = {
    "--magnet-radius": `${Math.round(pointerAssistConfig.radius)}px`,
    "--magnet-strength": pointerAssistConfig.strength.toFixed(2),
    "--magnet-field-opacity": (0.28 + pointerAssistConfig.strength * 0.34).toFixed(2),
    "--magnet-target-opacity": (0.32 + pointerAssistConfig.strength * 0.42).toFixed(2),
  } as CSSProperties;

  return (
    <section className={className} style={style} aria-label="Magnet target test area">
      <div className="pointer-assist-test-heading">
        <strong>Magnetic cursor test bench</strong>
        <span>Small targets, vertical navigation and continuous scroll</span>
      </div>
      <div
        className="pointer-assist-lock-indicator"
        aria-label={pointerAssistState.locked ? "Pointer is magnetically snapped" : "Pointer is free"}
      >
        <span className="pointer-assist-lock-dot" />
        <span>{pointerAssistState.locked ? "Snapped" : "Free"}</span>
      </div>
      <div className="pointer-assist-test-list" aria-label="Vertical target list">
        {TEST_LIST_ITEMS.map((item) => (
          <button key={item} className="pointer-assist-test-list-button is-magnet-target" data-magnet-target="list" type="button">
            {item}
          </button>
        ))}
      </div>
      <div className="pointer-assist-test-icons" aria-label="Small round targets">
        {TEST_ICON_ITEMS.map(({ label, Icon }) => (
          <button key={label} className="pointer-assist-test-icon-button is-magnet-target" data-magnet-target="button" type="button" aria-label={label} title={label}>
            <Icon size={14} strokeWidth={2} />
          </button>
        ))}
      </div>
      <div className="pointer-assist-test-scroll-shell">
        <div className="pointer-assist-test-scroll" aria-label="Scrollable targets">
          {TEST_SCROLL_ITEMS.map((item) => (
            <button key={item} className="pointer-assist-test-scroll-button is-magnet-target" data-magnet-target="scroll-item" type="button">
              {item}
            </button>
          ))}
        </div>
        <span className="pointer-assist-test-scroll-rail is-magnet-target" data-magnet-target="scrollbar" aria-hidden="true" />
      </div>
    </section>
  );
}

export function AppleRemoteWorkspace({
  device,
  mapping,
  activeButtonStates,
  touchpadVisualState,
  pointerAssistConfig,
  pointerAssistState,
}: {
  device: AppleRemoteDeviceState;
  mapping?: AppleRemoteMapping;
  activeButtonStates: Record<string, AppleRemoteActiveButtonState>;
  touchpadVisualState: AppleRemoteTouchpadVisualState | null;
  pointerAssistConfig: PointerAssistConfig;
  pointerAssistState: PointerAssistVisualState;
}) {
  const labels = useMemo(
    () =>
      Object.fromEntries(
        CONTROL_NAMES.map((control) => [
          control,
          getMappingLabel(mapping, REMOTE_CONTROL_CANDIDATES[control]),
        ])
      ) as RemoteControlLabels,
    [mapping]
  );
  const active = useMemo(
    () =>
      Object.fromEntries(
        CONTROL_NAMES.map((control) => [
          control,
          getActiveClass(activeButtonStates, REMOTE_CONTROL_CANDIDATES[control]),
        ])
      ) as RemoteActiveClasses,
    [activeButtonStates]
  );
  const touchStyle = touchpadVisualState
    ? ({
        "--touch-x": `${touchpadVisualState.x * 100}%`,
        "--touch-y": `${(1 - touchpadVisualState.y) * 100}%`,
        "--touch-scale": `${0.8 + touchpadVisualState.size * 0.9}`,
        "--touch-opacity": `${0.42 + touchpadVisualState.size * 0.5}`,
      } as CSSProperties)
    : undefined;
  const isSilver = device.modelInfo.bodyStyle === "silver-clickpad";

  return (
    <div className="apple-remote-workbench">
      <div className="apple-remote-visualization">
        <div className={`apple-remote-body ${device.modelInfo.bodyStyle}`}>
          {isSilver ? (
            <SilverRemote
              active={active}
              labels={labels}
              touchStyle={touchStyle}
              touchGestureZone={touchpadVisualState?.gestureZone}
            />
          ) : (
            <BlackRemote active={active} labels={labels} touchStyle={touchStyle} />
          )}
        </div>
        <div className="apple-remote-visualization-copy">
          <h3>{device.name}</h3>
          <p>{device.modelInfo.generationLabel} · {device.modelInfo.connectorLabel}</p>
        </div>
      </div>
      <PointerAssistTestPad pointerAssistConfig={pointerAssistConfig} pointerAssistState={pointerAssistState} />
    </div>
  );
}
