import { getApiBase } from "@renderer/lib/api";
import { Clock, Trash2, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HistoryEntry {
  id: number;
  raw_text: string;
  cleaned_text: string | null;
  voice_provider: string;
  voice_model: string;
  llm_provider: string | null;
  llm_model: string | null;
  duration_ms: number;
  audio_duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

interface Stats {
  total_sessions: number;
  total_duration_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  avg_duration_ms: number;
  today_sessions: number;
  today_cost: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}Z`);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage(): React.JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [histRes, statsRes] = await Promise.all([
        fetch(`${getApiBase()}/api/history?limit=100`),
        fetch(`${getApiBase()}/api/history/stats`),
      ]);
      if (histRes.ok) {
        const data = await histRes.json();
        setEntries(data.items);
      }
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deleteEntry = useCallback(
    async (id: number) => {
      await fetch(`${getApiBase()}/api/history/${id}`, { method: "DELETE" });
      loadData();
    },
    [loadData],
  );

  const clearAll = useCallback(async () => {
    if (!confirm("Clear all transcription history?")) return;
    await fetch(`${getApiBase()}/api/history`, { method: "DELETE" });
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-muted-foreground text-sm">Loading history...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">History</h1>
        <p className="text-muted-foreground mt-1">
          View past transcription sessions and usage metrics.
        </p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Total Sessions"
            value={String(stats.total_sessions)}
          />
          <StatCard label="Today" value={String(stats.today_sessions)} />
          <StatCard
            label="Avg Latency"
            value={formatDuration(Math.round(stats.avg_duration_ms))}
          />
          <StatCard
            label="Total Cost"
            value={`$${stats.total_cost_usd.toFixed(4)}`}
          />
        </div>
      )}

      {/* Session list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Clock size={14} />
            Recent Sessions
          </h2>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-muted-foreground hover:text-destructive text-xs"
            >
              Clear all
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="border-border rounded-lg border border-dashed px-4 py-8 text-center">
            <TrendingUp className="text-muted-foreground mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">
              No transcription sessions yet. Use the pill to start dictating.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="border-border group rounded-lg border px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-relaxed">
                      {entry.cleaned_text || entry.raw_text}
                    </p>
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>{formatDate(entry.created_at)}</span>
                      <span>{formatDuration(entry.duration_ms)}</span>
                      <span className="mono text-[10px]">
                        {entry.voice_model.includes("/")
                          ? entry.voice_model.split("/").pop()
                          : entry.voice_model}
                      </span>
                      {entry.llm_model && (
                        <span className="mono text-[10px]">
                          +{" "}
                          {entry.llm_model.includes("/")
                            ? entry.llm_model.split("/").pop()
                            : entry.llm_model}
                        </span>
                      )}
                      {entry.cost_usd > 0 && (
                        <span>${entry.cost_usd.toFixed(4)}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteEntry(entry.id)}
                    className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border rounded-lg border px-3 py-2.5">
      <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
