import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Maps DOM KeyboardEvent to an Electron accelerator string.
 * Returns null if only modifier keys are pressed (waiting for a real key).
 */
function eventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = [];

  // Modifiers
  if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // Ignore events that are only modifier keys
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) {
    return null;
  }

  // Map special keys to Electron accelerator names
  const keyMap: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Escape",
    Enter: "Return",
    Backspace: "Backspace",
    Delete: "Delete",
    Tab: "Tab",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };

  const mapped = keyMap[key];
  if (mapped) {
    parts.push(mapped);
  } else if (key.length === 1) {
    parts.push(key.toUpperCase());
  } else if (key.startsWith("F") && /^F\d{1,2}$/.test(key)) {
    // F1-F24
    parts.push(key);
  } else {
    parts.push(key);
  }

  // Require at least one modifier + one key for a valid global shortcut
  const modCount = [e.metaKey || e.ctrlKey, e.altKey, e.shiftKey].filter(
    Boolean,
  ).length;
  if (modCount === 0) {
    // Allow bare F-keys and Escape
    if (!/^F\d{1,2}$/.test(parts[0]) && parts[0] !== "Escape") {
      return null;
    }
  }

  return parts.join("+");
}

/**
 * Formats an Electron accelerator string for display.
 * e.g. "CommandOrControl+Shift+Space" -> "Cmd + Shift + Space"
 */
export function formatAccelerator(accel: string): string {
  return accel
    .replace("CommandOrControl", "\u2318")
    .replace("Alt", "\u2325")
    .replace("Shift", "\u21E7")
    .replace("Return", "\u23CE")
    .replace("Backspace", "\u232B")
    .replace("Escape", "Esc")
    .replace(/\+/g, " + ");
}

interface UseHotkeyRecorderReturn {
  isRecording: boolean;
  startRecording: () => void;
  cancelRecording: () => void;
  recordedKey: string | null;
}

/**
 * Hook for recording a keyboard shortcut from the user.
 * When recording, captures the next key combination and converts it to
 * an Electron accelerator string.
 *
 * @param onRecord - Called with the accelerator string when a valid combo is captured
 */
export function useHotkeyRecorder(
  onRecord: (accelerator: string) => void,
): UseHotkeyRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedKey, setRecordedKey] = useState<string | null>(null);
  const onRecordRef = useRef(onRecord);
  onRecordRef.current = onRecord;

  const startRecording = useCallback(() => {
    setIsRecording(true);
    setRecordedKey(null);
  }, []);

  const cancelRecording = useCallback(() => {
    setIsRecording(false);
    setRecordedKey(null);
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const accelerator = eventToAccelerator(e);
      if (accelerator) {
        setRecordedKey(accelerator);
        setIsRecording(false);
        onRecordRef.current(accelerator);
      }
    };

    // Use capture phase to intercept before anything else
    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
    };
  }, [isRecording]);

  // Cancel on blur (user clicked away)
  useEffect(() => {
    if (!isRecording) return;

    const onBlur = () => {
      setIsRecording(false);
      setRecordedKey(null);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [isRecording]);

  return { isRecording, startRecording, cancelRecording, recordedKey };
}
