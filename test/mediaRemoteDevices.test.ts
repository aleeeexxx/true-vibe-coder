import { describe, expect, it } from "vitest";
import { findConnectedShokzMediaRemotes } from "../electron/main/mediaRemoteDevices";

describe("findConnectedShokzMediaRemotes", () => {
  it("returns connected Shokz AVRCP headsets as separate logical devices", () => {
    const devices = findConnectedShokzMediaRemotes({
      SPBluetoothDataType: [
        {
          device_connected: [
            {
              "OpenRun Pro 2 by Shokz": {
                device_address: "A0:0C:E2:D4:D2:C0",
                device_minorType: "Headset",
                device_services: "0x900019 < HFP AVRCP A2DP GATT ACL >",
              },
            },
          ],
          device_not_connected: [
            {
              "OpenComm by Shokz": {
                device_address: "11:22:33:44:55:66",
                device_services: "0x900019 < AVRCP A2DP >",
              },
            },
          ],
        },
      ],
    });

    expect(devices).toEqual([
      {
        id: "media-remote:a0:0c:e2:d4:d2:c0",
        name: "OpenRun Pro 2 by Shokz",
        address: "A0:0C:E2:D4:D2:C0",
        services: "0x900019 < HFP AVRCP A2DP GATT ACL >",
        transport: "AVRCP",
      },
    ]);
  });

  it("ignores non-Shokz devices and Shokz devices without AVRCP", () => {
    const devices = findConnectedShokzMediaRemotes({
      SPBluetoothDataType: [
        {
          device_connected: [
            {
              "Other Headphones": {
                device_address: "11:22:33:44:55:66",
                device_services: "0x900019 < AVRCP A2DP >",
              },
            },
            {
              "OpenFit Air by Shokz": {
                device_address: "22:33:44:55:66:77",
                device_services: "0x400000 < BLE >",
              },
            },
          ],
        },
      ],
    });

    expect(devices).toEqual([]);
  });
});
