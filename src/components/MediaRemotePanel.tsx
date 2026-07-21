import { AlertCircle, Headphones, Keyboard, Music2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  MediaRemoteDeviceState,
  MediaRemoteMapping,
} from "../hooks/useMediaRemote";
import { KeyMappingSelector } from "./KeyMappingSelector";
import { MappingActions } from "./MappingActions";
import "./MappingPanel.css";

interface MediaRemotePanelProps {
  device: MediaRemoteDeviceState;
  mapping?: MediaRemoteMapping;
  captureEnabled: boolean;
  inputCount: number;
  overrideEnabled: boolean;
  isActive: boolean;
  isRefreshing: boolean;
  connectionError: string | null;
  onRefresh: () => Promise<void>;
  onSetMapping: (deviceId: string, key: string, label: string) => void;
  onRemoveMapping: (deviceId: string) => void;
  onSetOverrideEnabled: (deviceId: string, enabled: boolean) => void;
}

export function MediaRemotePanel({
  device,
  mapping,
  captureEnabled,
  inputCount,
  overrideEnabled,
  isActive,
  isRefreshing,
  connectionError,
  onRefresh,
  onSetMapping,
  onRemoveMapping,
  onSetOverrideEnabled,
}: MediaRemotePanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [pendingKey, setPendingKey] = useState<{
    key: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    setIsEditing(false);
    setPendingKey(null);
  }, [device.id]);

  const hasUnsavedChanges =
    !!pendingKey &&
    (pendingKey.key !== mapping?.key || pendingKey.label !== mapping?.label);

  const beginEditing = () => {
    setPendingKey(mapping ? { key: mapping.key, label: mapping.label } : null);
    setIsEditing(true);
  };

  const revertChanges = () => {
    setPendingKey(null);
    setIsEditing(false);
  };

  const applyChanges = () => {
    if (!pendingKey) {
      return;
    }

    onSetMapping(device.id, pendingKey.key, pendingKey.label);
    setPendingKey(null);
    setIsEditing(false);
  };

  return (
    <div className="apple-remote-panel media-remote-panel">
      <div className="inspector-device-summary">
        <span className="inspector-device-mark" aria-hidden="true">
          <Headphones size={17} />
        </span>
        <div className="inspector-device-copy">
          <span className="mapping-label">Headset control</span>
          <h3>{device.name}</h3>
          <p>Bluetooth AVRCP · {device.address}</p>
        </div>
        <span className="inspector-live-label">
          <i aria-hidden="true" /> Connected
        </span>
      </div>

      <div className="inspector-control-group media-system-override">
        <div className="inspector-setting-head">
          <div className="inspector-setting-title">
            <span className="inspector-setting-icon" aria-hidden="true">
              <Music2 size={15} />
            </span>
            <div>
              <h5>Override system Play/Pause</h5>
              <p>
                {mapping
                  ? `Keep Mac active, bypass Music, and send ${mapping.label}.`
                  : "Set a shortcut before enabling override."}
              </p>
            </div>
          </div>
          <label
            className="inspector-switch"
            title={mapping ? "Override system Play/Pause" : "Set a shortcut first"}
          >
            <input
              type="checkbox"
              role="switch"
              aria-label="Override system Play/Pause"
              checked={overrideEnabled}
              disabled={!mapping}
              onChange={(event) =>
                onSetOverrideEnabled(device.id, event.target.checked)
              }
            />
            <span aria-hidden="true" />
          </label>
        </div>
      </div>

      <section className="mappings-section media-remote-mapping-section">
        <div className="remote-section-header">
          <div className="remote-section-title-group">
            <span className="remote-section-icon" aria-hidden="true">
              <Keyboard size={14} />
            </span>
            <div>
              <h4 className="mappings-section-title">Play / Pause output</h4>
              <p>Send one key or keyboard combination.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-revert remote-small-action"
            onClick={() => void onRefresh()}
            disabled={isRefreshing}
            title="Refresh Bluetooth devices"
          >
            <RefreshCw size={13} className={isRefreshing ? "is-spinning" : ""} />
          </button>
        </div>

        <div className={`button-mapping-item media-button-mapping ${isActive ? "is-input-active" : ""}`}>
          <div className="mapping-item-heading">
            <div>
              <span className="mapping-label">Headset button</span>
              <strong>Play / Pause</strong>
            </div>
            {isActive && <span className="media-input-feedback">Pressed</span>}
          </div>

          <KeyMappingSelector
            currentMapping={mapping ?? null}
            isEditing={isEditing}
            pendingKey={pendingKey}
            onKeyPress={(key, label) => setPendingKey({ key, label })}
          />

          {!isEditing && (
            <button type="button" className="btn-edit media-edit-button" onClick={beginEditing}>
              {mapping ? "Edit mapping" : "Set mapping"}
            </button>
          )}

          {isEditing && !hasUnsavedChanges && (
            <button type="button" className="btn-revert media-cancel-button" onClick={revertChanges}>
              Cancel
            </button>
          )}

          <MappingActions
            hasUnsavedChanges={hasUnsavedChanges}
            onApplyChanges={applyChanges}
            onRevertChanges={revertChanges}
            onRemoveMapping={() => {
              onRemoveMapping(device.id);
              revertChanges();
            }}
            showRemove={!!mapping && !isEditing}
          />
        </div>
      </section>

      <div className={`media-capture-status ${connectionError ? "has-error" : ""}`}>
        {connectionError ? (
          <>
            <AlertCircle size={15} />
            <span>{connectionError}</span>
          </>
        ) : (
          <>
            <span className={`media-capture-dot ${captureEnabled ? "is-live" : ""}`} />
            <span>
              {captureEnabled
                ? `System media is bypassed. Play/Pause sends ${mapping?.label ?? "the mapped shortcut"}. Native inputs: ${inputCount}.`
                : mapping
                  ? "System media remains active. Turn on override to use the shortcut."
                  : "The original media action stays unchanged until mapped."}
            </span>
          </>
        )}
      </div>

      <p className="media-remote-caveat">
        macOS presents Play/Pause as one system media input, so the same key on a keyboard or another headset can also use this mapping while it is active.
      </p>
    </div>
  );
}
