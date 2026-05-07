import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type UnknownRecord = Record<string, unknown>;

type PiModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

const PROVIDER = "neuralwatt";
const API_KEY_ENV = "NEURALWATT_API_KEY";
const BASE_URL = "https://api.neuralwatt.com/v1";
const MODELS_URL = `${BASE_URL}/models`;
const CACHE_FILE = join(homedir(), ".pi", "agent", "neuralwatt-models.json");

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return fallback;
}

function pickNumber(record: UnknownRecord, keys: string[], fallback: number): number {
  for (const key of keys) {
    if (record[key] !== undefined) return asNumber(record[key], fallback);
  }
  return fallback;
}

function normalizeCost(model: UnknownRecord): PiModel["cost"] {
  const metadata = asRecord(model.metadata) ?? {};
  const pricing = asRecord(model.pricing) ?? asRecord(model.cost) ?? asRecord(metadata.pricing) ?? {};
  return {
    input: pickNumber(pricing, ["input", "prompt", "prompt_tokens", "input_cost", "prompt_cost", "input_per_million"], 0),
    output: pickNumber(
      pricing,
      ["output", "completion", "completion_tokens", "output_cost", "completion_cost", "output_per_million"],
      0,
    ),
    cacheRead: pickNumber(
      pricing,
      ["cacheRead", "cache_read", "cached_input", "cache_read_input", "cached_input_per_million"],
      0,
    ),
    cacheWrite: pickNumber(pricing, ["cacheWrite", "cache_write", "cache_write_input"], 0),
  };
}

function normalizeInput(model: UnknownRecord): Array<"text" | "image"> {
  const metadata = asRecord(model.metadata) ?? {};
  const capabilities = asRecord(model.capabilities) ?? asRecord(metadata.capabilities) ?? {};
  const candidates = [model.input, model.input_modalities, model.modalities, model.capabilities, metadata.capabilities].flatMap(
    (value) => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []),
  );
  const image =
    asBoolean(capabilities.vision, false) ||
    candidates.some((value) => ["image", "vision", "images"].includes(String(value).toLowerCase()));
  return image ? ["text", "image"] : ["text"];
}

function normalizeModel(raw: unknown): PiModel | undefined {
  const model = asRecord(raw);
  if (!model) return undefined;

  const metadata = asRecord(model.metadata) ?? {};
  const capabilities = asRecord(model.capabilities) ?? asRecord(metadata.capabilities) ?? {};
  const limits = asRecord(model.limits) ?? asRecord(metadata.limits) ?? {};

  const id = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : undefined;
  if (!id) return undefined;

  const displayName = typeof metadata.display_name === "string" ? metadata.display_name : undefined;

  return {
    id,
    name: typeof model.name === "string" ? model.name : (displayName ?? id),
    reasoning: asBoolean(
      model.reasoning ?? model.supports_reasoning ?? model.thinking ?? capabilities.reasoning ?? capabilities.reasoning_effort,
      false,
    ),
    input: normalizeInput(model),
    cost: normalizeCost(model),
    contextWindow: pickNumber(
      { ...limits, ...model },
      ["contextWindow", "context_window", "context_length", "max_context_tokens", "max_context_length", "max_model_len"],
      128000,
    ),
    maxTokens: pickNumber({ ...limits, ...model }, ["maxTokens", "max_tokens", "max_output_tokens", "output_token_limit"], 16384),
  };
}

function extractModels(payload: unknown): PiModel[] {
  const record = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : [];

  const seen = new Set<string>();
  const models: PiModel[] = [];
  for (const item of list) {
    const model = normalizeModel(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

async function fetchJson(apiKey: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(MODELS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const preview = body.trim().slice(0, 500);
    throw new Error(`NeuralWatt models request failed: HTTP ${response.status}${preview ? `: ${preview}` : ""}`);
  }

  return response.json();
}

function modelsFromPayload(payload: unknown, source: string): PiModel[] {
  const models = extractModels(payload);
  if (models.length === 0) throw new Error(`NeuralWatt ${source} contains no usable models`);
  return models;
}

async function saveModelsPayload(payload: unknown): Promise<void> {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function cacheFileExists(): Promise<boolean> {
  try {
    await access(CACHE_FILE);
    return true;
  } catch {
    return false;
  }
}

async function loadCachedModels(): Promise<PiModel[]> {
  const payload = JSON.parse(await readFile(CACHE_FILE, "utf8")) as unknown;
  return modelsFromPayload(payload, CACHE_FILE);
}

async function getNeuralWattApiKey(ctx?: Pick<ExtensionContext, "modelRegistry">): Promise<string> {
  const envApiKey = process.env[API_KEY_ENV];
  if (envApiKey) return envApiKey;

  const storedApiKey = await ctx?.modelRegistry.getApiKeyForProvider(PROVIDER);
  if (storedApiKey) return storedApiKey;

  throw new Error(`Missing NeuralWatt credentials. Run /login ${PROVIDER} or set ${API_KEY_ENV}.`);
}

async function fetchAndCacheNeuralWattModels(apiKey: string, signal?: AbortSignal): Promise<PiModel[]> {
  const payload = await fetchJson(apiKey, signal);
  await saveModelsPayload(payload);
  return loadCachedModels();
}

function registerNeuralWattProvider(pi: ExtensionAPI, models: PiModel[]) {
  pi.registerProvider(PROVIDER, {
    baseUrl: BASE_URL,
    apiKey: API_KEY_ENV,
    api: "openai-completions",
    headers: {
      "x-api-key": API_KEY_ENV,
    },
    models,
  });
}

async function update(pi: ExtensionAPI, ctx?: Pick<ExtensionContext, "modelRegistry" | "ui">, notify = true): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const apiKey = await getNeuralWattApiKey(ctx);
    const models = await fetchAndCacheNeuralWattModels(apiKey, controller.signal);
    registerNeuralWattProvider(pi, models);
    if (notify) {
      ctx?.ui.notify(
        `NeuralWatt: saved ${CACHE_FILE} and registered ${models.length} model(s). Open /model and choose provider '${PROVIDER}'.`,
        "info",
      );
    }
    return models.length;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function neuralWattExtension(pi: ExtensionAPI) {
  let initialAutoUpdateAttempted = false;
  pi.registerCommand("nw-update", {
    description: "Fetch NeuralWatt models and register/update the neuralwatt provider",
    handler: async (_args, ctx) => {
      try {
        await update(pi, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`NeuralWatt update failed: ${message}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (initialAutoUpdateAttempted) return;
    initialAutoUpdateAttempted = true;
    if (await cacheFileExists()) return;

    try {
      await update(pi, ctx, false);
      ctx.ui.notify(`NeuralWatt: fetched models automatically on first run.`, "info");
    } catch (error) {
      console.warn(
        `[neuralwatt] automatic initial model fetch skipped. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  // Register from the persisted /models JSON at startup so Pi doesn't hit the network on every launch.
  // If there is no cache yet, still register the provider so /login works like standard Pi providers.
  // Run /nw-update after /login to fetch ~/.pi/agent/neuralwatt-models.json from NeuralWatt.
  try {
    registerNeuralWattProvider(pi, await loadCachedModels());
  } catch (error) {
    registerNeuralWattProvider(pi, []);
    console.warn(
      `[neuralwatt] no cached models loaded from ${CACHE_FILE}. Provider still registered for /login. Run /nw-update after authenticating. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
