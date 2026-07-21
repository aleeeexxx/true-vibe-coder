import { Headphones, Pause, Play } from "lucide-react";
import type {
  MediaRemoteDeviceState,
  MediaRemoteMapping,
} from "../hooks/useMediaRemote";

interface MediaRemoteWorkspaceProps {
  device: MediaRemoteDeviceState;
  mapping?: MediaRemoteMapping;
  isActive: boolean;
  captureEnabled: boolean;
  overrideEnabled: boolean;
}

export function MediaRemoteWorkspace({
  device,
  mapping,
  isActive,
  captureEnabled,
  overrideEnabled,
}: MediaRemoteWorkspaceProps) {
  return (
    <div className="media-remote-workspace">
      <div
        className={`headset-visual ${isActive ? "is-active" : ""}`}
        aria-label={`${device.name} Play/Pause control`}
      >
        <div className="headset-signal headset-signal-outer" aria-hidden="true" />
        <div className="headset-signal headset-signal-inner" aria-hidden="true" />
        <div className="headset-device-mark" aria-hidden="true">
          <Headphones size={76} strokeWidth={1.35} />
        </div>
        <div className="headset-media-control">
          <Play size={21} fill="currentColor" strokeWidth={1.6} />
          <span className="headset-control-divider" />
          <Pause size={21} fill="currentColor" strokeWidth={1.6} />
        </div>
      </div>

      <div className="media-remote-visual-copy">
        <span className={`media-remote-live-state ${captureEnabled ? "is-live" : ""}`}>
          <i aria-hidden="true" />
          {captureEnabled ? "Shortcut mode" : "System default"}
        </span>
        <h3>Play / Pause</h3>
        <p>
          {mapping && overrideEnabled
            ? `System media bypassed · Sends ${mapping.label}`
            : mapping
              ? `Mapped to ${mapping.label} · Override is off`
            : "Choose an output in the control inspector."}
        </p>
      </div>
    </div>
  );
}
