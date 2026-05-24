import { Check, Loader2, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Orb } from "@renderer/components/ui/orb";
import { Recorder } from "@renderer/lib/recorder";
import { Streamer } from "@renderer/lib/streamer";

const API_BASE = "http://localhost:4649";
const BARS = 14;
const RISE = 0.55;
const FALL = 0.22;

type PillState = "idle" | "recording" | "transcribing" | "pasted" | "error";

function smoothBars(prev: number[], next: number[]): number[] {
  return prev.map((p, i) => {
    const n = next[i] ?? 0;
    const k = n > p ? RISE : FALL;
    return p + (n - p) * k;
  });
}

function formatTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AppPage(): React.JSX.Element {
  const [state, setState] = useState<PillState>("idle");
  const [bars, setBars] = useState<number[]>(() => new Array(BARS).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("");
  const [partialText, setPartialText] = useState("");
  const [useStreaming, setUseStreaming] = useState(false);

  const recorderRef = useRef(new Recorder());
  const streamerRef = useRef<Streamer | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const barsRef = useRef<number[]>(new Array(BARS).fill(0));
  const volumeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const timerRef = useRef<number>(0);
  const wantsMicRef = useRef(false);

  const getInputVolume = useCallback(() => volumeRef.current, []);

  // -- Audio visualization (from a MediaStream) --
  const startVisualization = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const sliceSize = Math.floor(analyser.frequencyBinCount / BARS);

    const update = () => {
      if (!wantsMicRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      const raw: number[] = [];
      let totalSum = 0;
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = 0; j < sliceSize; j++) {
          sum += dataArray[i * sliceSize + j];
        }
        const val = sum / sliceSize / 255;
        raw.push(val);
        totalSum += val;
      }
      barsRef.current = smoothBars(barsRef.current, raw);
      setBars([...barsRef.current]);
      volumeRef.current = Math.min(1, (totalSum / BARS) * 2.5);
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
  }, []);

  const stopVisualization = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    cancelAnimationFrame(timerRef.current);
    timerRef.current = 0;
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch (_) { /* ignore */ }
      ctxRef.current = null;
    }
    setBars(new Array(BARS).fill(0));
    barsRef.current = new Array(BARS).fill(0);
    volumeRef.current = 0;
    setElapsed(0);
  }, []);

  // -- Start recording --
  const startRecording = useCallback(async () => {
    if (wantsMicRef.current) return; // Already recording
    wantsMicRef.current = true;
    setState("recording");
    setMessage("");
    setPartialText("");

    try {
      // Start the recorder (captures audio for REST transcription)
      const stream = await recorderRef.current.start();
      console.log("[pill] Recorder started, got stream");

      if (!wantsMicRef.current) {
        recorderRef.current.cancel();
        return;
      }

      // Start timer
      startTimeRef.current = Date.now();
      const updateTimer = () => {
        if (!wantsMicRef.current) return;
        setElapsed(Date.now() - startTimeRef.current);
        timerRef.current = requestAnimationFrame(updateTimer);
      };
      timerRef.current = requestAnimationFrame(updateTimer);

      // Start visualization from the recorder's stream
      startVisualization(stream);

      // Try to also open a streaming connection for real-time partial text
      try {
        const streamer = new Streamer(API_BASE, {
          onConfig: (config) => {
            console.log("[pill] Stream config:", config);
            setUseStreaming(config.streaming);
          },
          onReady: () => console.log("[pill] Stream ready"),
          onPartial: (text) => setPartialText(text),
          onFinal: async (text) => {
            console.log("[pill] Stream final:", text.slice(0, 50));
            if (text.trim()) {
              await window.api.pasteText(text);
              setState("pasted");
              setMessage(text.length > 40 ? `${text.slice(0, 40)}...` : text);
              setTimeout(() => { setState("idle"); setMessage(""); setPartialText(""); }, 1500);
            }
          },
          onError: (msg) => console.warn("[pill] Stream error:", msg),
        });
        streamerRef.current = streamer;
        // Start the streamer's mic separately (it gets its own stream)
        await streamer.start();
        console.log("[pill] Streamer connected");
      } catch (streamErr) {
        // Streaming is optional -- REST fallback always works
        console.warn("[pill] Streaming unavailable, will use REST:", streamErr);
        streamerRef.current = null;
      }
    } catch (err) {
      console.error("[pill] Failed to start recording:", err);
      wantsMicRef.current = false;
      setState("error");
      setMessage(err instanceof Error ? err.message : "Mic access denied");
      setTimeout(() => setState("idle"), 2500);
    }
  }, [startVisualization]);

  // -- Commit: stop recording and transcribe --
  const commitRecording = useCallback(async () => {
    wantsMicRef.current = false;
    stopVisualization();

    const streamer = streamerRef.current;

    // If streaming mode is active, just commit via WebSocket
    if (useStreaming && streamer) {
      setState("transcribing");
      streamer.commit();
      // The onFinal callback will handle the paste
      return;
    }

    // REST fallback: stop recorder, send WAV
    setState("transcribing");
    streamer?.close();
    streamerRef.current = null;

    try {
      let wavBlob: Blob;
      if (recorderRef.current.isRecording()) {
        wavBlob = await recorderRef.current.stop();
      } else {
        setState("idle");
        return;
      }

      const res = await fetch(`${API_BASE}/api/transcribe`, {
        method: "POST",
        body: wavBlob,
        headers: { "Content-Type": "audio/wav" },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const text = data.cleaned || data.raw || "";

      if (!text.trim()) {
        setState("idle");
        return;
      }

      await window.api.pasteText(text);
      setState("pasted");
      setMessage(text.length > 40 ? `${text.slice(0, 40)}...` : text);
      setTimeout(() => { setState("idle"); setMessage(""); setPartialText(""); }, 1500);
    } catch (err) {
      console.error("Transcription failed:", err);
      setState("error");
      setMessage(err instanceof Error ? err.message : "Transcription failed");
      setTimeout(() => { setState("idle"); setMessage(""); }, 2500);
    }
  }, [useStreaming, stopVisualization]);

  const cancelRecording = useCallback(() => {
    wantsMicRef.current = false;
    stopVisualization();
    streamerRef.current?.cancel();
    streamerRef.current = null;
    recorderRef.current.cancel();
    setState("idle");
    setMessage("");
    setPartialText("");
  }, [stopVisualization]);

  // Track state in a ref so event handlers don't need state in their deps
  const stateRef = useRef(state);
  stateRef.current = state;

  // -- Visibility management --
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const handler = (_: unknown, isVisible: boolean) => {
      console.log("[pill] IPC visibility:", isVisible, "state:", stateRef.current);
      if (isVisible && stateRef.current === "idle") startRecording();
      else if (!isVisible && stateRef.current === "recording") cancelRecording();
    };
    ipc.on("pill:visibility", handler);
    return () => { ipc.removeListener("pill:visibility", handler); };
  }, [startRecording, cancelRecording]);

  useEffect(() => {
    const onFocus = () => {
      console.log("[pill] window focus, state:", stateRef.current);
      if (stateRef.current === "idle") startRecording();
    };
    const onBlur = () => {
      console.log("[pill] window blur, state:", stateRef.current);
      if (stateRef.current === "recording") cancelRecording();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("blur", onBlur); };
  }, [startRecording, cancelRecording]);

  // Start on mount
  useEffect(() => {
    console.log("[pill] mounted, starting recording");
    startRecording();
    return () => {
      console.log("[pill] unmounting, cleaning up");
      wantsMicRef.current = false;
      stopVisualization();
      streamerRef.current?.close();
      recorderRef.current.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: Enter/Space to commit, Escape to cancel
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (state === "recording" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        commitRecording();
      } else if (state === "recording" && e.key === "Escape") {
        e.preventDefault();
        cancelRecording();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, commitRecording, cancelRecording]);

  // -- Render --
  const svgWidth = 140;
  const svgHeight = 28;
  const gap = svgWidth / BARS;
  const barWidth = Math.min(gap * 0.55, 5);

  const glowColor =
    state === "recording"
      ? "0 0 24px 6px rgba(107,143,18,0.2), 0 0 48px 12px rgba(107,143,18,0.08)"
      : state === "error"
        ? "0 0 24px 6px rgba(221,110,78,0.2)"
        : state === "pasted"
          ? "0 0 24px 6px rgba(107,143,18,0.15)"
          : "0 0 20px 4px rgba(161,161,170,0.08)";

  return (
    <div
      className="flex h-screen w-screen items-center justify-center select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        style={{
          borderRadius: 28,
          boxShadow: glowColor,
          transition: "box-shadow 300ms ease",
        }}
      >
        <div
          className="inline-flex items-center gap-3"
          style={{
            height: 48,
            padding: "0 10px",
            borderRadius: 28,
            background: "#27272a",
            color: "#fafafa",
            border: "1px solid rgba(161,161,170,0.15)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            fontWeight: 500,
            minWidth: 200,
            maxWidth: 420,
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
        >
          {state === "recording" && (
            <>
              <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                <Orb colors={["#8AB62A", "#6B8F12"]} agentState="listening" getInputVolume={getInputVolume} className="h-full w-full" />
              </div>

              {/* Show partial text if streaming, otherwise show bars */}
              {partialText ? (
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: "#d4d4d8",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    direction: "rtl",
                    textAlign: "left",
                  }}
                >
                  {partialText}
                </span>
              ) : (
                <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ display: "block", flex: 1 }}>
                  {bars.map((val, i) => {
                    const h = Math.max(2, val * svgHeight * 1.25);
                    const x = gap * (i + 0.5);
                    return (
                      <line key={i} x1={x} y1={(svgHeight + h) / 2} x2={x} y2={(svgHeight - h) / 2} stroke="#a1a1aa" strokeWidth={barWidth} strokeLinecap="round" style={{ opacity: 0.5 + val * 0.5 }} />
                    );
                  })}
                </svg>
              )}

              <span className="mono" style={{ fontSize: 11, letterSpacing: "0.06em", opacity: 0.6, flexShrink: 0, color: "#a1a1aa", paddingRight: 6 }}>
                {formatTimer(elapsed)}
              </span>
            </>
          )}

          {state === "transcribing" && (
            <div className="inline-flex items-center gap-2" style={{ padding: "0 8px" }}>
              <Loader2 size={16} className="animate-spin" style={{ color: "#8AB62A" }} />
              <span style={{ color: "#a1a1aa", fontSize: 13 }}>
                {partialText ? partialText.slice(-30) : "Transcribing..."}
              </span>
            </div>
          )}

          {state === "pasted" && (
            <div className="inline-flex items-center gap-2" style={{ padding: "0 8px" }}>
              <Check size={16} style={{ color: "#8AB62A" }} />
              <span style={{ color: "#a1a1aa", fontSize: 13, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {message || "Pasted"}
              </span>
            </div>
          )}

          {state === "error" && (
            <div className="inline-flex items-center gap-2" style={{ padding: "0 8px" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#DD6E4E", flexShrink: 0 }} />
              <span style={{ color: "#a1a1aa", fontSize: 13 }}>{message || "Error"}</span>
            </div>
          )}

          {state === "idle" && (
            <div className="inline-flex items-center gap-2" style={{ padding: "0 8px" }}>
              <Mic size={17} style={{ opacity: 0.5, color: "#a1a1aa" }} />
              <span style={{ opacity: 0.5, color: "#a1a1aa" }}>Starting...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
