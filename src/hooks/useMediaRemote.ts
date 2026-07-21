import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "media-remote-mappings";
const OVERRIDE_STORAGE_KEY = "media-remote-system-overrides";
const DEVICE_REFRESH_INTERVAL_MS = 30_000;
const ACTIVE_FEEDBACK_DURATION_MS = 180;

export interface MediaRemoteDeviceState {
  id: string;
  name: string;
  address: string;
  services: string;
  transport: "AVRCP";
}

export interface MediaRemoteMapping {
  deviceId: string;
  key: string;
  label: string;
}

interface MediaRemoteInputEvent {
  type: "play-pause";
  sequence: number;
  timestamp: number;
  deviceId: string | null;
}

interface MediaRemoteStatusEvent {
  success: boolean;
  registered: boolean;
  active: boolean;
  inputCount?: number;
  lastCommand?: string | null;
  error?: string;
}

function isMediaRemoteDevice(value: unknown): value is MediaRemoteDeviceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<MediaRemoteDeviceState>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.address === "string" &&
    typeof record.services === "string" &&
    record.transport === "AVRCP"
  );
}

function isMediaRemoteInputEvent(value: unknown): value is MediaRemoteInputEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<MediaRemoteInputEvent>;
  return (
    record.type === "play-pause" &&
    typeof record.sequence === "number" &&
    typeof record.timestamp === "number" &&
    (record.deviceId === null || typeof record.deviceId === "string")
  );
}

function isMediaRemoteStatusEvent(value: unknown): value is MediaRemoteStatusEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<MediaRemoteStatusEvent>;
  return (
    typeof record.success === "boolean" &&
    typeof record.registered === "boolean" &&
    typeof record.active === "boolean" &&
    (record.inputCount === undefined || typeof record.inputCount === "number") &&
    (record.lastCommand === undefined ||
      record.lastCommand === null ||
      typeof record.lastCommand === "string") &&
    (record.error === undefined || typeof record.error === "string")
  );
}

function loadMappings(): MediaRemoteMapping[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is MediaRemoteMapping => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }

      const record = value as Partial<MediaRemoteMapping>;
      return (
        typeof record.deviceId === "string" &&
        typeof record.key === "string" &&
        typeof record.label === "string"
      );
    });
  } catch {
    return [];
  }
}

function loadOverrideDeviceIds(): string[] {
  try {
    const saved = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? Array.from(
          new Set(parsed.filter((value): value is string => typeof value === "string"))
        )
      : [];
  } catch {
    return [];
  }
}

export function useMediaRemote() {
  const [devices, setDevices] = useState<MediaRemoteDeviceState[]>([]);
  const [mappings, setMappings] = useState<MediaRemoteMapping[]>(loadMappings);
  const [overrideDeviceIds, setOverrideDeviceIds] = useState<string[]>(
    loadOverrideDeviceIds
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [inputCount, setInputCount] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const devicesRef = useRef(devices);
  const mappingsRef = useRef(mappings);
  const overrideDeviceIdsRef = useRef(overrideDeviceIds);
  const activeFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    mappingsRef.current = mappings;
    if (mappings.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
    }
  }, [mappings]);

  useEffect(() => {
    overrideDeviceIdsRef.current = overrideDeviceIds;
    if (overrideDeviceIds.length === 0) {
      localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    } else {
      localStorage.setItem(
        OVERRIDE_STORAGE_KEY,
        JSON.stringify(overrideDeviceIds)
      );
    }
  }, [overrideDeviceIds]);

  const refreshDevices = useCallback(async () => {
    if (!window.ipcRenderer) {
      setDevices([]);
      return;
    }

    setIsRefreshing(true);
    try {
      const result = await window.ipcRenderer.invoke(
        "media-remote-list-devices"
      );
      const nextDevices = Array.isArray(result?.devices)
        ? result.devices.filter(isMediaRemoteDevice)
        : [];
      setDevices(nextDevices);
      setConnectionError(result?.success ? null : (result?.error ?? null));
    } catch (error) {
      setDevices([]);
      setConnectionError(String(error));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const intervalId = window.setInterval(
      () => void refreshDevices(),
      DEVICE_REFRESH_INTERVAL_MS
    );
    const handleFocus = () => void refreshDevices();
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (!window.ipcRenderer) {
      return;
    }

    const listener = (_event: unknown, value: unknown) => {
      if (!isMediaRemoteStatusEvent(value)) {
        return;
      }

      setCaptureEnabled(value.registered && value.active);
      if (typeof value.inputCount === "number") {
        setInputCount(value.inputCount);
      }
      if (value.error) {
        setConnectionError(value.error);
      } else if (value.registered && value.active) {
        setConnectionError(null);
      }
    };

    window.ipcRenderer.on("media-remote-status", listener);
    return () => {
      window.ipcRenderer?.off("media-remote-status", listener);
    };
  }, []);

  useEffect(() => {
    const captureMapping = mappings.find(
      (mapping) =>
        overrideDeviceIds.includes(mapping.deviceId) &&
        devices.some((device) => device.id === mapping.deviceId)
    );
    const shouldCapture = Boolean(captureMapping);

    if (!window.ipcRenderer) {
      setCaptureEnabled(false);
      return;
    }

    let cancelled = false;
    window.ipcRenderer
      .invoke("media-remote-configure", {
        enabled: shouldCapture,
        key: captureMapping?.key ?? null,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setCaptureEnabled(Boolean(result?.registered && result?.active));
        if (!result?.success) {
          setConnectionError(
            result?.error ?? "Unable to capture the macOS Play/Pause key."
          );
        } else {
          setConnectionError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCaptureEnabled(false);
          setConnectionError(String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [devices, mappings, overrideDeviceIds]);

  useEffect(() => {
    if (!window.ipcRenderer) {
      return;
    }

    const listener = (_event: unknown, value: unknown) => {
      if (!isMediaRemoteInputEvent(value)) {
        return;
      }

      setInputCount((current) => Math.max(current, value.sequence));

      const eventDevice = [
        value.deviceId
          ? devicesRef.current.find((device) => device.id === value.deviceId)
          : undefined,
        ...devicesRef.current,
      ].find(
        (device, index, candidates) =>
          !!device &&
          candidates.findIndex((candidate) => candidate?.id === device.id) === index &&
          overrideDeviceIdsRef.current.includes(device.id) &&
          mappingsRef.current.some(
            (candidate) => candidate.deviceId === device.id
          )
      );
      const mapping = eventDevice
        ? mappingsRef.current.find(
            (candidate) => candidate.deviceId === eventDevice.id
          )
        : undefined;

      if (!eventDevice || !mapping) {
        return;
      }

      setActiveDeviceId(eventDevice.id);
      if (activeFeedbackTimerRef.current !== null) {
        window.clearTimeout(activeFeedbackTimerRef.current);
      }
      activeFeedbackTimerRef.current = window.setTimeout(() => {
        setActiveDeviceId(null);
        activeFeedbackTimerRef.current = null;
      }, ACTIVE_FEEDBACK_DURATION_MS);
    };

    window.ipcRenderer.on("media-remote-input", listener);
    return () => {
      window.ipcRenderer?.off("media-remote-input", listener);
      if (activeFeedbackTimerRef.current !== null) {
        window.clearTimeout(activeFeedbackTimerRef.current);
      }
    };
  }, []);

  const getMapping = useCallback(
    (deviceId: string) =>
      mappings.find((mapping) => mapping.deviceId === deviceId),
    [mappings]
  );

  const setMapping = useCallback(
    (deviceId: string, key: string, label: string) => {
      setMappings((current) => [
        ...current.filter((mapping) => mapping.deviceId !== deviceId),
        { deviceId, key, label },
      ]);
    },
    []
  );

  const removeMapping = useCallback((deviceId: string) => {
    setMappings((current) =>
      current.filter((mapping) => mapping.deviceId !== deviceId)
    );
    setOverrideDeviceIds((current) =>
      current.filter((candidate) => candidate !== deviceId)
    );
  }, []);

  const isOverrideEnabled = useCallback(
    (deviceId: string) => overrideDeviceIds.includes(deviceId),
    [overrideDeviceIds]
  );

  const setOverrideEnabled = useCallback(
    (deviceId: string, enabled: boolean) => {
      setOverrideDeviceIds((current) =>
        enabled
          ? Array.from(new Set([...current, deviceId]))
          : current.filter((candidate) => candidate !== deviceId)
      );
    },
    []
  );

  return {
    devices,
    mappings,
    isRefreshing,
    captureEnabled,
    inputCount,
    connectionError,
    activeDeviceId,
    refreshDevices,
    getMapping,
    setMapping,
    removeMapping,
    isOverrideEnabled,
    setOverrideEnabled,
  };
}
