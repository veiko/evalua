import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z, ZodTypeAny } from 'zod';

export type RunId = string;
export type SpanId = string;

export type TraceEvent =
  | {
      type: 'span_start';
      timestamp: string;
      runId: RunId;
      spanId: SpanId;
      parentSpanId?: SpanId;
      name: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'span_end';
      timestamp: string;
      runId: RunId;
      spanId: SpanId;
      parentSpanId?: SpanId;
      name: string;
      metadata?: Record<string, unknown>;
      durationMs?: number;
      error?: string;
      costUsd?: number;
      tokens?: { input?: number; output?: number };
    }
  | {
      type: 'llm_call';
      timestamp: string;
      runId: RunId;
      spanId: SpanId;
      model: string;
      params?: Record<string, unknown>;
      requestHash?: string;
      raw?: unknown;
      parsed?: unknown;
      error?: string;
      tokens?: { in?: number; output?: number };
      costUsd?: number;
    }
  | {
      type: 'tool_call';
      timestamp: string;
      runId: RunId;
      spanId: SpanId;
      tool: string;
      input?: unknown;
      output?: unknown;
      error?: string;
    }
  | {
      type: 'validation_error';
      timestamp: string;
      runId: RunId;
      spanId: SpanId;
      direction: 'input' | 'output';
      issues: unknown;
    }
  | {
      type: 'artifact';
      timestamp: string;
      runId: RunId;
      spanId: SpanId;
      name: string;
      data: unknown;
    }
  | {
      type: 'event';
      timestamp: string;
      runId: RunId;
      spanId: SpanId;
      name: string;
      metadata?: Record<string, unknown>;
    };

export interface TraceSink {
  write(event: TraceEvent): void;
  close(): void;
}

export class JsonlTraceSink implements TraceSink {
  private stream: fs.WriteStream;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  write(event: TraceEvent): void {
    this.stream.write(`${JSON.stringify(event)}\n`);
  }

  close(): void {
    this.stream.close();
  }
}

export class Trace {
  constructor(
    private readonly runId: RunId,
    private readonly sink: TraceSink,
    private readonly spanId: SpanId,
    private readonly parentSpanId?: SpanId
  ) {}

  get id(): SpanId {
    return this.spanId;
  }

  get parentId(): SpanId | undefined {
    return this.parentSpanId;
  }

  get run(): RunId {
    return this.runId;
  }
  child(name: string, meta?: Record<string, unknown>): Trace {
    const childSpanId = randomUUID();
    const start: TraceEvent = {
      type: 'span_start',
      timestamp: new Date().toISOString(),
      runId: this.runId,
      spanId: childSpanId,
      parentSpanId: this.spanId,
      name,
      metadata: meta,
    };
    this.sink.write(start);
    return new Trace(this.runId, this.sink, childSpanId, this.spanId);
  }

  async span<T>(name: string, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
    const spanTrace = this.child(name, meta);
    const startTs = Date.now();
    try {
      const result = await fn();
      const end: TraceEvent = {
        type: 'span_end',
        timestamp: new Date().toISOString(),
        runId: this.runId,
        spanId: spanTrace.id,
        parentSpanId: spanTrace.parentId,
        name,
        durationMs: Date.now() - startTs,
      };
      this.sink.write(end);
      return result;
    } catch (err: any) {
      const end: TraceEvent = {
        type: 'span_end',
        timestamp: new Date().toISOString(),
        runId: this.runId,
        spanId: spanTrace.id,
        parentSpanId: spanTrace.parentId,
        name,
        durationMs: Date.now() - startTs,
        error: err?.message ?? String(err),
      };
      this.sink.write(end);
      throw err;
    }
  }

  event(name: string, metadata?: Record<string, unknown>): void {
    this.sink.write({
      type: 'event',
      timestamp: new Date().toISOString(),
      runId: this.runId,
      spanId: this.spanId,
      name,
      metadata,
    });
  }

  artifact(name: string, data: unknown): void {
    this.sink.write({
      type: 'artifact',
      timestamp: new Date().toISOString(),
      runId: this.runId,
      spanId: this.spanId,
      name,
      data,
    });
  }

  emit(event: TraceEvent): void {
    this.sink.write(event);
  }
}

export interface Tool<I = any, O = any> {
  name: string;
  input: ZodTypeAny;
  output: ZodTypeAny;
  invoke(ctx: Ctx, input: I): Promise<O>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  call(name: string, ctx: Ctx, input: unknown): Promise<unknown>;
}

export class InMemoryToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  async call(name: string, ctx: Ctx, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolError(`Tool not found: ${name}`);
    const validatedInput = validateWithZod(tool.input, input, 'input', ctx.trace, ctx.spanId);
    try {
      const output = await tool.invoke(ctx, validatedInput);
      const validatedOutput = validateWithZod(tool.output, output, 'output', ctx.trace, ctx.spanId);
      ctx.trace.emit({
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        spanId: ctx.spanId,
        tool: tool.name,
        input,
        output: validatedOutput,
      });
      return validatedOutput;
    } catch (err: any) {
      ctx.trace.emit({
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        spanId: ctx.spanId,
        tool: tool.name,
        input,
        error: err?.message ?? String(err),
      });
      throw err;
    }
  }
}

export interface LLMGenerateArgs {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schema?: ZodTypeAny;
  temperature?: number;
  maxTokens?: number;
  tools?: Array<Record<string, unknown>>;
}

export interface LLMGenerateResult<T = any> {
  raw: string;
  parsed?: T;
  tokens?: { in?: number; out?: number };
  costUsd?: number;
}

export interface LLMClient {
  generate<T>(ctx: Ctx, args: LLMGenerateArgs): Promise<LLMGenerateResult<T>>;
}

export interface Ctx {
  runId: RunId;
  spanId: SpanId;
  trace: Trace;
  llm: LLMClient;
  tools: ToolRegistry;
  cache?: Cache;
  policies?: Policies;
  child(stepName: string, meta?: Record<string, unknown>): Ctx;
}

export interface Policies {
  repairAttempts?: number;
  onValidationError?: 'fail' | 'skip';
}

export interface Cache {
  get(key: string): Promise<unknown | undefined> | unknown | undefined;
  set(key: string, value: unknown): Promise<void> | void;
}

export class RuntimeCtx implements Ctx {
  constructor(
    public readonly runId: RunId,
    public readonly spanId: SpanId,
    public readonly trace: Trace,
    public readonly llm: LLMClient,
    public readonly tools: ToolRegistry,
    public readonly cache?: Cache,
    public readonly policies?: Policies
  ) {}

  child(stepName: string, meta?: Record<string, unknown>): Ctx {
    const childTrace = this.trace.child(stepName, meta);
    return new RuntimeCtx(this.runId, childTrace.id, childTrace, this.llm, this.tools, this.cache, this.policies);
  }
}

export interface Step<I, O> {
  name: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  run(ctx: Ctx, input: I): Promise<O>;
}

export interface Workflow<I, O> {
  name: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  run(ctx: Ctx, input: I): Promise<O>;
}

export interface RunRecord {
  runId: RunId;
  target: string;
  status: 'success' | 'failure';
  startedAt: string;
  endedAt: string;
  costUsd?: number;
  tokens?: { in?: number; out?: number };
  durationMs?: number;
}

export class ValidationError extends Error {
  constructor(
    public readonly issues: unknown,
    message?: string
  ) {
    super(message ?? 'Validation failed');
  }
}

export class ToolError extends Error {}

function validateWithZod<T>(
  schema: z.ZodType<T>,
  value: unknown,
  direction: 'input' | 'output',
  trace: Trace,
  spanId: SpanId
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    trace.emit({
      type: 'validation_error',
      timestamp: new Date().toISOString(),
      runId: trace.run ?? 'unknown',
      spanId,
      direction,
      issues: result.error.issues,
    });
    throw new ValidationError(result.error.issues, `${direction} validation failed`);
  }
  return result.data;
}

export function defineStep<I, O>(step: Step<I, O>): Step<I, O> {
  const originalRun = step.run;
  return {
    ...step,
    async run(ctx: Ctx, input: I): Promise<O> {
      const spanCtx = ctx.child(step.name);
      const startedAt = Date.now();
      const validatedInput = validateWithZod(step.input, input, 'input', spanCtx.trace, spanCtx.spanId);
      try {
        const result = await originalRun(spanCtx, validatedInput);
        const validatedOutput = validateWithZod(step.output, result, 'output', spanCtx.trace, spanCtx.spanId);
        spanCtx.trace.emit({
          type: 'span_end',
          timestamp: new Date().toISOString(),
          runId: spanCtx.trace.run,
          spanId: spanCtx.spanId,
          parentSpanId: spanCtx.trace.parentId,
          name: step.name,
          durationMs: Date.now() - startedAt,
        });
        return validatedOutput;
      } catch (err: any) {
        spanCtx.trace.emit({
          type: 'span_end',
          timestamp: new Date().toISOString(),
          runId: spanCtx.trace.run,
          spanId: spanCtx.spanId,
          parentSpanId: spanCtx.trace.parentId,
          name: step.name,
          durationMs: Date.now() - startedAt,
          error: err?.message ?? String(err),
        });
        throw err;
      }
    },
  };
}

export function defineWorkflow<I, O>(workflow: Workflow<I, O>): Workflow<I, O> {
  const originalRun = workflow.run;
  return {
    ...workflow,
    async run(ctx: Ctx, input: I): Promise<O> {
      const spanCtx = ctx.child(workflow.name);
      const startedAt = Date.now();
      const validatedInput = validateWithZod(workflow.input, input, 'input', spanCtx.trace, spanCtx.spanId);
      try {
        const result = await originalRun(spanCtx, validatedInput);
        const validatedOutput = validateWithZod(workflow.output, result, 'output', spanCtx.trace, spanCtx.spanId);
        spanCtx.trace.emit({
          type: 'span_end',
          timestamp: new Date().toISOString(),
          runId: spanCtx.trace.run,
          spanId: spanCtx.spanId,
          parentSpanId: spanCtx.trace.parentId,
          name: workflow.name,
          durationMs: Date.now() - startedAt,
        });
        return validatedOutput;
      } catch (err: any) {
        spanCtx.trace.emit({
          type: 'span_end',
          timestamp: new Date().toISOString(),
          runId: spanCtx.trace.run,
          spanId: spanCtx.spanId,
          parentSpanId: spanCtx.trace.parentId,
          name: workflow.name,
          durationMs: Date.now() - startedAt,
          error: err?.message ?? String(err),
        });
        throw err;
      }
    },
  };
}

export function createRuntime(options: {
  llm: LLMClient;
  tools?: ToolRegistry;
  trace?: { sink?: TraceSink; directory?: string };
  cache?: Cache;
  policies?: Policies;
}) {
  const traceDir = options.trace?.directory ?? path.join(process.cwd(), 'traces');
  const defaultTools = options.tools ?? new InMemoryToolRegistry();

  async function run<TInput, TOutput>(
    target: Step<TInput, TOutput> | Workflow<TInput, TOutput>,
    input: TInput
  ): Promise<{ output: TOutput; record: RunRecord }> {
    const runId = randomUUID();
    const sink = options.trace?.sink ?? new JsonlTraceSink(path.join(traceDir, `${runId}.jsonl`));
    const rootSpanId = randomUUID();
    const trace = new Trace(runId, sink, rootSpanId);
    trace.emit({
      type: 'span_start',
      timestamp: new Date().toISOString(),
      runId,
      spanId: rootSpanId,
      name: target.name,
    });

    const ctx = new RuntimeCtx(runId, rootSpanId, trace, options.llm, defaultTools, options.cache, options.policies);
    const startedAt = Date.now();
    let status: RunRecord['status'] = 'success';
    try {
      const validatedInput = validateWithZod(target.input, input, 'input', trace, rootSpanId);
      const output = await target.run(ctx, validatedInput);
      const validatedOutput = validateWithZod(target.output, output, 'output', trace, rootSpanId);
      trace.emit({
        type: 'span_end',
        timestamp: new Date().toISOString(),
        runId,
        spanId: rootSpanId,
        name: target.name,
        durationMs: Date.now() - startedAt,
      });
      const record: RunRecord = {
        runId,
        target: target.name,
        status,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      };
      sink.close();
      return { output: validatedOutput, record };
    } catch (err: any) {
      status = 'failure';
      trace.emit({
        type: 'span_end',
        timestamp: new Date().toISOString(),
        runId,
        spanId: rootSpanId,
        name: target.name,
        durationMs: Date.now() - startedAt,
        error: err?.message ?? String(err),
      });
      sink.close();
      throw err;
    }
  }

  return { run, tools: defaultTools };
}
