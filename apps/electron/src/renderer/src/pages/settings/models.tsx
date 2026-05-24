import { cn } from "@renderer/lib/utils";
import {
  Check,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  Key,
  Mic,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "http://localhost:4649";

// Popular providers shown first when adding
const POPULAR_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "elevenlabs",
  "deepgram",
  "groq",
  "mistral",
  "openrouter",
];

interface AvailableModel {
  provider_id: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  family: string;
  type: "voice" | "llm";
  cost_input?: number;
  cost_output?: number;
}

interface ConfiguredModel {
  id: number;
  provider: string;
  model_id: string;
  model_name: string;
  type: string;
  is_default: number;
  created_at: string;
}

interface ApiKey {
  provider: string;
  created_at: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  voiceModels: AvailableModel[];
  llmModels: AvailableModel[];
}

type Step = "closed" | "pick-provider" | "enter-key" | "pick-models";

export default function ModelsPage(): React.JSX.Element {
  const [available, setAvailable] = useState<AvailableModel[]>([]);
  const [configured, setConfigured] = useState<ConfiguredModel[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-provider wizard state
  const [step, setStep] = useState<Step>("closed");
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(
    null,
  );
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Edit key inline
  const [editingKeyProvider, setEditingKeyProvider] = useState<string | null>(
    null,
  );
  const [editKeyValue, setEditKeyValue] = useState("");
  const [showEditKey, setShowEditKey] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [availRes, configRes, keysRes] = await Promise.all([
        fetch(`${API_BASE}/api/models/available`),
        fetch(`${API_BASE}/api/models/configured`),
        fetch(`${API_BASE}/api/keys`),
      ]);
      if (availRes.ok) setAvailable(await availRes.json());
      if (configRes.ok) setConfigured(await configRes.json());
      if (keysRes.ok) setApiKeys(await keysRes.json());
    } catch (err) {
      console.error("Failed to load models data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build provider list from available models
  const providers: ProviderInfo[] = (() => {
    const map = new Map<string, ProviderInfo>();
    for (const m of available) {
      let p = map.get(m.provider_id);
      if (!p) {
        p = {
          id: m.provider_id,
          name: m.provider_name,
          voiceModels: [],
          llmModels: [],
        };
        map.set(m.provider_id, p);
      }
      if (m.type === "voice") p.voiceModels.push(m);
      else p.llmModels.push(m);
    }
    return [...map.values()];
  })();

  const keyProviders = new Set(apiKeys.map((k) => k.provider));

  // Filter providers for the picker
  const filteredProviders = providers.filter(
    (p) =>
      !providerSearch ||
      p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
      p.id.toLowerCase().includes(providerSearch.toLowerCase()),
  );

  const popularProviders = filteredProviders.filter((p) =>
    POPULAR_PROVIDERS.includes(p.id),
  );
  const otherProviders = filteredProviders.filter(
    (p) => !POPULAR_PROVIDERS.includes(p.id),
  );

  // -- Actions --

  const resetWizard = useCallback(() => {
    setStep("closed");
    setSelectedProvider(null);
    setProviderSearch("");
    setModelSearch("");
    setKeyValue("");
    setShowKey(false);
  }, []);

  const selectProvider = useCallback(
    (provider: ProviderInfo) => {
      setSelectedProvider(provider);
      // If already has API key, skip to model selection
      if (keyProviders.has(provider.id)) {
        setStep("pick-models");
      } else {
        setStep("enter-key");
      }
    },
    [keyProviders],
  );

  const saveKeyAndProceed = useCallback(async () => {
    if (!keyValue.trim() || !selectedProvider) return;
    await fetch(`${API_BASE}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: selectedProvider.id,
        key: keyValue.trim(),
      }),
    });
    await loadData();
    setStep("pick-models");
    setKeyValue("");
  }, [keyValue, selectedProvider, loadData]);

  const addModel = useCallback(
    async (model: AvailableModel) => {
      const sameType = configured.filter((c) => c.type === model.type);
      await fetch(`${API_BASE}/api/models/configured`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: model.provider_id,
          model_id: model.model_id,
          model_name: model.model_name,
          type: model.type,
          is_default: sameType.length === 0,
        }),
      });
      loadData();
    },
    [configured, loadData],
  );

  const removeModel = useCallback(
    async (id: number) => {
      await fetch(`${API_BASE}/api/models/configured/${id}`, {
        method: "DELETE",
      });
      loadData();
    },
    [loadData],
  );

  const setDefault = useCallback(
    async (id: number) => {
      await fetch(`${API_BASE}/api/models/configured/${id}/default`, {
        method: "PUT",
      });
      loadData();
    },
    [loadData],
  );

  const saveEditKey = useCallback(
    async (provider: string) => {
      if (!editKeyValue.trim()) return;
      await fetch(`${API_BASE}/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: editKeyValue.trim() }),
      });
      setEditingKeyProvider(null);
      setEditKeyValue("");
      setShowEditKey(false);
      loadData();
    },
    [editKeyValue, loadData],
  );

  const removeProvider = useCallback(
    async (providerId: string) => {
      // Remove all models for this provider
      const models = configured.filter((m) => m.provider === providerId);
      await Promise.all(
        models.map((m) =>
          fetch(`${API_BASE}/api/models/configured/${m.id}`, {
            method: "DELETE",
          }),
        ),
      );
      // Remove API key
      await fetch(`${API_BASE}/api/keys/${providerId}`, { method: "DELETE" });
      loadData();
    },
    [configured, loadData],
  );

  // Group configured models by provider
  const configuredByProvider = new Map<string, ConfiguredModel[]>();
  for (const m of configured) {
    const list = configuredByProvider.get(m.provider) ?? [];
    list.push(m);
    configuredByProvider.set(m.provider, list);
  }

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
          Add a provider, enter your API key, and pick which models to use for
          voice and text.
        </p>
      </div>

      {/* Configured providers */}
      {configuredByProvider.size > 0 && (
        <div className="space-y-4">
          {[...configuredByProvider.entries()].map(([providerId, models]) => {
            const providerInfo = providers.find((p) => p.id === providerId);
            const hasKey = keyProviders.has(providerId);
            const voiceModels = models.filter((m) => m.type === "voice");
            const llmModels = models.filter((m) => m.type === "llm");

            return (
              <div key={providerId} className="border-border rounded-xl border">
                {/* Provider header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="bg-secondary flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold uppercase">
                    {(providerInfo?.name ?? providerId).slice(0, 2)}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">
                      {providerInfo?.name ?? providerId}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Key size={10} />
                      {editingKeyProvider === providerId ? (
                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <input
                              ref={keyInputRef}
                              type={showEditKey ? "text" : "password"}
                              value={editKeyValue}
                              onChange={(e) => setEditKeyValue(e.target.value)}
                              placeholder="sk-..."
                              className="border-border bg-background w-48 rounded border px-2 py-0.5 pr-7 font-mono text-[11px]"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEditKey(providerId);
                                if (e.key === "Escape") {
                                  setEditingKeyProvider(null);
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
                            onClick={() => saveEditKey(providerId)}
                            className="text-primary"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingKeyProvider(null);
                              setEditKeyValue("");
                            }}
                            className="text-muted-foreground"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : hasKey ? (
                        <span>
                          API key configured{" "}
                          <button
                            type="button"
                            onClick={() => setEditingKeyProvider(providerId)}
                            className="text-primary/80 hover:text-primary underline"
                          >
                            update
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingKeyProvider(providerId)}
                          className="text-destructive"
                        >
                          No API key - click to add
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProvider(
                        providerInfo ?? {
                          id: providerId,
                          name: providerId,
                          voiceModels: [],
                          llmModels: [],
                        },
                      );
                      setStep("pick-models");
                    }}
                    className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg p-1.5"
                    title="Add more models"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeProvider(providerId)}
                    className="text-muted-foreground hover:text-destructive rounded-lg p-1.5"
                    title="Remove provider"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Models list */}
                {(voiceModels.length > 0 || llmModels.length > 0) && (
                  <div className="border-border border-t px-4 py-2">
                    {voiceModels.length > 0 && (
                      <div className="py-1">
                        <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                          <Mic size={10} /> Voice
                        </div>
                        {voiceModels.map((m) => (
                          <ModelRow
                            key={m.id}
                            model={m}
                            onSetDefault={setDefault}
                            onRemove={removeModel}
                          />
                        ))}
                      </div>
                    )}
                    {llmModels.length > 0 && (
                      <div className="py-1">
                        <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                          <Cpu size={10} /> LLM
                        </div>
                        {llmModels.map((m) => (
                          <ModelRow
                            key={m.id}
                            model={m}
                            onSetDefault={setDefault}
                            onRemove={removeModel}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add provider button */}
      <button
        type="button"
        onClick={() => setStep("pick-provider")}
        className="border-border hover:bg-secondary flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-4 text-sm font-medium transition-colors"
      >
        <Plus size={16} />
        Add Provider
      </button>

      {/* === Wizard Dialog === */}
      {step !== "closed" && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-card border-border w-full max-w-lg rounded-xl border shadow-xl">
            {/* Step 1: Pick provider */}
            {step === "pick-provider" && (
              <div className="p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Add Provider</h3>
                  <button
                    type="button"
                    onClick={resetWizard}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={20} />
                  </button>
                </div>
                <input
                  type="text"
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  placeholder="Search providers..."
                  className="border-border bg-background mb-3 w-full rounded-lg border px-3 py-2 text-sm"
                />
                <div className="max-h-80 space-y-1 overflow-y-auto">
                  {popularProviders.length > 0 && !providerSearch && (
                    <div className="text-muted-foreground mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider">
                      Popular
                    </div>
                  )}
                  {(providerSearch ? filteredProviders : popularProviders).map(
                    (p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectProvider(p)}
                        className="hover:bg-secondary flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                      >
                        <div className="bg-secondary flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold uppercase">
                          {p.name.slice(0, 2)}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="text-muted-foreground text-xs">
                            {p.voiceModels.length > 0 &&
                              `${p.voiceModels.length} voice`}
                            {p.voiceModels.length > 0 &&
                              p.llmModels.length > 0 &&
                              ", "}
                            {p.llmModels.length > 0 &&
                              `${p.llmModels.length} LLM`}
                            {p.voiceModels.length === 0 &&
                              p.llmModels.length === 0 &&
                              "models"}
                          </div>
                        </div>
                        {keyProviders.has(p.id) && (
                          <span className="text-primary text-[10px] font-medium">
                            Key saved
                          </span>
                        )}
                        <ChevronRight
                          size={16}
                          className="text-muted-foreground"
                        />
                      </button>
                    ),
                  )}
                  {!providerSearch && otherProviders.length > 0 && (
                    <>
                      <div className="text-muted-foreground mb-1 mt-3 px-1 text-[10px] font-semibold uppercase tracking-wider">
                        Other
                      </div>
                      {otherProviders.slice(0, 30).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectProvider(p)}
                          className="hover:bg-secondary flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
                        >
                          <div className="bg-secondary flex h-7 w-7 items-center justify-center rounded text-[10px] font-bold uppercase">
                            {p.name.slice(0, 2)}
                          </div>
                          <div className="flex-1 text-sm">{p.name}</div>
                          <ChevronRight
                            size={14}
                            className="text-muted-foreground"
                          />
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Enter API key */}
            {step === "enter-key" && selectedProvider && (
              <div className="p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">
                      Connect {selectedProvider.name}
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      Enter your API key for {selectedProvider.name}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetWizard}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={keyValue}
                      onChange={(e) => setKeyValue(e.target.value)}
                      placeholder="sk-..."
                      className="border-border bg-background w-full rounded-lg border px-3 py-2.5 pr-10 font-mono text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveKeyAndProceed();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="text-muted-foreground hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStep("pick-provider")}
                      className="border-border hover:bg-secondary rounded-lg border px-4 py-2 text-sm"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={saveKeyAndProceed}
                      disabled={!keyValue.trim()}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Save & Continue
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Pick models */}
            {step === "pick-models" && selectedProvider && (
              <div className="p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {selectedProvider.name} Models
                    </h3>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      Select models to use. Click to add.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetWizard}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={20} />
                  </button>
                </div>
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Search models..."
                  className="border-border bg-background mb-3 w-full rounded-lg border px-3 py-2 text-sm"
                />
                <div className="max-h-72 space-y-0.5 overflow-y-auto">
                  {[
                    {
                      label: "Voice",
                      models: selectedProvider.voiceModels,
                      icon: Mic,
                    },
                    {
                      label: "LLM",
                      models: selectedProvider.llmModels,
                      icon: Cpu,
                    },
                  ].map(({ label, models: sectionModels, icon: Icon }) => {
                    const filtered = sectionModels.filter(
                      (m) =>
                        !modelSearch ||
                        m.model_name
                          .toLowerCase()
                          .includes(modelSearch.toLowerCase()) ||
                        m.model_id
                          .toLowerCase()
                          .includes(modelSearch.toLowerCase()),
                    );
                    if (filtered.length === 0) return null;

                    const alreadyAdded = new Set(
                      configured
                        .filter((c) => c.provider === selectedProvider.id)
                        .map((c) => `${c.model_id}:${c.type}`),
                    );

                    return (
                      <div key={label}>
                        <div className="text-muted-foreground flex items-center gap-1.5 px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider">
                          <Icon size={10} /> {label}
                        </div>
                        {filtered.slice(0, 30).map((model) => {
                          const isAdded = alreadyAdded.has(
                            `${model.model_id}:${model.type}`,
                          );
                          return (
                            <button
                              key={model.model_id}
                              type="button"
                              onClick={() => !isAdded && addModel(model)}
                              disabled={isAdded}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                                isAdded ? "opacity-50" : "hover:bg-secondary",
                              )}
                            >
                              <div className="flex-1">
                                <div className="font-medium">
                                  {model.model_name}
                                </div>
                                {model.cost_input != null && (
                                  <div className="text-muted-foreground text-xs">
                                    ${model.cost_input}/M input
                                  </div>
                                )}
                              </div>
                              {isAdded ? (
                                <Check size={14} className="text-primary" />
                              ) : (
                                <Plus
                                  size={14}
                                  className="text-muted-foreground"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={resetWizard}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-2 text-sm font-medium"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({
  model,
  onSetDefault,
  onRemove,
}: {
  model: ConfiguredModel;
  onSetDefault: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5",
        model.is_default && "bg-primary/5",
      )}
    >
      <span className="flex-1 text-sm">{model.model_name}</span>
      {model.is_default === 1 ? (
        <span className="text-primary text-[10px] font-semibold uppercase tracking-wider">
          Default
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onSetDefault(model.id)}
          title="Set as default"
          className="text-muted-foreground hover:text-primary rounded p-1"
        >
          <Star size={12} />
        </button>
      )}
      <button
        type="button"
        onClick={() => onRemove(model.id)}
        title="Remove"
        className="text-muted-foreground hover:text-destructive rounded p-1"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
