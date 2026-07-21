import { useCallback, useEffect, useRef, useState } from 'react'
import './MappingPanel.css'

interface KeyMappingSelectorProps {
  currentMapping: { key: string; label: string } | null
  isEditing: boolean
  pendingKey: { key: string; label: string } | null
  onKeyPress: (key: string, label: string) => void
  onRemove?: () => void
  showRemove?: boolean
}

const MODIFIER_PRIORITY: Record<string, number> = {
  Meta: 1,
  Ctrl: 2,
  Alt: 3,
  Shift: 4,
};

const MODIFIER_KEYS = new Set(Object.keys(MODIFIER_PRIORITY));

function normalizeKeyName(key: string): string | null {
  const trimmedKey = key.trim();
  const lowerKey = trimmedKey.toLowerCase();

  if (!trimmedKey) {
    return null;
  }

  if (["cmd", "command", "meta", "super", "⌘"].includes(lowerKey)) {
    return "Meta";
  }

  if (["ctrl", "control", "⌃"].includes(lowerKey)) {
    return "Ctrl";
  }

  if (["alt", "option", "opt", "⌥"].includes(lowerKey)) {
    return "Alt";
  }

  if (["shift", "⇧"].includes(lowerKey)) {
    return "Shift";
  }

  if (lowerKey === " " || lowerKey === "space" || lowerKey === "spacebar") {
    return "Space";
  }

  if (["esc", "escape"].includes(lowerKey)) {
    return "Escape";
  }

  if (["enter", "return", "↩"].includes(lowerKey)) {
    return "Enter";
  }

  if (["numpadenter", "keypadenter"].includes(lowerKey)) {
    return "NumpadEnter";
  }

  const arrowAliases: Record<string, string> = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };

  if (arrowAliases[lowerKey]) {
    return arrowAliases[lowerKey];
  }

  if (trimmedKey.length === 1) {
    return trimmedKey.toLowerCase();
  }

  return trimmedKey;
}

function sortComboKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const aPriority = MODIFIER_PRIORITY[a] || 100;
    const bPriority = MODIFIER_PRIORITY[b] || 100;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    return a.localeCompare(b);
  });
}

function formatKeyLabel(key: string): string {
  const labelAliases: Record<string, string> = {
    Meta: "Command",
    Ctrl: "Ctrl",
    Alt: "Option",
    Shift: "Shift",
    Space: "Space",
  };

  return key
    .split("+")
    .map((part) => {
      const normalizedPart = normalizeKeyName(part) ?? part;
      return (
        labelAliases[normalizedPart] ??
        (normalizedPart.length === 1 ? normalizedPart.toUpperCase() : normalizedPart)
      );
    })
    .join("+");
}

function normalizeComboInput(value: string): { key: string; label: string } | null {
  const preparedValue = value
    .replaceAll("＋", "+")
    .replace(/([⌘⌃⌥⇧])/g, "+$1+")
    .replace(/\s*\+\s*/g, "+")
    .trim();
  const parts = preparedValue.includes("+")
    ? preparedValue.split("+")
    : preparedValue.split(/[\s,;]+/);
  const normalizedKeys = parts
    .map(normalizeKeyName)
    .filter((key): key is string => !!key);

  if (normalizedKeys.length === 0) {
    return null;
  }

  const uniqueKeys = Array.from(new Set(normalizedKeys));
  const sortedKeys = sortComboKeys(uniqueKeys);
  const key = sortedKeys.join("+");

  return {
    key,
    label: formatKeyLabel(key),
  };
}

export function KeyMappingSelector({
  currentMapping,
  isEditing,
  pendingKey,
  onKeyPress,
  onRemove,
  showRemove = false,
}: KeyMappingSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [manualComboText, setManualComboText] = useState("")

  const applyComboText = useCallback(
    (value: string) => {
      setManualComboText(value)
      const combo = normalizeComboInput(value)
      if (combo) {
        onKeyPress(combo.key, combo.label)
      }
    },
    [onKeyPress]
  )

  const pasteComboFromClipboard = useCallback(async () => {
    if (!navigator.clipboard) {
      return
    }

    try {
      const value = await navigator.clipboard.readText()
      if (value) {
        applyComboText(value)
      }
    } catch (error) {
      console.error("Failed to paste key mapping from clipboard:", error)
    }
  }, [applyComboText])

  // Handle key press and mouse button clicks
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditing) {
        if ((e.target as HTMLElement | null)?.closest('.combo-key-input')) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        const pressedKey = normalizeKeyName(e.key === ' ' ? 'Space' : e.key)
        if (!pressedKey) {
          return
        }

        const keys = [pressedKey]
        if (!MODIFIER_KEYS.has(pressedKey)) {
          if (e.metaKey) keys.push("Meta")
          if (e.ctrlKey) keys.push("Ctrl")
          if (e.altKey) keys.push("Alt")
          if (e.shiftKey) keys.push("Shift")
        } else {
          if (pressedKey !== "Meta" && e.metaKey) keys.push("Meta")
          if (pressedKey !== "Ctrl" && e.ctrlKey) keys.push("Ctrl")
          if (pressedKey !== "Alt" && e.altKey) keys.push("Alt")
          if (pressedKey !== "Shift" && e.shiftKey) keys.push("Shift")
        }

        const key = sortComboKeys(Array.from(new Set(keys))).join("+")
        onKeyPress(key, formatKeyLabel(key))
      }
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (isEditing && containerRef.current) {
        // Only handle clicks within the current ButtonMappingPanel
        const buttonMappingPanel = containerRef.current.closest('.button-mapping-item')
        if (!buttonMappingPanel) {
          return
        }

        const target = e.target as HTMLElement
        // Validate click is within the current ButtonMappingPanel
        if (!buttonMappingPanel.contains(target)) {
          return
        }

        // Ignore clicks on interactive elements (buttons, links, etc.)
        if (
          target.tagName === 'BUTTON' ||
          target.closest('button') !== null ||
          target.tagName === 'A' ||
          target.closest('a') !== null ||
          target.closest('.btn-map') !== null ||
          target.closest('.btn-revert') !== null ||
          target.closest('.btn-remove') !== null ||
          target.closest('.btn-remove-small') !== null ||
          target.closest('.btn-edit') !== null
        ) {
          return // Don't capture clicks on buttons/links
        }

        e.preventDefault()
        e.stopPropagation()
        let key: string
        let label: string

        if (e.button === 0) {
          key = 'MouseLeft'
          label = 'Left Mouse'
        } else if (e.button === 1) {
          key = 'MouseMiddle'
          label = 'Middle Mouse'
        } else if (e.button === 2) {
          key = 'MouseRight'
          label = 'Right Mouse'
        } else {
          return // Unknown button
        }

        onKeyPress(key, label)
      }
    }

    if (isEditing) {
      window.addEventListener('keydown', handleKeyDown, true)
      window.addEventListener('mousedown', handleMouseDown, true) // Use capture phase
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [isEditing, onKeyPress])

  useEffect(() => {
    if (!isEditing) {
      setManualComboText("")
    }
  }, [isEditing])

  const displayKey = pendingKey || currentMapping

  return (
    <div ref={containerRef} className="direction-mapping">
      {displayKey ? (
        <>
          <span className="mapped-key">
            {displayKey.label}
          </span>
          {pendingKey && (
            <span style={{ fontSize: '0.75em', color: '#888', marginLeft: '4px' }}>(unsaved)</span>
          )}
          {showRemove && onRemove && (
            <button
              className="btn-remove-small"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              title="Remove mapping"
            >
              ×
            </button>
          )}
        </>
      ) : (
        <div className="direction-mapping unmapped">Not mapped</div>
      )}
      {isEditing && (
        <>
          <input
            className="combo-key-input"
            value={manualComboText}
            placeholder="Command+Shift+D"
            spellCheck={false}
            onChange={(event) => applyComboText(event.target.value)}
            onPaste={(event) => {
              const pastedText = event.clipboardData.getData("text")
              if (!pastedText) {
                return
              }

              event.preventDefault()
              applyComboText(pastedText)
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const combo = normalizeComboInput(manualComboText)
                if (combo) {
                  onKeyPress(combo.key, combo.label)
                }
              }
            }}
          />
          <button
            type="button"
            className="combo-paste-button"
            onClick={pasteComboFromClipboard}
          >
            Paste
          </button>
        </>
      )}
    </div>
  )
}
