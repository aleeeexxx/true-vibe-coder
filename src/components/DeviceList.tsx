import { Headphones, Radio, RefreshCw, Unplug, Wifi } from "lucide-react";
import { AppleRemoteDeviceState } from "../hooks/useAppleRemote";
import { MediaRemoteDeviceState } from "../hooks/useMediaRemote";
import "./DeviceList.css";

interface DeviceListProps {
  appleRemotes: AppleRemoteDeviceState[];
  mediaRemotes: MediaRemoteDeviceState[];
  selectedAppleRemoteId: string | null;
  selectedMediaRemoteId: string | null;
  isAppleRemoteSupported: boolean;
  isAppleRemoteConnecting: boolean;
  isAppleRemoteSessionActive: boolean;
  isMediaRemoteRefreshing: boolean;
  isMediaRemoteCaptureEnabled: boolean;
  onSelectAppleRemote: (id: string) => void;
  onSelectMediaRemote: (id: string) => void;
  onConnectAppleRemote: () => void;
  onReleaseAppleRemote: () => void;
  onRefreshMediaRemotes: () => void;
}

export function DeviceList({
  appleRemotes,
  mediaRemotes,
  selectedAppleRemoteId,
  selectedMediaRemoteId,
  isAppleRemoteSupported,
  isAppleRemoteConnecting,
  isAppleRemoteSessionActive,
  isMediaRemoteRefreshing,
  isMediaRemoteCaptureEnabled,
  onSelectAppleRemote,
  onSelectMediaRemote,
  onConnectAppleRemote,
  onReleaseAppleRemote,
  onRefreshMediaRemotes,
}: DeviceListProps) {
  const remoteIsConnected = appleRemotes.length > 0;

  return (
    <aside className="device-panel">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <Radio size={18} strokeWidth={1.8} />
        </div>
        <div>
          <div className="brand-name">ture vibe coder</div>
          <div className="brand-tagline">Code from wherever the vibe is right.</div>
        </div>
      </div>

      <div className="device-list">
        <div className="device-section-heading">
          <span>Remote</span>
          <span
            className={`session-state ${remoteIsConnected ? "is-live" : ""}`}
          >
            {remoteIsConnected ? "Live" : isAppleRemoteSessionActive ? "Ready" : "Released"}
          </span>
        </div>

        {remoteIsConnected ? (
          <>
            {appleRemotes.map((remote) => (
              <button
                key={remote.id}
                className={`device-item remote-device-item ${
                  selectedAppleRemoteId === remote.id ? "active" : ""
                }`}
                onClick={() => onSelectAppleRemote(remote.id)}
              >
                <div className="device-icon remote-device-icon">
                  <Radio size={18} strokeWidth={1.8} />
                </div>
                <div className="device-info">
                  <div className="device-name">{remote.name}</div>
                  <div className="device-id">
                    {remote.modelInfo.generationLabel} · {remote.modelInfo.connectorLabel}
                  </div>
                </div>
                <div className="device-status" title="Connected to this Mac" />
              </button>
            ))}
            <button className="release-remote-button" onClick={onReleaseAppleRemote}>
              <Unplug size={15} strokeWidth={1.9} />
              Release for Apple TV
            </button>
          </>
        ) : (
          <div className="remote-connect-sidebar">
            <div className="remote-idle-orbit" aria-hidden="true">
              <Wifi size={20} strokeWidth={1.6} />
            </div>
            <p>
              {isAppleRemoteSessionActive
                ? "Your Mac is ready for the remote."
                : "The remote is free to pair with Apple TV."}
            </p>
            <button
              className="device-connect-button"
              disabled={!isAppleRemoteSupported || isAppleRemoteConnecting}
              onClick={onConnectAppleRemote}
            >
              <Radio size={15} strokeWidth={1.9} />
              {isAppleRemoteConnecting ? "Connecting..." : "Connect to this Mac"}
            </button>
            {isAppleRemoteSessionActive && (
              <button className="release-remote-button release-while-waiting" onClick={onReleaseAppleRemote}>
                <Unplug size={15} strokeWidth={1.9} />
                Release for Apple TV
              </button>
            )}
          </div>
        )}

        <div className="device-section-heading headset-section-heading">
          <span>Headset controls</span>
          <span className={`session-state ${isMediaRemoteCaptureEnabled ? "is-live" : ""}`}>
            {mediaRemotes.length > 0 ? (isMediaRemoteCaptureEnabled ? "Mapped" : "Ready") : "0"}
          </span>
        </div>

        {mediaRemotes.length > 0 ? (
          mediaRemotes.map((device) => (
            <button
              key={device.id}
              className={`device-item headset-device-item ${
                selectedMediaRemoteId === device.id ? "active" : ""
              }`}
              onClick={() => onSelectMediaRemote(device.id)}
            >
              <div className="device-icon headset-device-icon">
                <Headphones size={18} strokeWidth={1.8} />
              </div>
              <div className="device-info">
                <div className="device-name">{device.name}</div>
                <div className="device-id">Play / Pause · AVRCP</div>
              </div>
              <div className="device-status" title="Connected by Bluetooth" />
            </button>
          ))
        ) : (
          <div className="headset-empty-state">
            <Headphones size={16} strokeWidth={1.5} />
            <span>Connect a Shokz headset in Bluetooth.</span>
            <button
              type="button"
              onClick={onRefreshMediaRemotes}
              title="Refresh headset controls"
              disabled={isMediaRemoteRefreshing}
            >
              <RefreshCw size={14} className={isMediaRemoteRefreshing ? "is-spinning" : ""} />
            </button>
          </div>
        )}

      </div>

      <div className="sidebar-footnote">
        ture vibe coder stays available when this window is closed.
      </div>
    </aside>
  );
}
