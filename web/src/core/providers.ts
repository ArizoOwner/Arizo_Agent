// The AI providers the smart engine can talk to. They all speak the OpenAI
// chat API, so a preset is just a base URL and a default model.

export type ProviderId = "openrouter" | "gemini" | "deepseek" | "groq" | "openai" | "ollama" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseUrl: string;
  model: string;
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
