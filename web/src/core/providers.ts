// The AI providers the smart engine can talk to. They all speak the OpenAI
// chat API, so a preset is just a base URL and a default model.

export type ProviderId = "openrouter" | "gemini" | "deepseek" | "groq" | "openai" | "ollama" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseUrl: string;
  model: string;
}

export interface ModelOption {
  id: string;
  name: string;
}

export const PROVIDERS: readonly ProviderPreset[] = [
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat" },
  { id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
  { id: "custom", name: "Custom", baseUrl: "", model: "" },
];

export const POPULAR_MODELS: Record<ProviderId, readonly ModelOption[]> = {
  gemini: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  ],
  openrouter: [
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek Chat (V3)" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
    { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
  ],
  openai: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "o3-mini", name: "o3-mini" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
  ],
  ollama: [
    { id: "qwen2.5:7b", name: "Qwen 2.5 7B" },
    { id: "llama3.2", name: "Llama 3.2" },
    { id: "mistral", name: "Mistral 7B" },
    { id: "gemma2", name: "Gemma 2" },
  ],
  custom: [],
};

const CACHE_KEY = "arizo_cached_models_v1";
const MEMORY_CACHE = new Map<string, ModelOption[]>();

export function getCachedModels(baseUrl: string): ModelOption[] | null {
  const key = trimUrl(baseUrl);
  if (MEMORY_CACHE.has(key)) return MEMORY_CACHE.get(key)!;
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cache = JSON.parse(raw);
        if (Array.isArray(cache[key])) {
          MEMORY_CACHE.set(key, cache[key]);
          return cache[key];
        }
      }
    }
  } catch {}
  return null;
}

export function saveCachedModels(baseUrl: string, models: readonly { id: string; displayName?: string }[]) {
  const key = trimUrl(baseUrl);
  const formatted: ModelOption[] = models.map((m) => ({
    id: m.id,
    name: m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id,
  }));
  MEMORY_CACHE.set(key, formatted);
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      cache[key] = formatted;
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    }
  } catch {}
}

export function getAvailableModels(baseUrl: string, currentModel?: string): ModelOption[] {
  const cached = getCachedModels(baseUrl);
  const provider = providerForUrl(baseUrl);
  const presets = POPULAR_MODELS[provider] || [];

  const list: ModelOption[] = [];
  if (cached && cached.length > 0) {
    list.push(...cached);
  } else if (presets.length > 0) {
    list.push(...presets);
  }

  // Ensure currentModel is present in list
  if (currentModel && currentModel.trim() && !list.some((m) => m.id === currentModel)) {
    list.unshift({ id: currentModel, name: currentModel });
  }

  return list;
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Which preset a base URL belongs to; anything unknown is "custom". */
export function providerForUrl(baseUrl: string): ProviderId {
  const u = trimUrl(baseUrl);
  return PROVIDERS.find((p) => p.id !== "custom" && trimUrl(p.baseUrl) === u)?.id ?? "custom";
}

export function providerById(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

/** What picking a preset fills in. "custom" keeps the address and model the user has. */
export function applyPreset(
  id: ProviderId,
  current: { baseUrl: string; model: string },
): { baseUrl: string; model: string } {
  if (id === "custom") return { ...current };
  const p = providerById(id);
  return { baseUrl: p.baseUrl, model: p.model };
}

/** A local server needs no key. */
export function needsKey(baseUrl: string): boolean {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseUrl.trim());
}
