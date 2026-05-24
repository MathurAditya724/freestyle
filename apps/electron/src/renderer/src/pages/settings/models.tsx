import { getApiBase } from "@renderer/lib/api";
import { cn } from "@renderer/lib/utils";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Key,
  Mic,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AvailableModel {
  provider_id: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  family: string;
  type: "voice" | "llm";
}

interface ConfiguredModel {
  id: number;
  provider: string;
  model_id: string;
  model_name: string;
  type: string;
  is_default: number;
}

interface ApiKeyEntry {
  provider: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VOICE_PROVIDERS = ["openai", "groq", "deepgram", "elevenlabs"];
const LLM_PROVIDERS = ["openai", "anthropic", "google", "groq", "mistral"];

/** Canonical display names for providers */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
  deepgram: "Deepgram",
  elevenlabs: "ElevenLabs",
  mistral: "Mistral",
  openrouter: "OpenRouter",
};

function displayName(providerId: string, fallback?: string): string {
  return PROVIDER_DISPLAY_NAMES[providerId] ?? fallback ?? providerId;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ModelsPage(): React.JSX.Element {
  const [available, setAvailable] = useState<AvailableModel[]>([]);
  const [configured, setConfigured] = useState<ConfiguredModel[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [llmCleanup, setLlmCleanup] = useState(false);

  // Dropdowns
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const [llmDropdownOpen, setLlmDropdownOpen] = useState(false);

  // Search
  const [voiceSearch, setVoiceSearch] = useState("");
  const [llmSearch, setLlmSearch] = useState("");

  // Inline API key prompt (shared between voice & llm dropdowns)
  const [pendingKeyProvider, setPendingKeyProvider] = useState<string | null>(
    null,
  );
  const [pendingKeyValue, setPendingKeyValue] = useState("");
  const [showPendingKey, setShowPendingKey] = useState(false);
  const [pendingModel, setPendingModel] = useState<AvailableModel | null>(null);
  const [pendingModelType, setPendingModelType] = useState<"voice" | "llm">(
    "voice",
  );

  // Provider key editing
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editKeyValue, setEditKeyValue] = useState("");
  const [showEditKey, setShowEditKey] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    try {
      const [availRes, configRes, keysRes, cleanupRes] = await Promise.all([
        fetch(`${getApiBase()}/api/models/available`),
        fetch(`${getApiBase()}/api/models/configured`),
        fetch(`${getApiBase()}/api/keys`),
        fetch(`${getApiBase()}/api/settings/llm_cleanup`),
      ]);
      if (availRes.ok) setAvailable(await availRes.json());
      if (configRes.ok) setConfigured(await configRes.json());
      if (keysRes.ok) setApiKeys(await keysRes.json());
      if (cleanupRes.ok) {
        const data = await cleanupRes.json();
        if (data?.value) setLlmCleanup(data.value === "true");
      }
    } catch (err) {
      console.error("Failed to load models data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const keyProviders = new Set(apiKeys.map((k) => k.provider));

  const defaultVoice = configured.find(
    (m) => m.type === "voice" && m.is_default === 1,
  );
  const defaultLlm = configured.find(
    (m) => m.type === "llm" && m.is_default === 1,
  );

  const voiceModelsByProvider = new Map<
    string,
    { providerName: string; models: AvailableModel[] }
  >();
  for (const m of available) {
    if (m.type !== "voice") continue;
    if (!VOICE_PROVIDERS.includes(m.provider_id)) continue;
    let entry = voiceModelsByProvider.get(m.provider_id);
    if (!entry) {
      entry = {
        providerName: displayName(m.provider_id, m.provider_name),
        models: [],
      };
      voiceModelsByProvider.set(m.provider_id, entry);
    }
    entry.models.push(m);
  }

  const llmModelsByProvider = new Map<
    string,
    { providerName: string; models: AvailableModel[] }
  >();
  for (const m of available) {
    if (m.type !== "llm") continue;
    if (!LLM_PROVIDERS.includes(m.provider_id)) continue;
    let entry = llmModelsByProvider.get(m.provider_id);
    if (!entry) {
      entry = {
        providerName: displayName(m.provider_id, m.provider_name),
        models: [],
      };
      llmModelsByProvider.set(m.provider_id, entry);
    }
    entry.models.push(m);
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const closePendingKey = useCallback(() => {
    setPendingKeyProvider(null);
    setPendingKeyValue("");
    setPendingModel(null);
    setShowPendingKey(false);
  }, []);

  const selectModel = useCallback(
    async (model: AvailableModel, type: "voice" | "llm") => {
      if (!keyProviders.has(model.provider_id)) {
        setPendingModel(model);
        setPendingKeyProvider(model.provider_id);
        setPendingKeyValue("");
        setShowPendingKey(false);
        setPendingModelType(type);
        return;
      }

      await fetch(`${getApiBase()}/api/models/configured`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: model.provider_id,
          model_id: model.model_id,
          model_name: model.model_name,
          type,
          is_default: true,
        }),
      });
      setVoiceDropdownOpen(false);
      setLlmDropdownOpen(false);
      setVoiceSearch("");
      setLlmSearch("");
      loadData();
    },
    [keyProviders, loadData],
  );

  const savePendingKeyAndModel = useCallback(async () => {
    if (!pendingKeyValue.trim() || !pendingKeyProvider || !pendingModel) return;

    await fetch(`${getApiBase()}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: pendingKeyProvider,
        key: pendingKeyValue.trim(),
      }),
    });

    await fetch(`${getApiBase()}/api/models/configured`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: pendingModel.provider_id,
        model_id: pendingModel.model_id,
        model_name: pendingModel.model_name,
        type: pendingModelType,
        is_default: true,
      }),
    });

    closePendingKey();
    setVoiceDropdownOpen(false);
    setLlmDropdownOpen(false);
    setVoiceSearch("");
    setLlmSearch("");
    loadData();
  }, [
    pendingKeyValue,
    pendingKeyProvider,
    pendingModel,
    pendingModelType,
    closePendingKey,
    loadData,
  ]);

  const saveProviderKey = useCallback(
    async (provider: string) => {
      if (!editKeyValue.trim()) return;
      await fetch(`${getApiBase()}/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: editKeyValue.trim() }),
      });
      setEditingProvider(null);
      setEditKeyValue("");
      setShowEditKey(false);
      loadData();
    },
    [editKeyValue, loadData],
  );

  const removeProviderKey = useCallback(
    async (provider: string) => {
      await fetch(`${getApiBase()}/api/keys/${provider}`, { method: "DELETE" });
      const providerModels = configured.filter((m) => m.provider === provider);
      await Promise.all(
        providerModels.map((m) =>
          fetch(`${getApiBase()}/api/models/configured/${m.id}`, {
            method: "DELETE",
          }),
        ),
      );
      loadData();
    },
    [configured, loadData],
  );

  // -------------------------------------------------------------------------
  // Shared dropdown renderer
  // -------------------------------------------------------------------------

  function renderModelDropdown(
    modelsByProvider: Map<
      string,
      { providerName: string; models: AvailableModel[] }
    >,
    type: "voice" | "llm",
    currentDefault: ConfiguredModel | undefined,
    search: string,
    setSearch: (v: string) => void,
  ) {
    const q = search.toLowerCase();

    return (
      <div className="border-border bg-card absolute z-20 mt-1 max-h-72 w-full overflow-hidden rounded-lg border shadow-lg">
        {/* Inline API key prompt */}
        {pendingKeyProvider && pendingModel && pendingModelType === type && (
          <div className="border-border border-b p-3">
            <p className="mb-2 text-xs font-medium">
              Enter API key for{" "}
              <span className="text-foreground font-semibold">
                {displayName(pendingKeyProvider, pendingModel.provider_name)}
              </span>
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPendingKey ? "text" : "password"}
                  value={pendingKeyValue}
                  onChange={(e) => setPendingKeyValue(e.target.value)}
                  placeholder="sk-..."
                  className="border-border bg-background w-full rounded border px-2.5 py-1.5 pr-8 font-mono text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") savePendingKeyAndModel();
                    if (e.key === "Escape") closePendingKey();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPendingKey(!showPendingKey)}
                  className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
                >
                  {showPendingKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <button
                type="button"
                onClick={savePendingKeyAndModel}
                disabled={!pendingKeyValue.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {!(pendingKeyProvider && pendingModelType === type) && (
          <>
            {/* Search input */}
            <div className="border-border border-b px-3 py-2">
              <div className="relative">
                <Search className="text-muted-foreground absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  className="bg-background w-full rounded border-none py-1 pl-7 pr-2 text-xs outline-none"
                />
              </div>
            </div>

            {/* Model list */}
            <div className="max-h-56 overflow-y-auto">
              {[...modelsByProvider.entries()].map(
                ([providerId, { providerName, models }]) => {
                  const filtered = q
                    ? models.filter(
                        (m) =>
                          m.model_name.toLowerCase().includes(q) ||
                          m.model_id.toLowerCase().includes(q) ||
                          providerName.toLowerCase().includes(q),
                      )
                    : models;

                  if (filtered.length === 0) return null;

                  return (
                    <div key={providerId}>
                      <div className="text-muted-foreground bg-secondary/50 sticky top-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider">
                        {providerName}
                        {!keyProviders.has(providerId) && (
                          <span className="text-destructive ml-1.5 normal-case tracking-normal">
                            (no API key)
                          </span>
                        )}
                      </div>
                      {filtered.slice(0, 20).map((model) => {
                        const isActive =
                          currentDefault?.model_id === model.model_id &&
                          currentDefault?.provider === model.provider_id;
                        return (
                          <button
                            key={model.model_id}
                            type="button"
                            onClick={() => selectModel(model, type)}
                            className={cn(
                              "hover:bg-secondary flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                              isActive && "bg-primary/5",
                            )}
                          >
                            <span className="flex-1">{model.model_name}</span>
                            {isActive && (
                              <Check size={14} className="text-primary" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                },
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-muted-foreground text-sm">Loading models...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Models</h1>
        <p className="text-muted-foreground mt-1">
          Configure voice and language models for transcription.
        </p>
      </div>

      {/* ================================================================= */}
      {/* Voice Model (required)                                             */}
      {/* ================================================================= */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">
            Voice Model <span className="text-destructive">*</span>
          </h2>
          <p className="text-muted-foreground text-sm">
            Select the speech-to-text model used for transcription.
          </p>
        </div>

        {!defaultVoice && (
          <div className="border-destructive/50 bg-destructive/5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <AlertTriangle className="text-destructive h-4 w-4 shrink-0" />
            <span className="text-destructive text-xs">
              No voice model configured. Select one below to start transcribing.
            </span>
          </div>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setVoiceDropdownOpen(!voiceDropdownOpen);
              setLlmDropdownOpen(false);
              setVoiceSearch("");
              closePendingKey();
            }}
            className={cn(
              "border-border hover:bg-secondary flex w-full items-center justify-between rounded-lg border px-4 py-2.5 text-sm",
              !defaultVoice && "border-destructive/50",
            )}
          >
            <div className="flex items-center gap-2">
              <Mic className="text-muted-foreground h-4 w-4" />
              {defaultVoice ? (
                <span>
                  {defaultVoice.model_name}{" "}
                  <span className="text-muted-foreground text-xs">
                    ({displayName(defaultVoice.provider)})
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Select a voice model...
                </span>
              )}
            </div>
            <ChevronDown
              className={cn(
                "text-muted-foreground h-4 w-4 transition-transform",
                voiceDropdownOpen && "rotate-180",
              )}
            />
          </button>

          {voiceDropdownOpen &&
            renderModelDropdown(
              voiceModelsByProvider,
              "voice",
              defaultVoice,
              voiceSearch,
              setVoiceSearch,
            )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* Post-processing (optional)                                         */}
      {/* ================================================================= */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Post-processing</h2>
          <p className="text-muted-foreground text-sm">
            Optionally use an LLM to clean up transcribed text before pasting.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            const next = !llmCleanup;
            setLlmCleanup(next);
            fetch(`${getApiBase()}/api/settings/llm_cleanup`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value: String(next) }),
            }).catch((err) =>
              console.error("Failed to save LLM cleanup:", err),
            );
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors",
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
              "h-5 w-9 shrink-0 rounded-full transition-colors",
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

        {llmCleanup && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setLlmDropdownOpen(!llmDropdownOpen);
                setVoiceDropdownOpen(false);
                setLlmSearch("");
                closePendingKey();
              }}
              className="border-border hover:bg-secondary flex w-full items-center justify-between rounded-lg border px-4 py-2.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="text-muted-foreground h-4 w-4" />
                {defaultLlm ? (
                  <span>
                    {defaultLlm.model_name}{" "}
                    <span className="text-muted-foreground text-xs">
                      ({displayName(defaultLlm.provider)})
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Select an LLM model...
                  </span>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "text-muted-foreground h-4 w-4 transition-transform",
                  llmDropdownOpen && "rotate-180",
                )}
              />
            </button>

            {llmDropdownOpen &&
              renderModelDropdown(
                llmModelsByProvider,
                "llm",
                defaultLlm,
                llmSearch,
                setLlmSearch,
              )}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* Providers (API Key Management)                                     */}
      {/* ================================================================= */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Providers</h2>
          <p className="text-muted-foreground text-sm">
            Manage API keys for your configured providers.
          </p>
        </div>

        {apiKeys.length === 0 ? (
          <div className="border-border rounded-lg border border-dashed px-4 py-6 text-center">
            <Key className="text-muted-foreground mx-auto mb-2 h-6 w-6" />
            <p className="text-muted-foreground text-sm">
              No providers configured yet. Select a model above to get started.
            </p>
          </div>
        ) : (
          <div className="border-border divide-border divide-y rounded-lg border">
            {apiKeys.map((entry) => (
              <div
                key={entry.provider}
                className="flex items-center gap-3 px-4 py-3"
              >
                <Key className="text-muted-foreground h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {displayName(entry.provider)}
                  </div>
                  {editingProvider === entry.provider ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <input
                          type={showEditKey ? "text" : "password"}
                          value={editKeyValue}
                          onChange={(e) => setEditKeyValue(e.target.value)}
                          placeholder="sk-..."
                          className="border-border bg-background w-full rounded border px-2 py-1 pr-7 font-mono text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              saveProviderKey(entry.provider);
                            if (e.key === "Escape") {
                              setEditingProvider(null);
                              setEditKeyValue("");
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowEditKey(!showEditKey)}
                          className="text-muted-foreground hover:text-foreground absolute right-1.5 top-1/2 -translate-y-1/2"
                        >
                          {showEditKey ? (
                            <EyeOff size={10} />
                          ) : (
                            <Eye size={10} />
                          )}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => saveProviderKey(entry.provider)}
                        className="text-primary"
                      >
                        <Check size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs">
                      API key configured &middot;{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProvider(entry.provider);
                          setEditKeyValue("");
                          setShowEditKey(false);
                        }}
                        className="text-primary/80 hover:text-primary underline"
                      >
                        update
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeProviderKey(entry.provider)}
                  className="text-muted-foreground hover:text-destructive rounded p-1.5"
                  title="Remove provider and its models"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
