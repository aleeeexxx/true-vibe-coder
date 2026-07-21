import { CircleCheck, Headphones, SlidersHorizontal, Sofa } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import "./App.css";
import {
  AppleRemoteWorkspace,
  PointerAssistTestPad,
} from "./components/AppleRemoteWorkspace";
import { AppleRemotePanel } from "./components/AppleRemotePanel";
import { DeviceList } from "./components/DeviceList";
import { MediaRemotePanel } from "./components/MediaRemotePanel";
import { MediaRemoteWorkspace } from "./components/MediaRemoteWorkspace";
import { useAppleRemote } from "./hooks/useAppleRemote";
import { useMediaRemote } from "./hooks/useMediaRemote";
import type {
  PointerAssistConfig,
  PointerAssistVisualState,
} from "./types/global";
import "./theme.css";

const POINTER_ASSIST_STORAGE_KEY = "pointer-assist-config";

const DEFAULT_POINTER_ASSIST_CONFIG: PointerAssistConfig = {
  enabled: false,
  radius: 118,
  strength: 0.78,
  snapThreshold: 28,
};

const DEFAULT_POINTER_ASSIST_STATE: PointerAssistVisualState = {
  enabled: false,
  locked: false,
  targetId: null,
  targetRole: null,
  targetKind: null,
  targetRect: null,
  reason: "initial",
};

function isPointerAssistVisualState(
  value: unknown
): value is PointerAssistVisualState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<PointerAssistVisualState>;
  return (
    typeof record.enabled === "boolean" &&
    typeof record.locked === "boolean" &&
    (record.targetId === null || typeof record.targetId === "string") &&
    (record.targetRole === null || typeof record.targetRole === "string") &&
    (record.targetKind === null || typeof record.targetKind === "string")
  );
}

function normalizePointerAssistConfig(value: unknown): PointerAssistConfig {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<PointerAssistConfig>)
      : {};

  return {
    enabled: Boolean(record.enabled),
    radius: Math.max(
      DEFAULT_POINTER_ASSIST_CONFIG.radius,
      Math.min(260, Number(record.radius ?? DEFAULT_POINTER_ASSIST_CONFIG.radius))
    ),
    strength: Math.max(
      DEFAULT_POINTER_ASSIST_CONFIG.strength,
      Math.min(1, Number(record.strength ?? DEFAULT_POINTER_ASSIST_CONFIG.strength))
    ),
    snapThreshold: Math.max(
      DEFAULT_POINTER_ASSIST_CONFIG.snapThreshold,
      Math.min(
        120,
        Number(record.snapThreshold ?? DEFAULT_POINTER_ASSIST_CONFIG.snapThreshold)
      )
    ),
  };
}

function loadPointerAssistConfig(): PointerAssistConfig {
  try {
    const saved = localStorage.getItem(POINTER_ASSIST_STORAGE_KEY);
    return saved
      ? normalizePointerAssistConfig(JSON.parse(saved))
      : DEFAULT_POINTER_ASSIST_CONFIG;
  } catch {
    return DEFAULT_POINTER_ASSIST_CONFIG;
  }
}

function App() {
  const [pointerAssistConfig, setPointerAssistConfig] =
    useState<PointerAssistConfig>(loadPointerAssistConfig);
  const [pointerAssistState, setPointerAssistState] =
    useState<PointerAssistVisualState>(DEFAULT_POINTER_ASSIST_STATE);
  const togglePointerAssist = useCallback(() => {
    setPointerAssistConfig((current) =>
      normalizePointerAssistConfig({ ...current, enabled: !current.enabled })
    );
  }, []);
  const appleRemote = useAppleRemote({
    onTogglePointerAssist: togglePointerAssist,
  });
  const mediaRemote = useMediaRemote();
  const [selectedAppleRemoteId, setSelectedAppleRemoteId] = useState<
    string | null
  >(null);
  const [selectedMediaRemoteId, setSelectedMediaRemoteId] = useState<
    string | null
  >(null);

  useEffect(() => {
    localStorage.setItem(
      POINTER_ASSIST_STORAGE_KEY,
      JSON.stringify(pointerAssistConfig)
    );
    window.mouseSimulator?.configurePointerAssist?.(pointerAssistConfig).catch(
      (error) => {
        console.error("Failed to configure pointer assist:", error);
      }
    );
  }, [pointerAssistConfig]);

  useEffect(() => {
    window.mouseSimulator?.getPointerAssistState?.()
      .then((result) => {
        if (result?.state && isPointerAssistVisualState(result.state)) {
          setPointerAssistState(result.state);
        }
      })
      .catch((error) => {
        console.error("Failed to read pointer assist state:", error);
      });

    if (!window.ipcRenderer) {
      return;
    }

    const listener = (_event: unknown, state: unknown) => {
      if (isPointerAssistVisualState(state)) {
        setPointerAssistState(state);
      }
    };

    window.ipcRenderer.on("pointer-assist-state", listener);
    return () => {
      window.ipcRenderer?.off("pointer-assist-state", listener);
    };
  }, []);

  useEffect(() => {
    if (
      selectedAppleRemoteId !== null &&
      !appleRemote.devices.some((remote) => remote.id === selectedAppleRemoteId)
    ) {
      setSelectedAppleRemoteId(null);
    }
  }, [appleRemote.devices, selectedAppleRemoteId]);

  useEffect(() => {
    if (
      selectedMediaRemoteId !== null &&
      !mediaRemote.devices.some((device) => device.id === selectedMediaRemoteId)
    ) {
      setSelectedMediaRemoteId(null);
    }
  }, [mediaRemote.devices, selectedMediaRemoteId]);

  // Automatically select the first available input source.
  useEffect(() => {
    if (
      selectedAppleRemoteId !== null ||
      selectedMediaRemoteId !== null
    ) {
      return;
    }

    if (appleRemote.devices.length > 0) {
      setSelectedAppleRemoteId(appleRemote.devices[0].id);
      return;
    }

    if (mediaRemote.devices.length > 0) {
      setSelectedMediaRemoteId(mediaRemote.devices[0].id);
    }
  }, [
    appleRemote.devices,
    mediaRemote.devices,
    selectedAppleRemoteId,
    selectedMediaRemoteId,
  ]);
  const selectedAppleRemote = appleRemote.devices.find(
    (remote) => remote.id === selectedAppleRemoteId
  );
  const selectedAppleRemoteMapping = selectedAppleRemote
    ? appleRemote.getMapping(selectedAppleRemote.id)
    : undefined;
  const selectedMediaRemote = mediaRemote.devices.find(
    (device) => device.id === selectedMediaRemoteId
  );
  const selectedMediaRemoteMapping = selectedMediaRemote
    ? mediaRemote.getMapping(selectedMediaRemote.id)
    : undefined;
  const selectedTouchpadVisualState =
    selectedAppleRemote &&
    appleRemote.touchpadVisualState?.deviceId === selectedAppleRemote.id
      ? appleRemote.touchpadVisualState
      : null;
  const handleSelectAppleRemote = (id: string) => {
    setSelectedAppleRemoteId(id);
    setSelectedMediaRemoteId(null);
  };

  const handleSelectMediaRemote = (id: string) => {
    setSelectedMediaRemoteId(id);
    setSelectedAppleRemoteId(null);
  };

  const handleConnectAppleRemote = useCallback(
    async (allowAnyHidDevice = false) => {
      const remoteId = await appleRemote.connectAppleRemote(allowAnyHidDevice);
      if (remoteId) {
        handleSelectAppleRemote(remoteId);
      }
      return remoteId;
    },
    [appleRemote]
  );

  const handleReleaseAppleRemote = useCallback(async () => {
    await appleRemote.releaseAppleRemote();
    setSelectedAppleRemoteId(null);
  }, [appleRemote]);

  return (
    <div className="app">
      <div className="app-container">
        <DeviceList
          appleRemotes={appleRemote.devices}
          mediaRemotes={mediaRemote.devices}
          selectedAppleRemoteId={
            selectedAppleRemote ? selectedAppleRemote.id : null
          }
          selectedMediaRemoteId={
            selectedMediaRemote ? selectedMediaRemote.id : null
          }
          isAppleRemoteSupported={appleRemote.isSupported}
          isAppleRemoteConnecting={appleRemote.isConnecting}
          isAppleRemoteSessionActive={appleRemote.isSessionActive}
          isMediaRemoteRefreshing={mediaRemote.isRefreshing}
          isMediaRemoteCaptureEnabled={mediaRemote.captureEnabled}
          onSelectAppleRemote={handleSelectAppleRemote}
          onSelectMediaRemote={handleSelectMediaRemote}
          onConnectAppleRemote={() => {
            void handleConnectAppleRemote(false);
          }}
          onReleaseAppleRemote={() => {
            void handleReleaseAppleRemote();
          }}
          onRefreshMediaRemotes={() => {
            void mediaRemote.refreshDevices();
          }}
        />

        <main className="visualization-panel">
          {selectedAppleRemote && (
            <>
              <div className="panel-header">
                <div className="panel-title-group">
                  <span className="panel-kicker">Remote workspace</span>
                  <h2>{selectedAppleRemote.name}</h2>
                  <p className="panel-subtitle">
                    {selectedAppleRemote.modelInfo.generationLabel} ·{" "}
                    {selectedAppleRemote.modelInfo.connectorLabel}
                  </p>
                </div>
                <div className="panel-status is-live">
                  <CircleCheck size={14} /> Live on this Mac
                </div>
              </div>
              <div className="visualization-content">
                <AppleRemoteWorkspace
                  device={selectedAppleRemote}
                  mapping={selectedAppleRemoteMapping}
                  activeButtonStates={appleRemote.activeButtonStates}
                  touchpadVisualState={selectedTouchpadVisualState}
                  pointerAssistConfig={pointerAssistConfig}
                  pointerAssistState={pointerAssistState}
                />
              </div>
            </>
          )}

          {selectedMediaRemote && (
            <>
              <div className="panel-header">
                <div className="panel-title-group">
                  <span className="panel-kicker">Headset control</span>
                  <h2>{selectedMediaRemote.name}</h2>
                  <p className="panel-subtitle">Bluetooth AVRCP · Play / Pause</p>
                </div>
                <div className="panel-status is-live">
                  <Headphones size={14} /> Connected
                </div>
              </div>
              <div className="visualization-content">
                <MediaRemoteWorkspace
                  device={selectedMediaRemote}
                  mapping={selectedMediaRemoteMapping}
                  isActive={mediaRemote.activeDeviceId === selectedMediaRemote.id}
                  captureEnabled={mediaRemote.captureEnabled}
                  overrideEnabled={mediaRemote.isOverrideEnabled(
                    selectedMediaRemote.id
                  )}
                />
              </div>
            </>
          )}

          {!selectedAppleRemote && !selectedMediaRemote && (
            <div className="selection-empty-state">
              <div className="selection-empty-copy">
                <div className="empty-state-icon"><Sofa size={30} strokeWidth={1.4} /></div>
                <h1>Your remote workspace is quiet</h1>
                <p>Connect a remote from the sidebar.</p>
              </div>
              <PointerAssistTestPad
                pointerAssistConfig={pointerAssistConfig}
                pointerAssistState={pointerAssistState}
              />
            </div>
          )}
        </main>

        <aside className="mapping-panel">
          <div className="panel-header">
            <div className="panel-title-group compact">
              <span className="panel-kicker">Control inspector</span>
              <h2>Controls</h2>
              <p className="panel-subtitle">
                {selectedAppleRemote
                  ? `${selectedAppleRemote.name} · Ready`
                  : selectedMediaRemote
                    ? `${selectedMediaRemote.name} · Media button`
                    : "Choose an input to begin"}
              </p>
            </div>
            <span className="inspector-header-icon" aria-hidden="true">
              <SlidersHorizontal size={16} />
            </span>
          </div>
          <div className="mapping-content">
            {selectedAppleRemote || !selectedMediaRemote ? (
              <AppleRemotePanel
                device={selectedAppleRemote}
                mapping={selectedAppleRemoteMapping}
                isSupported={appleRemote.isSupported}
                isConnecting={appleRemote.isConnecting}
                isSessionActive={appleRemote.isSessionActive}
                connectionError={appleRemote.connectionError}
                learningButtonDeviceId={appleRemote.learningButtonDeviceId}
                pendingButtonControl={appleRemote.pendingButtonControl}
                learningCursorDeviceId={appleRemote.learningCursorDeviceId}
                learningCursorMode={appleRemote.learningCursorMode}
                pendingCursorMapping={appleRemote.pendingCursorMapping}
                cursorSampleCount={appleRemote.cursorSampleCount}
                pointerAssistConfig={pointerAssistConfig}
                onSetPointerAssistConfig={(updates) =>
                  setPointerAssistConfig((current) =>
                    normalizePointerAssistConfig({ ...current, ...updates })
                  )
                }
                onConnectAppleRemote={handleConnectAppleRemote}
                onReleaseAppleRemote={appleRemote.releaseAppleRemote}
                onRefreshDevices={appleRemote.refreshDevices}
                onStartButtonLearning={appleRemote.startButtonLearning}
                onCancelButtonLearning={appleRemote.cancelButtonLearning}
                onSetButtonMapping={appleRemote.setButtonMapping}
                onRemoveButtonMapping={appleRemote.removeButtonMapping}
                onStartCursorLearning={appleRemote.startCursorLearning}
                onSetCursorMapping={appleRemote.setCursorMapping}
                onRemoveCursorMapping={appleRemote.removeCursorMapping}
                onClearPendingCursorMapping={
                  appleRemote.clearPendingCursorMapping
                }
              />
            ) : (
              <MediaRemotePanel
                device={selectedMediaRemote}
                mapping={selectedMediaRemoteMapping}
                captureEnabled={mediaRemote.captureEnabled}
                inputCount={mediaRemote.inputCount}
                overrideEnabled={mediaRemote.isOverrideEnabled(
                  selectedMediaRemote.id
                )}
                isActive={mediaRemote.activeDeviceId === selectedMediaRemote.id}
                isRefreshing={mediaRemote.isRefreshing}
                connectionError={mediaRemote.connectionError}
                onRefresh={mediaRemote.refreshDevices}
                onSetMapping={mediaRemote.setMapping}
                onRemoveMapping={mediaRemote.removeMapping}
                onSetOverrideEnabled={mediaRemote.setOverrideEnabled}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
