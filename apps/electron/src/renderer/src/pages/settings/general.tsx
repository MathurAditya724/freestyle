import {
  formatAccelerator,
  useHotkeyRecorder,
} from "@renderer/hooks/use-hotkey-recorder";
import { cn } from "@renderer/lib/utils";
import { Keyboard, Mic, Monitor, Moon, Sparkles, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

const API_BASE = "http://localhost:4649";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

interface AudioDevice {
  deviceId: string;
  label: string;
}

export default function GeneralSettingsPage(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [llmCleanup, setLlmCleanup] = useState(false);
  const [hotkey, setHotkey] = useState("Alt+Space");

  const handleHotkeyRecorded = useCallback((accelerator: string) => {
    setHotkey(accelerator);
    // Save to DB
    fetch(`${API_BASE}/api/settings/hotkey`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: accelerator }),
    }).catch(() => {});
    // Notify main process
    window.api.updateHotkey(accelerator);
  }, []);

  const {
    isRecording,
    startRecording: startHotkeyRecording,
    cancelRecording: cancelHotkeyRecording,
  } = useHotkeyRecorder(handleHotkeyRecorded);

  // Load available audio input devices
  useEffect(() => {
    async function loadDevices() {
      try {
        // Need mic permission first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
          s.getTracks().forEach((t) => t.stop());
        });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = allDevices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
          }));
        setDevices(audioInputs);
      } catch (err) {
        console.error("Failed to enumerate devices:", err);
      }
    }
    loadDevices();
  }, []);

  // Load saved settings from server
  useEffect(() => {
    fetch(`${API_BASE}/api/settings/mic_device_id`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value) setSelectedDevice(data.value);
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/settings/llm_cleanup`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value) setLlmCleanup(data.value === "true");
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/settings/hotkey`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value) setHotkey(data.value);
      })
      .catch(() => {});
  }, []);

  const handleDeviceChange = useCallback((deviceId: string) => {
    setSelectedDevice(deviceId);
    fetch(`${API_BASE}/api/settings/mic_device_id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: deviceId }),
    }).catch((err) => console.error("Failed to save mic setting:", err));
  }, []);

  const handleThemeChange = useCallback(
    (value: string) => {
      setTheme(value);
      fetch(`${API_BASE}/api/settings/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }).catch(() => {});
    },
    [setTheme],
  );

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
        <div className="flex items-center gap-3">
          <Keyboard className="text-muted-foreground h-4 w-4 shrink-0" />
          {isRecording ? (
            <div className="border-primary bg-primary/5 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm">
              <span className="text-muted-foreground animate-pulse">
                Press your shortcut...
              </span>
              <button
                type="button"
                onClick={cancelHotkeyRecording}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startHotkeyRecording}
              className="border-border hover:bg-secondary flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm"
            >
              <span className="mono text-xs">{formatAccelerator(hotkey)}</span>
              <span className="text-muted-foreground ml-2 text-xs">
                Click to change
              </span>
            </button>
          )}
        </div>
      </div>

      {/* LLM Post-processing */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Post-processing</h2>
          <p className="text-muted-foreground text-sm">
            Use an LLM to clean up transcribed text before pasting.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !llmCleanup;
            setLlmCleanup(next);
            fetch(`${API_BASE}/api/settings/llm_cleanup`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value: String(next) }),
            }).catch(() => {});
          }}
          className={cn(
            "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors",
            llmCleanup
              ? "border-primary bg-accent text-accent-foreground"
              : "border-border text-muted-foreground hover:bg-secondary",
          )}
        >
          <Sparkles className="h-4 w-4" />
          <div className="flex-1 text-left">
            <div className="font-medium">LLM Cleanup</div>
            <div className="text-muted-foreground text-xs">
              Fix grammar, punctuation, and formatting after transcription
            </div>
          </div>
          <div
            className={cn(
              "h-5 w-9 rounded-full transition-colors",
              llmCleanup ? "bg-primary" : "bg-border",
            )}
          >
            <div
              className={cn(
                "h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform",
                llmCleanup ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </div>
        </button>
      </div>
    </div>
  );
}
