import { z, ZodTypeAny } from "zod";
import {
  Ctx,
  LLMClient,
  LLMGenerateArgs,
  LLMGenerateResult,
  ValidationError,
} from "@pkg/core";

export type LLMResponder = (
  args: LLMGenerateArgs,
) => Promise<{ raw: string; tokens?: { in?: number; out?: number }; costUsd?: number }>;

export interface LLMClientOptions {
  responder: LLMResponder;
}

export class ProgrammableLLMClient implements LLMClient {
  constructor(private readonly options: LLMClientOptions) {}

  async generate<T>(ctx: Ctx, args: LLMGenerateArgs): Promise<LLMGenerateResult<T>> {
    const cacheKey = stableStringify({
      provider: "programmable",
      model: args.model,
      messages: args.messages,
      schema: args.schema?.toString?.(),
      temperature: args.temperature ?? 0,
      maxTokens: args.maxTokens,
      tools: args.tools ?? [],
    });

    const cached = await maybeGet(ctx.cache, cacheKey);
    if (cached) {
      return cached as LLMGenerateResult<T>;
    }

    const startedAt = Date.now();
    try {
      const response = await this.options.responder(args);
      const parsed = args.schema ? parseWithSchema(args.schema, response.raw) : undefined;
      const result: LLMGenerateResult<T> = {
        raw: response.raw,
        parsed: parsed as T | undefined,
        tokens: response.tokens,
        costUsd: response.costUsd,
      };

      ctx.trace.emit({
        type: "llm_call",
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        spanId: ctx.spanId,
        model: args.model,
        params: {
          temperature: args.temperature,
          maxTokens: args.maxTokens,
        },
        raw: response.raw,
        parsed,
        tokens: response.tokens,
        costUsd: response.costUsd,
      });

      await maybeSet(ctx.cache, cacheKey, result);
      return result;
    } catch (err: any) {
      ctx.trace.emit({
        type: "llm_call",
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        spanId: ctx.spanId,
        model: args.model,
        error: err?.message ?? String(err),
      });
      throw err;
    } finally {
      ctx.trace.event("llm_call_complete", { durationMs: Date.now() - startedAt });
    }
  }
}

export function parseWithSchema<T>(schema: ZodTypeAny, raw: string): T {
  let candidate: unknown = raw;
  try {
    candidate = JSON.parse(raw);
  } catch {
    // best effort: maybe the model already returned plain value
    candidate = raw;
  }
  const result = schema.safeParse(candidate);
  if (!result.success) {
    throw new ValidationError(result.error.issues, "LLM output failed schema validation");
  }
  return result.data as T;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

async function maybeGet(cache: Ctx["cache"], key: string): Promise<unknown | undefined> {
  if (!cache) return undefined;
  return cache.get(key);
}

async function maybeSet(cache: Ctx["cache"], key: string, value: unknown): Promise<void> {
  if (!cache) return;
  await cache.set(key, value);
}

export function createEchoLLM(): LLMClient {
  return new ProgrammableLLMClient({
    responder: async (args) => {
      const lastUser = [...args.messages].reverse().find((m) => m.role === "user");
      const raw = lastUser?.content ?? "";
      return { raw };
    },
  });
}

export function createStaticLLM(response: string): LLMClient {
  return new ProgrammableLLMClient({ responder: async () => ({ raw: response }) });
}
