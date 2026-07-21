# ture vibe coder

ture vibe coder turns an Apple TV Remote into a relaxed macOS input surface for keyboard shortcuts, pointer movement, scrolling, and small-target snapping. It is designed for light work, coding, and media control from a sofa or across the room.

## Highlights

- Apple TV Remote button, hold, shortcut, click, and touch-surface mapping
- Magnetic pointer assistance for small accessible controls
- A deliberate Release action that closes WebHID and native HID access before pairing the remote back to Apple TV
- Live remote and touch feedback
- Persistent remote and headset mappings
- Menu bar availability when the main window is closed

## Remote handoff

The physical Apple TV Remote does not provide AirPods-style automatic switching between Mac and Apple TV. Use **Release for Apple TV** in ture vibe coder before pairing it to Apple TV. To return it to Apple TV, place it close to the Apple TV and hold Back and Volume Up for five seconds.

To return it to the Mac, open System Settings → Bluetooth, then temporarily unplug the Apple TV or move the remote out of its range. On a silver second- or third-generation remote, hold Back and Volume Up for five seconds. On a black first-generation remote, hold Menu and Volume Up. Choose Connect when the remote appears, then return to ture vibe coder and choose Refresh or Connect Remote. Apple officially documents pairing this remote with Apple TV; using it as a Mac input is an unofficial workflow.

## Development

```bash
npm install
npm run dev
```

Build the macOS helper and desktop package with:

```bash
npm run build
```

The native Apple Remote helper lives in `helpers/apple-remote-helper.swift`. Renderer input handling is in `src/hooks/useAppleRemote.ts`, while keyboard, mouse, pointer assistance, and helper lifecycle are managed in `electron/main/index.ts`.

## License

MIT. See `LICENSE` for the original copyright notice and terms.
