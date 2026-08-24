export interface KeySimulator {
  keyToggle: (key: string, down: boolean) => Promise<{ success: boolean; error?: string }>
  keyShortcutHoldToggle: (key: string, down: boolean) => Promise<{ success: boolean; error?: string }>
  keyTap: (key: string) => Promise<{ success: boolean; error?: string }>
}

export interface PointerAssistConfig {
  enabled: boolean
  radius: number
  strength: number
  snapThreshold: number
}

export interface PointerAssistNudgeOptions {
  heldMs?: number
  repeatIndex?: number
  phase?: 'press' | 'repeat' | 'release'
}

export interface PointerAssistVisualState {
  enabled: boolean
  locked: boolean
  targetId: string | null
  targetRole: string | null
  targetKind: string | null
  targetRect: { x: number; y: number; width: number; height: number } | null
  clickRegion: { x: number; y: number; width: number; height: number } | null
  reason: string
}

export interface MouseSimulator {
  moveMouse: (deltaX: number, deltaY: number) => Promise<{ success: boolean; error?: string }>
  scrollPixels: (deltaY: number) => Promise<{ success: boolean; error?: string }>
  buttonToggle: (button: string, down: boolean) => Promise<{ success: boolean; error?: string }>
  configurePointerAssist?: (config: PointerAssistConfig) => Promise<{ success: boolean; config?: PointerAssistConfig; error?: string }>
  getPointerAssistConfig?: () => Promise<{ success: boolean; config?: PointerAssistConfig; error?: string }>
  getPointerAssistState?: () => Promise<{ success: boolean; state?: PointerAssistVisualState; error?: string }>
  pointerAssistNudge?: (direction: "up" | "down" | "left" | "right", options?: PointerAssistNudgeOptions) => Promise<{ success: boolean; handled: boolean; action?: "jump" | "scroll" | "scroll-stop"; error?: string }>
  endPointerAssistGesture?: () => Promise<{ success: boolean; handled: boolean; targetId?: string; error?: string }>
}

export interface IpcRenderer {
  on(channel: string, listener: (event: any, ...args: any[]) => void): void
  off(channel: string, listener: (...args: any[]) => void): void
  send(channel: string, ...args: any[]): void
  invoke(channel: string, ...args: any[]): Promise<any>
}

declare global {
  interface HIDDeviceFilter {
    vendorId?: number
    productId?: number
    usagePage?: number
    usage?: number
  }

  interface HIDDeviceRequestOptions {
    filters: HIDDeviceFilter[]
  }

  interface HIDConnectionEvent extends Event {
    readonly device: HIDDevice
  }

  interface HIDInputReportEvent extends Event {
    readonly device: HIDDevice
    readonly reportId: number
    readonly data: DataView
  }

  interface HIDDevice extends EventTarget {
    readonly opened: boolean
    readonly vendorId: number
    readonly productId: number
    readonly productName: string
    readonly collections: unknown[]
    open(): Promise<void>
    close(): Promise<void>
    forget?(): Promise<void>
    addEventListener(
      type: 'inputreport',
      listener: (event: HIDInputReportEvent) => void,
      options?: boolean | AddEventListenerOptions
    ): void
    removeEventListener(
      type: 'inputreport',
      listener: (event: HIDInputReportEvent) => void,
      options?: boolean | EventListenerOptions
    ): void
  }

  interface HID extends EventTarget {
    getDevices(): Promise<HIDDevice[]>
    requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>
    addEventListener(
      type: 'connect' | 'disconnect',
      listener: (event: HIDConnectionEvent) => void,
      options?: boolean | AddEventListenerOptions
    ): void
    removeEventListener(
      type: 'connect' | 'disconnect',
      listener: (event: HIDConnectionEvent) => void,
      options?: boolean | EventListenerOptions
    ): void
  }

  interface Navigator {
    hid?: HID
  }

  interface Window {
    keySimulator: KeySimulator
    mouseSimulator?: MouseSimulator
    ipcRenderer?: IpcRenderer
  }
}
