import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// Expose key simulation API
contextBridge.exposeInMainWorld('keySimulator', {
  keyToggle: (key: string, down: boolean) => {
    return ipcRenderer.invoke('key-toggle', key, down)
  },
  keyShortcutHoldToggle: (key: string, down: boolean) => {
    return ipcRenderer.invoke('key-shortcut-hold-toggle', key, down)
  },
  keyTap: (key: string) => {
    return ipcRenderer.invoke('key-tap', key)
  },
})

// Expose mouse simulation API
contextBridge.exposeInMainWorld('mouseSimulator', {
  moveMouse: (deltaX: number, deltaY: number) => {
    return ipcRenderer.invoke('mouse-move', deltaX, deltaY)
  },
  buttonToggle: (button: string, down: boolean) => {
    return ipcRenderer.invoke('mouse-button-toggle', button, down)
  },
  configurePointerAssist: (config: unknown) => {
    return ipcRenderer.invoke('pointer-assist-config', config)
  },
  getPointerAssistConfig: () => {
    return ipcRenderer.invoke('pointer-assist-get-config')
  },
  getPointerAssistState: () => {
    return ipcRenderer.invoke('pointer-assist-get-state')
  },
  pointerAssistNudge: (direction: string, options?: unknown) => {
    return ipcRenderer.invoke('pointer-assist-nudge', direction, options)
  },
  endPointerAssistGesture: () => {
    return ipcRenderer.invoke('pointer-assist-end-gesture')
  },
})

// --------- Lightweight branded loading surface ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise<void>((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve()
      return
    }

    const handleReadyStateChange = () => {
      if (!condition.includes(document.readyState)) {
        return
      }

      document.removeEventListener('readystatechange', handleReadyStateChange)
      resolve()
    }

    document.addEventListener('readystatechange', handleReadyStateChange)
  })
}

function createLoadingSurface() {
  const style = document.createElement('style')
  const overlay = document.createElement('div')
  let removalTimer: ReturnType<typeof setTimeout> | undefined

  style.id = 'app-loading-style'
  style.textContent = `
@keyframes vibe-remote-float {
  0%, 100% { transform: translateY(1px) rotate(-0.8deg) scale(0.99); }
  45% { transform: translateY(-5px) rotate(0.7deg) scale(1); }
  72% { transform: translateY(-3px) rotate(0.2deg) scale(1); }
}
@keyframes vibe-touch-glide {
  0%, 100% { transform: translate3d(-10px, -7px, 0) scale(0.78); }
  24% { transform: translate3d(9px, -6px, 0) scale(1.03); }
  53% { transform: translate3d(8px, 9px, 0) scale(0.88); }
  77% { transform: translate3d(-8px, 7px, 0) scale(1.08); }
}
@keyframes vibe-touch-trail {
  0%, 100% { opacity: 0.04; transform: scale(0.68); }
  42% { opacity: 0.34; transform: scale(1); }
}
@keyframes vibe-clickpad-breathe {
  0%, 100% { box-shadow: inset 0 2px 7px rgba(25, 65, 58, 0.08), 0 0 0 0 rgba(31, 111, 98, 0); }
  48% { box-shadow: inset 0 2px 7px rgba(25, 65, 58, 0.1), 0 0 0 5px rgba(31, 111, 98, 0.055); }
}
.app-loading-wrap {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  background: #f0f4f2;
  opacity: 1;
  transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1);
  -webkit-app-region: drag;
}
.app-loading-wrap.is-leaving {
  opacity: 0;
  pointer-events: none;
}
.vibe-loader {
  position: relative;
  width: 58px;
  height: 92px;
  will-change: transform;
  animation: vibe-remote-float 2.15s cubic-bezier(0.32, 0.72, 0, 1) infinite;
}
.vibe-loader__remote {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(25, 65, 58, 0.22);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    0 18px 42px rgba(30, 73, 65, 0.14);
}
.vibe-loader__clickpad {
  position: absolute;
  top: 8px;
  left: 50%;
  width: 40px;
  height: 40px;
  transform: translateX(-50%);
  border: 1px solid rgba(25, 65, 58, 0.2);
  border-radius: 50%;
  background: #e4eeea;
  animation: vibe-clickpad-breathe 1.55s ease-in-out infinite;
}
.vibe-loader__clickpad::after {
  content: '';
  position: absolute;
  inset: 9px;
  border: 1px solid rgba(25, 65, 58, 0.16);
  border-radius: inherit;
}
.vibe-loader__trail,
.vibe-loader__touch {
  position: absolute;
  border-radius: 50%;
}
.vibe-loader__trail {
  top: 21px;
  left: 22px;
  width: 14px;
  height: 14px;
  background: rgba(31, 111, 98, 0.16);
  animation: vibe-touch-glide 1.45s cubic-bezier(0.32, 0.72, 0, 1) infinite,
    vibe-touch-trail 1.45s ease-in-out infinite;
}
.vibe-loader__trail--lag {
  width: 10px;
  height: 10px;
  margin: 2px;
  opacity: 0.08;
  animation-delay: -90ms;
  animation-duration: 1.45s;
}
.vibe-loader__touch {
  top: 24px;
  left: 25px;
  width: 7px;
  height: 7px;
  background: #1f6f62;
  box-shadow: 0 0 0 4px rgba(31, 111, 98, 0.12);
  will-change: transform;
  animation: vibe-touch-glide 1.45s cubic-bezier(0.32, 0.72, 0, 1) infinite;
}
.vibe-loader__button {
  position: absolute;
  left: 50%;
  bottom: 15px;
  width: 22px;
  height: 7px;
  transform: translateX(-50%);
  border-radius: 4px;
  background: rgba(31, 111, 98, 0.17);
}
@media (prefers-reduced-motion: reduce) {
  .vibe-loader { animation: none; }
  .vibe-loader__clickpad { animation: none; }
  .vibe-loader__touch {
    transform: translate3d(0, 0, 0);
    animation: vibe-touch-trail 1.2s ease-in-out infinite;
  }
  .vibe-loader__trail { display: none; }
}
@media (prefers-reduced-transparency: reduce) {
  .vibe-loader__remote { background: #ffffff; }
}
`

  overlay.className = 'app-loading-wrap'
  overlay.setAttribute('role', 'status')
  overlay.setAttribute('aria-label', 'Opening ture vibe coder')
  overlay.innerHTML = `
    <div class="vibe-loader" aria-hidden="true">
      <div class="vibe-loader__remote"></div>
      <div class="vibe-loader__clickpad"></div>
      <div class="vibe-loader__trail"></div>
      <div class="vibe-loader__trail vibe-loader__trail--lag"></div>
      <div class="vibe-loader__touch"></div>
      <div class="vibe-loader__button"></div>
    </div>
  `

  return {
    append() {
      if (!document.head.contains(style)) {
        document.head.appendChild(style)
      }
      if (!document.body.contains(overlay)) {
        document.body.appendChild(overlay)
      }
    },
    remove() {
      if (!document.body.contains(overlay) || overlay.classList.contains('is-leaving')) {
        return
      }

      overlay.classList.add('is-leaving')
      removalTimer = setTimeout(() => {
        overlay.remove()
        style.remove()
      }, 190)
    },
    cancelPendingRemoval() {
      if (removalTimer) {
        clearTimeout(removalTimer)
      }
    },
  }
}

const loadingSurface = createLoadingSurface()
void domReady().then(() => loadingSurface.append())

window.addEventListener('message', (event) => {
  if (
    event.source === window &&
    typeof event.data === 'object' &&
    event.data !== null &&
    event.data.payload === 'removeLoading'
  ) {
    loadingSurface.remove()
  }
})

window.addEventListener('beforeunload', () => {
  loadingSurface.cancelPendingRemoval()
})

setTimeout(() => loadingSurface.remove(), 8000)
