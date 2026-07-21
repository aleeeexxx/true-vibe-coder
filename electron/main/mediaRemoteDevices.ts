export interface MediaRemoteDeviceCandidate {
  id: string;
  name: string;
  address: string;
  services: string;
  transport: "AVRCP";
}

const SHOKZ_NAME_PATTERN =
  /(?:shokz|aftershokz|openrun|opencomm|openswim|openfit)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const address = value.trim().toUpperCase();
  return /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(address)
    ? address
    : null;
}

export function findConnectedShokzMediaRemotes(
  profile: unknown
): MediaRemoteDeviceCandidate[] {
  if (!isRecord(profile)) {
    return [];
  }

  const bluetoothEntries = profile.SPBluetoothDataType;
  if (!Array.isArray(bluetoothEntries)) {
    return [];
  }

  const devices = new Map<string, MediaRemoteDeviceCandidate>();

  bluetoothEntries.forEach((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.device_connected)) {
      return;
    }

    entry.device_connected.forEach((deviceGroup) => {
      if (!isRecord(deviceGroup)) {
        return;
      }

      Object.entries(deviceGroup).forEach(([name, rawDetails]) => {
        if (!SHOKZ_NAME_PATTERN.test(name) || !isRecord(rawDetails)) {
          return;
        }

        const address = normalizeAddress(rawDetails.device_address);
        const services =
          typeof rawDetails.device_services === "string"
            ? rawDetails.device_services
            : "";

        if (!address || !/AVRCP/i.test(services)) {
          return;
        }

        const id = `media-remote:${address.toLowerCase()}`;
        devices.set(id, {
          id,
          name,
          address,
          services,
          transport: "AVRCP",
        });
      });
    });
  });

  return Array.from(devices.values()).sort((first, second) =>
    first.name.localeCompare(second.name)
  );
}
