import {
  comboDisplayKeys,
  formatAcceleratorKeys,
  keyDisplayLabel,
  useHotkeyRecorder,
} from "@renderer/hooks/use-hotkey-recorder";
import { getApiBase } from "@renderer/lib/api";
import { cn } from "@renderer/lib/utils";
import { Keyboard, Mic, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// KeyBadge: renders a single key as a physical-key-style badge
// ---------------------------------------------------------------------------

function KeyBadge({
  label,
  variant = "default",
}: {
  label: string;
  variant?: "default" | "recording" | "dim";
}) {
  return (
    <kbd
      className={cn(
        "inline-flex select-none items-center justify-center",
        "min-w-[26px] rounded-md px-1.5 py-1",
        "font-mono text-xs font-medium leading-none",
        "border shadow-[0_1px_0_0_hsl(var(--border))]",
        variant === "default" && "border-border bg-muted text-foreground",
        variant === "recording" &&
          "border-primary/40 bg-primary/10 text-primary",
        variant === "dim" &&
          "border-border/50 bg-muted/50 text-muted-foreground",
      )}
    >
      {label}
    </kbd>
  );
}

/** Renders an array of key labels as badges with + separators */
function KeyComboDisplay({
  keys,
  variant = "default",
}: {
  keys: string[];
  variant?: "default" | "recording" | "dim";
}) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-muted-foreground text-[10px]">+</span>
          )}
          <KeyBadge label={k} variant={variant} />
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

interface AudioDevice {
  deviceId: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GeneralSettingsPage(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [hotkey, setHotkey] = useState("Alt+Space");

  const handleHotkeyRecorded = useCallback((accelerator: string) => {
    setHotkey(accelerator);
    fetch(`${getApiBase()}/api/settings/hotkey`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: accelerator }),
    }).catch(() => {});
    window.api.updateHotkey(accelerator);
  }, []);

  const {
    state: recorderState,
    liveModifiers,
    capturedCombo,
    startRecording: startHotkeyRecording,
    cancelRecording: cancelHotkeyRecording,
    saveRecording: saveHotkeyRecording,
  } = useHotkeyRecorder(handleHotkeyRecorded);

  // Load available audio input devices
  useEffect(() => {
    (async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
          for (const t of s.getTracks()) t.stop();
        });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        setDevices(
          allDevices
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
            })),
        );
      } catch {
        // ignore
      }
    })();
  }, []);

  // Load saved settings from server
  useEffect(() => {
    fetch(`${getApiBase()}/api/settings/mic_device_id`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value) setSelectedDevice(data.value);
      })
      .catch(() => {});
    fetch(`${getApiBase()}/api/settings/hotkey`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value) setHotkey(data.value);
      })
      .catch(() => {});
  }, []);

  const handleDeviceChange = useCallback((deviceId: string) => {
    setSelectedDevice(deviceId);
    fetch(`${getApiBase()}/api/settings/mic_device_id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: deviceId }),
    }).catch(() => {});
  }, []);

  const handleThemeChange = useCallback(
    (value: string) => {
      setTheme(value);
      fetch(`${getApiBase()}/api/settings/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }).catch(() => {});
    },
    [setTheme],
  );

  // Build display keys for current recorder state
  const liveKeys = liveModifiers.map(keyDisplayLabel);
  const capturedKeys = capturedCombo ? comboDisplayKeys(capturedCombo) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">General Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure general application preferences.
        </p>
      </div>

      {/* Appearance */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Appearance</h2>
          <p className="text-muted-foreground text-sm">
            Choose your preferred theme.
          </p>
        </div>
        <div className="flex gap-2">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleThemeChange(option.value)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors",
                theme === option.value
                  ? "border-primary bg-accent text-accent-foreground font-medium"
                  : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <option.icon className="h-4 w-4" />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Microphone */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Microphone</h2>
          <p className="text-muted-foreground text-sm">
            Select your audio input device.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Mic className="text-muted-foreground h-4 w-4 shrink-0" />
          <select
            value={selectedDevice}
            onChange={(e) => handleDeviceChange(e.target.value)}
            className="border-border bg-card text-foreground w-full max-w-sm rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Hotkey */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Hotkey</h2>
          <p className="text-muted-foreground text-sm">
            Global shortcut to toggle the transcription pill.
          </p>
        </div>

        {recorderState === "idle" ? (
          <button
            type="button"
            onClick={startHotkeyRecording}
            className="border-border hover:bg-secondary flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
          >
            <Keyboard className="text-muted-foreground h-4 w-4 shrink-0" />
            <KeyComboDisplay keys={formatAcceleratorKeys(hotkey)} />
            <span className="text-muted-foreground ml-auto text-xs">
              Click to change
            </span>
          </button>
        ) : recorderState === "recording" ? (
          <div className="border-primary/60 bg-primary/5 flex items-center justify-between rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
              <Keyboard className="text-primary h-4 w-4 shrink-0" />
              {liveKeys.length > 0 ? (
                <>
                  <KeyComboDisplay keys={liveKeys} variant="dim" />
                  <span className="text-muted-foreground animate-pulse text-xs">
                    + press a key
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground animate-pulse text-sm">
                  Press a key combination...
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={cancelHotkeyRecording}
              className="border-border hover:bg-secondary rounded-md border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </div>
        ) : (
          /* captured */
          <div className="border-primary/60 bg-primary/5 flex items-center justify-between rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
              <Keyboard className="text-primary h-4 w-4 shrink-0" />
              <KeyComboDisplay keys={capturedKeys} variant="recording" />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveHotkeyRecording}
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelHotkeyRecording}
                className="border-border hover:bg-secondary rounded-md border px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
