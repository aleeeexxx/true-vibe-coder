import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bluetooth,
  ChevronDown,
  ExternalLink,
  Keyboard,
  Magnet,
  MousePointer2,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Unplug,
} from "lucide-react";
import {
  APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY,
  APPLE_REMOTE_POINTER_ASSIST_TOGGLE_LABEL,
  AppleRemoteButtonControlUnion,
  AppleRemoteButtonMapping,
  AppleRemoteButtonOutputMode,
  AppleRemoteButtonTrigger,
  AppleRemoteCursorLearningMode,
  AppleRemoteCursorMapping,
  AppleRemoteCursorMode,
  AppleRemoteDeviceState,
  AppleRemoteMapping,
  formatAppleRemoteButtonControl,
  formatAppleRemoteCursorSource,
} from "../hooks/useAppleRemote";
import { PointerRotation } from "../utils/pointerRotation";
import type { PointerAssistConfig } from "../types/global";
import { KeyMappingSelector } from "./KeyMappingSelector";
import { MappingActions } from "./MappingActions";
import "./MappingPanel.css";

const ROTATION_OPTIONS: Array<{ value: PointerRotation; label: string }> = [
  { value: 0, label: "None" },
  { value: 90, label: "90 deg CW" },
  { value: 180, label: "180 deg" },
  { value: 270, label: "90 deg CCW" },
];

interface AppleRemotePanelProps {
  device?: AppleRemoteDeviceState;
  mapping?: AppleRemoteMapping;
  isSupported: boolean;
  isConnecting: boolean;
  isSessionActive: boolean;
  connectionError: string | null;
  learningButtonDeviceId: string | null;
  pendingButtonControl: AppleRemoteButtonControlUnion | null;
  learningCursorDeviceId: string | null;
  learningCursorMode: AppleRemoteCursorLearningMode;
  pendingCursorMapping: AppleRemoteCursorMapping | null;
  cursorSampleCount: number;
  pointerAssistConfig: PointerAssistConfig;
  onSetPointerAssistConfig: (updates: Partial<PointerAssistConfig>) => void;
  onConnectAppleRemote: (allowAnyHidDevice?: boolean) => Promise<string | null>;
  onReleaseAppleRemote: () => Promise<void>;
  onRefreshDevices: () => Promise<void>;
  onStartButtonLearning: (deviceId: string) => void;
  onCancelButtonLearning: () => void;
  onSetButtonMapping: (
    deviceId: string,
    control: AppleRemoteButtonControlUnion,
    key: string,
    label: string,
    trigger?: AppleRemoteButtonTrigger,
    outputMode?: AppleRemoteButtonOutputMode
  ) => void;
  onRemoveButtonMapping: (deviceId: string, controlKey: string) => void;
  onStartCursorLearning: (
    deviceId: string,
    mode?: AppleRemoteCursorLearningMode
  ) => void;
  onSetCursorMapping: (
    deviceId: string,
    cursorMapping: AppleRemoteCursorMapping
  ) => void;
  onRemoveCursorMapping: (deviceId: string) => void;
  onClearPendingCursorMapping: () => void;
}

function cursorMappingsEqual(
  first?: AppleRemoteCursorMapping | null,
  second?: AppleRemoteCursorMapping | null
): boolean {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null);
}

function formatCursorMappingSummary(mapping: AppleRemoteCursorMapping): string {
  if (mapping.reportId < 0) {
    return "Touchpad movement";
  }

  return `Report ${mapping.reportId}; X ${formatAppleRemoteCursorSource(
    mapping.xSource
  )}; Y ${formatAppleRemoteCursorSource(mapping.ySource)}`;
}

function formatButtonMappingValue(buttonMapping: AppleRemoteButtonMapping): string {
  return buttonMapping.key === APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY
    ? APPLE_REMOTE_POINTER_ASSIST_TOGGLE_LABEL
    : buttonMapping.label;
}

async function openBluetoothSettings(): Promise<void> {
  await window.ipcRenderer?.invoke("open-bluetooth-settings");
}

export function AppleRemotePanel({
  device,
  mapping,
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
  pointerAssistConfig,
  onSetPointerAssistConfig,
  onConnectAppleRemote,
  onReleaseAppleRemote,
  onRefreshDevices,
  onStartButtonLearning,
  onCancelButtonLearning,
  onSetButtonMapping,
  onRemoveButtonMapping,
  onStartCursorLearning,
  onSetCursorMapping,
  onRemoveCursorMapping,
  onClearPendingCursorMapping,
}: AppleRemotePanelProps) {
  const [pendingButtonKey, setPendingButtonKey] = useState<{
    key: string;
    label: string;
  } | null>(null);
  const [pendingButtonTrigger, setPendingButtonTrigger] =
    useState<AppleRemoteButtonTrigger>("press");
  const [pendingButtonOutputMode, setPendingButtonOutputMode] =
    useState<AppleRemoteButtonOutputMode>("tap");
  const [learningPointerAssistToggle, setLearningPointerAssistToggle] =
    useState(false);
  const [draftCursorMapping, setDraftCursorMapping] =
    useState<AppleRemoteCursorMapping | null>(null);
  const [showInputSourceDetails, setShowInputSourceDetails] = useState(false);

  const buttonMappings = mapping?.buttonMappings ?? [];
  const isLearningButton = learningButtonDeviceId === device?.id;
  const isLearningCursor = learningCursorDeviceId === device?.id;
  const activeCursorMapping = pendingCursorMapping ?? mapping?.cursorMapping;
  const hasPendingButton =
    !!pendingButtonControl && !!device && !learningPointerAssistToggle;
  const isSilverClickpad = device?.modelInfo.bodyStyle === "silver-clickpad";
  const pointerAssistToggleMapping = buttonMappings.find(
    (buttonMapping) => buttonMapping.key === APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY
  );

  useEffect(() => {
    setPendingButtonKey(null);
    setPendingButtonTrigger("press");
    setPendingButtonOutputMode("tap");
  }, [device?.id, pendingButtonControl]);

  useEffect(() => {
    setLearningPointerAssistToggle(false);
  }, [device?.id]);

  useEffect(() => {
    if (!device || !pendingButtonControl || !learningPointerAssistToggle) {
      return;
    }

    onSetButtonMapping(
      device.id,
      pendingButtonControl,
      APPLE_REMOTE_POINTER_ASSIST_TOGGLE_KEY,
      APPLE_REMOTE_POINTER_ASSIST_TOGGLE_LABEL,
      "press",
      "tap"
    );
    setLearningPointerAssistToggle(false);
  }, [
    device,
    learningPointerAssistToggle,
    onSetButtonMapping,
    pendingButtonControl,
  ]);

  useEffect(() => {
    setDraftCursorMapping(
      activeCursorMapping ? { ...activeCursorMapping } : null
    );
  }, [activeCursorMapping]);

  const cursorHasUnsavedChanges = useMemo(() => {
    if (!draftCursorMapping) {
      return false;
    }

    return (
      !!pendingCursorMapping ||
      !cursorMappingsEqual(draftCursorMapping, mapping?.cursorMapping)
    );
  }, [draftCursorMapping, mapping?.cursorMapping, pendingCursorMapping]);

  useEffect(() => {
    setShowInputSourceDetails(false);
  }, [device?.id]);

  useEffect(() => {
    if (cursorHasUnsavedChanges) {
      setShowInputSourceDetails(true);
    }
  }, [cursorHasUnsavedChanges]);

  const updateDraftCursor = useCallback(
    (updates: Partial<AppleRemoteCursorMapping>) => {
      setDraftCursorMapping((current) =>
        current ? { ...current, ...updates } : current
      );
    },
    []
  );

  const pointerAssistControls = (
    <div className="inspector-control-group pointer-assist-settings">
      <div className="inspector-setting-head">
        <div className="inspector-setting-title">
          <span className="inspector-setting-icon" aria-hidden="true">
            <Magnet size={15} />
          </span>
          <div>
            <h5>Magnetic Cursor</h5>
            <p>Settle onto compact controls across macOS.</p>
          </div>
        </div>
        <label className="inspector-switch" title="Toggle Magnetic Cursor">
          <input
            type="checkbox"
            role="switch"
            aria-label="Magnetic Cursor"
            checked={pointerAssistConfig.enabled}
            onChange={(event) =>
              onSetPointerAssistConfig({ enabled: event.target.checked })
            }
          />
          <span aria-hidden="true" />
        </label>
      </div>

      <div className="inspector-inline-action">
        <div>
          <span className="inspector-setting-label">Remote toggle</span>
          <span className="inspector-setting-caption">
            {pointerAssistToggleMapping && !learningPointerAssistToggle
              ? formatAppleRemoteButtonControl(pointerAssistToggleMapping.control)
              : "Not assigned"}
          </span>
        </div>
        <button
          className="btn-revert remote-small-action pointer-assist-learn-button"
          disabled={!device || (isLearningButton && !learningPointerAssistToggle)}
          onClick={() => {
            if (!device) {
              return;
            }

            if (learningPointerAssistToggle) {
              setLearningPointerAssistToggle(false);
              onCancelButtonLearning();
              return;
            }

            setLearningPointerAssistToggle(true);
            onStartButtonLearning(device.id);
          }}
        >
          <Plus size={13} />
          {learningPointerAssistToggle ? "Press key" : "Assign"}
        </button>
      </div>

      <details className="inspector-details">
        <summary className="inspector-compact-summary">
          <span>Magnetic settings</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="inspector-details-content">
          <div className="threshold-control inspector-range-control">
            <label>Radius</label>
            <input
              type="range"
              min="12"
              max="260"
              step="1"
              value={pointerAssistConfig.radius}
              disabled={!pointerAssistConfig.enabled}
              onChange={(event) =>
                onSetPointerAssistConfig({
                  radius: Number(event.target.value),
                })
              }
            />
            <span>{Math.round(pointerAssistConfig.radius)} px</span>
          </div>

          <div className="threshold-control inspector-range-control">
            <label>Strength</label>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={pointerAssistConfig.strength}
              disabled={!pointerAssistConfig.enabled}
              onChange={(event) =>
                onSetPointerAssistConfig({
                  strength: Number(event.target.value),
                })
              }
            />
            <span>{pointerAssistConfig.strength.toFixed(2)}</span>
          </div>

          <div className="threshold-control inspector-range-control">
            <label>Release distance</label>
            <input
              type="range"
              min="0"
              max="120"
              step="1"
              value={pointerAssistConfig.snapThreshold}
              disabled={!pointerAssistConfig.enabled}
              onChange={(event) =>
                onSetPointerAssistConfig({
                  snapThreshold: Number(event.target.value),
                })
              }
            />
            <span>{Math.round(pointerAssistConfig.snapThreshold)} px</span>
          </div>
        </div>
      </details>
    </div>
  );

  if (!device) {
    return (
      <div className="mapping-panel-content apple-remote-panel">
        <div className="mapping-header">
          <div>
            <h3>{isSessionActive ? "Remote session" : "Remote released"}</h3>
            <p className="panel-subtitle">
              {isSessionActive
                ? "Waiting for Apple TV Remote"
                : "Automatic reconnect is paused"}
            </p>
          </div>
          <Radio size={18} className="mapping-header-icon" />
        </div>

        <div className="remote-connect-panel">
          <div className="remote-connect-status">
            {!isSupported
              ? "This Electron build does not expose WebHID."
              : isSessionActive
                ? "Follow the pairing steps below, then connect the remote here."
                : "The Mac will leave the remote alone. Near Apple TV, hold Back and Volume Up for five seconds to pair it there."}
          </div>

          <section className="remote-pairing-guide" aria-label="Pair Apple TV Remote with this Mac">
            <div className="remote-pairing-heading">
              <Bluetooth size={17} strokeWidth={1.8} />
              <div>
                <h4>Pair with this Mac</h4>
                <p>Keep the remote close to your MacBook.</p>
              </div>
            </div>

            <ol className="remote-pairing-steps">
              <li>
                <span className="pairing-step-number">1</span>
                <div>
                  <strong>Open Bluetooth settings</strong>
                  <p>Temporarily unplug Apple TV or move out of range so it cannot reclaim the remote.</p>
                </div>
              </li>
              <li>
                <span className="pairing-step-number">2</span>
                <div>
                  <strong>Hold both buttons for 5 seconds</strong>
                  <div className="remote-pairing-keys" aria-label="Back and Volume Up">
                    <span className="remote-keycap">Back&nbsp; ‹</span>
                    <span className="remote-key-plus">+</span>
                    <span className="remote-keycap">Volume&nbsp; +</span>
                    <span className="remote-key-duration">5 sec</span>
                  </div>
                  <p>Black first-generation remote: use Menu instead of Back.</p>
                </div>
              </li>
              <li>
                <span className="pairing-step-number">3</span>
                <div>
                  <strong>Choose the remote in macOS</strong>
                  <p>Click Connect beside Apple TV Remote, then return here and choose Refresh.</p>
                </div>
              </li>
            </ol>

            <button
              className="btn-revert remote-open-bluetooth"
              onClick={() => void openBluetoothSettings()}
            >
              <Bluetooth size={15} />
              Open Bluetooth Settings
              <ExternalLink size={13} />
            </button>

            <p className="remote-pairing-caveat">
              Apple officially documents pairing this remote with Apple TV; using it as a Mac input is an unofficial workflow.
            </p>
          </section>

          <div className="mapping-actions remote-actions">
            <button
              className="btn-edit"
              disabled={!isSupported || isConnecting}
              onClick={() => onConnectAppleRemote(false)}
            >
              <Radio size={15} />
              {isConnecting ? "Connecting..." : "Connect Remote"}
            </button>
            <button
              className="btn-revert"
              disabled={!isSupported || isConnecting}
              onClick={() => onConnectAppleRemote(true)}
            >
              <Search size={15} /> Find Nearby
            </button>
            <button
              className="btn-revert"
              disabled={!isSupported || isConnecting}
              onClick={() => onRefreshDevices()}
            >
              <RefreshCw size={15} /> Refresh
            </button>
            {isSessionActive && (
              <button
                className="btn-revert"
                disabled={isConnecting}
                onClick={() => void onReleaseAppleRemote()}
              >
                <Unplug size={15} /> Release for Apple TV
              </button>
            )}
          </div>

          {connectionError && (
            <div className="editing-hint remote-error">{connectionError}</div>
          )}
        </div>

      </div>
    );
  }

  return (
    <div className="mapping-panel-content apple-remote-panel">
      <div className="inspector-device-summary">
        <span className="inspector-device-mark" aria-hidden="true">
          <Radio size={16} />
        </span>
        <div className="inspector-device-copy">
          <span className="inspector-live-label">
            <i aria-hidden="true" /> Live input
          </span>
          <h3>{device.name}</h3>
          <p>
            {device.modelInfo.generationLabel} · {device.modelInfo.connectorLabel}
          </p>
        </div>
        <button
          className="btn-revert remote-release-action"
          onClick={() => void onReleaseAppleRemote()}
          title="Release remote for Apple TV"
        >
          <Unplug size={14} /> Release
        </button>
      </div>

      {connectionError && (
        <div className="editing-hint remote-error">{connectionError}</div>
      )}

      <div className="mappings-section">
        <div className="remote-section-header">
          <div className="remote-section-title-group">
            <span className="remote-section-icon" aria-hidden="true">
              <Keyboard size={14} />
            </span>
            <div>
              <h4 className="mappings-section-title">Button mappings</h4>
              <p>{buttonMappings.length} shortcuts active</p>
            </div>
          </div>
          <button
            className="btn-edit remote-small-action"
            disabled={isLearningButton}
            onClick={() => onStartButtonLearning(device.id)}
          >
            <Plus size={13} />
            {isLearningButton ? "Learning..." : "Learn Button"}
          </button>
        </div>

        {isLearningButton && (
          <div className="editing-hint">Press a button on the remote.</div>
        )}

        {hasPendingButton && pendingButtonControl && (
          <div className="remote-editor-block">
            <div className="button-mapping-item editing">
              <div className="direction-label">
                {formatAppleRemoteButtonControl(pendingButtonControl)}
              </div>
              <select
                className="remote-trigger-select"
                value={pendingButtonTrigger}
                onChange={(event) =>
                  setPendingButtonTrigger(
                    event.target.value as AppleRemoteButtonTrigger
                  )
                }
              >
                <option value="press">Press</option>
                <option value="hold">Hold</option>
              </select>
              <select
                className="remote-trigger-select"
                value={pendingButtonOutputMode}
                onChange={(event) =>
                  setPendingButtonOutputMode(
                    event.target.value as AppleRemoteButtonOutputMode
                  )
                }
              >
                <option value="tap">Tap key</option>
                <option value="hold">Hold key while pressed</option>
                <option value="hold-modifiers">Hold shortcut modifiers</option>
              </select>
              <KeyMappingSelector
                currentMapping={null}
                isEditing
                pendingKey={pendingButtonKey}
                onKeyPress={(key, label) => setPendingButtonKey({ key, label })}
              />
            </div>
            {pendingButtonKey ? (
              <MappingActions
                hasUnsavedChanges
                onApplyChanges={() => {
                  onSetButtonMapping(
                    device.id,
                    pendingButtonControl,
                    pendingButtonKey.key,
                    pendingButtonKey.label,
                    pendingButtonTrigger,
                    pendingButtonOutputMode
                  );
                  setPendingButtonKey(null);
                  setPendingButtonTrigger("press");
                  setPendingButtonOutputMode("tap");
                }}
                onRevertChanges={() => {
                  setPendingButtonKey(null);
                  setPendingButtonTrigger("press");
                  setPendingButtonOutputMode("tap");
                  onCancelButtonLearning();
                }}
                onRemoveMapping={() => undefined}
                showRemove={false}
              />
            ) : (
              <div className="mapping-actions">
                <button
                  className="btn-revert"
                  onClick={() => onCancelButtonLearning()}
                >
                  Cancel Learning
                </button>
              </div>
            )}
          </div>
        )}

        {buttonMappings.length > 0 ? (
          <div className="mappings-list">
            {buttonMappings.map((buttonMapping) => (
              <div key={buttonMapping.controlKey} className="mapping-item">
                <div className="mapping-item-label">
                  {formatAppleRemoteButtonControl(buttonMapping.control)}
                </div>
                <div className="mapping-item-value">
                  <span className="mapped-key-small">
                    {formatButtonMappingValue(buttonMapping)}
                  </span>
                  <button
                    className="btn-remove-small"
                    onClick={() =>
                      onRemoveButtonMapping(device.id, buttonMapping.controlKey)
                    }
                    title="Remove mapping"
                    aria-label={`Remove ${formatAppleRemoteButtonControl(buttonMapping.control)} mapping`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          !hasPendingButton && (
            <div className="no-mappings">
              <p>No button mappings configured.</p>
            </div>
          )
        )}
      </div>

      <div className="mappings-section pointer-mappings-section">
        <div className="remote-section-header">
          <div className="remote-section-title-group">
            <span className="remote-section-icon" aria-hidden="true">
              <MousePointer2 size={14} />
            </span>
            <div>
              <h4 className="mappings-section-title">Pointer</h4>
              <p>Touchpad movement and magnetic settling</p>
            </div>
          </div>
          <div className="remote-section-actions">
            {isSilverClickpad && (
              <button
                className="btn-revert remote-small-action"
                disabled={isLearningCursor}
                onClick={() => onStartCursorLearning(device.id, "auto")}
              >
                <RotateCcw size={13} />
                Reset Cursor
              </button>
            )}
            <button
              className="btn-edit remote-small-action"
              disabled={isLearningCursor}
              onClick={() =>
                onStartCursorLearning(
                  device.id,
                  isSilverClickpad ? "touchpad" : "auto"
                )
              }
            >
              <MousePointer2 size={13} />
              {isLearningCursor
                ? "Learning..."
                : isSilverClickpad
                  ? "Learn Touchpad"
                  : "Learn Cursor"}
            </button>
          </div>
        </div>

        {isLearningCursor && (
          <div className="editing-hint">
            {learningCursorMode === "touchpad"
              ? "Move on the remote touch surface."
              : "Move the remote cursor control."}{" "}
            Samples: {cursorSampleCount}
          </div>
        )}

        {pointerAssistControls}

        {draftCursorMapping ? (
          <div className="mouse-control-settings inspector-control-group touchpad-settings">
            <details
              className="inspector-details input-source-details"
              open={showInputSourceDetails}
              onToggle={(event) =>
                setShowInputSourceDetails(event.currentTarget.open)
              }
            >
              <summary className="remote-cursor-summary inspector-details-summary">
                <MousePointer2 size={15} aria-hidden="true" />
                <div>
                  <span>Input source</span>
                  <strong>{formatCursorMappingSummary(draftCursorMapping)}</strong>
                </div>
                <ChevronDown
                  size={14}
                  className="inspector-details-chevron"
                  aria-hidden="true"
                />
              </summary>
              <div className="inspector-details-content">
                <div className="threshold-control inspector-select-control">
                  <label>Tracking mode</label>
                  <select
                    value={draftCursorMapping.mode}
                    onChange={(event) =>
                      updateDraftCursor({
                        mode: event.target.value as AppleRemoteCursorMode,
                      })
                    }
                  >
                    <option value="absolute-delta">Absolute delta</option>
                    <option value="relative-signed">Relative signed</option>
                  </select>
                </div>

                <div className="threshold-control inspector-range-control">
                  <label>Sensitivity</label>
                  <input
                    type="range"
                    min="0.1"
                    max="10.0"
                    step="0.1"
                    value={draftCursorMapping.sensitivity}
                    onChange={(event) =>
                      updateDraftCursor({
                        sensitivity: parseFloat(event.target.value),
                      })
                    }
                  />
                  <span>{draftCursorMapping.sensitivity.toFixed(2)}</span>
                </div>

                {isSilverClickpad && (
                  <div className="threshold-control inspector-range-control">
                    <label>Touch response</label>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={draftCursorMapping.touchpadContactSensitivity}
                      onChange={(event) =>
                        updateDraftCursor({
                          touchpadContactSensitivity: parseFloat(
                            event.target.value
                          ),
                        })
                      }
                    />
                    <span>
                      {draftCursorMapping.touchpadContactSensitivity.toFixed(2)}
                    </span>
                  </div>
                )}

                <div className="inspector-toggle-pair">
                  <div className="threshold-control inspector-toggle-control">
                    <label>Invert X</label>
                    <label className="inspector-switch" title="Invert horizontal movement">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label="Invert horizontal movement"
                        checked={draftCursorMapping.invertX}
                        onChange={(event) =>
                          updateDraftCursor({ invertX: event.target.checked })
                        }
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>

                  <div className="threshold-control inspector-toggle-control">
                    <label>Invert Y</label>
                    <label className="inspector-switch" title="Invert vertical movement">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label="Invert vertical movement"
                        checked={draftCursorMapping.invertY}
                        onChange={(event) =>
                          updateDraftCursor({ invertY: event.target.checked })
                        }
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>
                </div>

                <div className="threshold-control inspector-select-control">
                  <label>Rotation</label>
                  <select
                    value={draftCursorMapping.rotation}
                    onChange={(event) =>
                      updateDraftCursor({
                        rotation: Number(event.target.value) as PointerRotation,
                      })
                    }
                  >
                    {ROTATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <MappingActions
                  hasUnsavedChanges={cursorHasUnsavedChanges}
                  onApplyChanges={() => {
                    onSetCursorMapping(device.id, draftCursorMapping);
                  }}
                  onRevertChanges={() => {
                    onClearPendingCursorMapping();
                    setDraftCursorMapping(
                      mapping?.cursorMapping ? { ...mapping.cursorMapping } : null
                    );
                  }}
                  onRemoveMapping={() => onRemoveCursorMapping(device.id)}
                  showRemove={!!mapping?.cursorMapping || !!pendingCursorMapping}
                />
              </div>
            </details>
          </div>
        ) : (
          !isLearningCursor && (
            <div className="no-mappings">
              <p>No cursor mapping configured.</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
