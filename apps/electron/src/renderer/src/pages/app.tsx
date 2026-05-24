import { Orb } from "@renderer/components/ui/orb";
import { getApiBase } from "@renderer/lib/api";
import { Recorder } from "@renderer/lib/recorder";
import { Streamer } from "@renderer/lib/streamer";
import { Check, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
      try {
        ctxRef.current.close();
      } catch (_) {
        /* ignore */
      }
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
        const streamer = new Streamer(getApiBase(), {
          onConfig: (config) => {
            setUseStreaming(config.streaming);
          },
          onReady: () => {},
          onPartial: (text) => setPartialText(text),
          onFinal: async (text) => {
            // Always clean up streamer and recorder after streaming completes
            streamerRef.current?.close();
            streamerRef.current = null;
            recorderRef.current.cancel();

            if (text.trim()) {
              await window.api.pasteText(text);
              setState("pasted");
              setMessage(text.length > 40 ? `${text.slice(0, 40)}...` : text);
              setTimeout(() => {
                setState("idle");
                setMessage("");
                setPartialText("");
              }, 1500);
            } else {
              setState("idle");
              setMessage("");
              setPartialText("");
            }
          },
          onError: (msg) => {
            // Clean up on streaming error
            streamerRef.current?.close();
            streamerRef.current = null;
            recorderRef.current.cancel();
            setState("error");
            setMessage(msg);
            setTimeout(() => {
              setState("idle");
              setMessage("");
            }, 2500);
          },
        });
        streamerRef.current = streamer;
        // Start the streamer's mic separately (it gets its own stream)
        await streamer.start();
      } catch {
        // Streaming is optional -- REST fallback always works
        // Close the streamer if it partially initialized (e.g. WebSocket opened but mic failed)
        streamerRef.current?.close();
        streamerRef.current = null;
      }
    } catch (err) {
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
      // Stop the recorder's mic stream (the streamer has its own)
      recorderRef.current.cancel();
      streamer.commit();
      // The onFinal callback will handle the paste and cleanup
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

      const res = await fetch(`${getApiBase()}/api/transcribe`, {
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
      setTimeout(() => {
        setState("idle");
        setMessage("");
        setPartialText("");
      }, 1500);
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Transcription failed");
      setTimeout(() => {
        setState("idle");
        setMessage("");
      }, 2500);
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

  // Hide the pill whenever we return to idle (covers all exit paths)
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (state === "idle" && prevStateRef.current !== "idle") {
      window.api.hidePill();
    }
    prevStateRef.current = state;
  }, [state]);

  // Hold-to-record: hotkey down = start, hotkey up = commit
  useEffect(() => {
    const removeDown = window.api.onHotkeyDown(() => {
      if (stateRef.current === "idle") {
        startRecording();
      }
    });
    const removeUp = window.api.onHotkeyUp(() => {
      if (stateRef.current === "recording") {
        commitRecording();
      }
    });
    return () => {
      removeDown();
      removeUp();
    };
  }, [startRecording, commitRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelRecording]);

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
          style={
            {
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
            } as React.CSSProperties
          }
        >
          {state === "recording" && (
            <>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <Orb
                  colors={["#8AB62A", "#6B8F12"]}
                  agentState="listening"
                  getInputVolume={getInputVolume}
                  className="h-full w-full"
                />
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
                <svg
                  width={svgWidth}
                  height={svgHeight}
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  style={{ display: "block", flex: 1 }}
                  role="img"
                  aria-label="Audio levels"
                >
                  {bars.map((val, i) => {
                    const h = Math.max(2, val * svgHeight * 1.25);
                    const x = gap * (i + 0.5);
                    return (
                      <line
                        key={i}
                        x1={x}
                        y1={(svgHeight + h) / 2}
                        x2={x}
                        y2={(svgHeight - h) / 2}
                        stroke="#a1a1aa"
                        strokeWidth={barWidth}
                        strokeLinecap="round"
                        style={{ opacity: 0.5 + val * 0.5 }}
                      />
                    );
                  })}
                </svg>
              )}

              <span
                className="mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  opacity: 0.6,
                  flexShrink: 0,
                  color: "#a1a1aa",
                  paddingRight: 6,
                }}
              >
                {formatTimer(elapsed)}
              </span>
            </>
          )}

          {state === "transcribing" && (
            <div
              className="inline-flex items-center gap-2"
              style={{ padding: "0 8px" }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <Orb
                  colors={["#60A5FA", "#3B82F6"]}
                  agentState="thinking"
                  className="h-full w-full"
                />
              </div>
              <span style={{ color: "#a1a1aa", fontSize: 13 }}>
                {partialText ? partialText.slice(-30) : "Transcribing..."}
              </span>
            </div>
          )}

          {state === "pasted" && (
            <div
              className="inline-flex items-center gap-2"
              style={{ padding: "0 8px" }}
            >
              <Check size={16} style={{ color: "#8AB62A" }} />
              <span
                style={{
                  color: "#a1a1aa",
                  fontSize: 13,
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {message || "Pasted"}
              </span>
            </div>
          )}

          {state === "error" && (
            <div
              className="inline-flex items-center gap-2"
              style={{ padding: "0 8px" }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#DD6E4E",
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "#a1a1aa", fontSize: 13 }}>
                {message || "Error"}
              </span>
            </div>
          )}

          {state === "idle" && (
            <div
              className="inline-flex items-center gap-2"
              style={{ padding: "0 8px" }}
            >
              <Mic size={17} style={{ opacity: 0.5, color: "#a1a1aa" }} />
              <span style={{ opacity: 0.5, color: "#a1a1aa" }}>
                Hold hotkey to record
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
