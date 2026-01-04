# evalua

LLM-native workflows and evals with zod-validated steps, runtime tracing, and caching.

Evalua helps you build and ship LLM features with guardrails:
- Define typed steps/workflows with zod schemas so prompts and outputs stay predictable.
- Run against multiple providers (OpenAI today; Anthropic or others by swapping the client).
- Cache and trace runs to debug prompt changes quickly.
- Practice eval-driven development (EDD): write datasets + judges + thresholds, run them in CI, and iterate until they pass.

## Getting started (new project)
1) Install packages:
```bash
npm i @evalua/core @evalua/llm @evalua/eval zod
npm i -D @evalua/cli typescript tsx
```

2) Define a workflow (`src/steps/summarize.ts`):
```ts
import { z } from 'zod';
import { defineWorkflow, defineStep } from '@evalua/core';

const SummarizeIn = z.object({ text: z.string().min(1) });
const SummarizeOut = z.object({ summary: z.string().min(1) });

export const summarizeStep = defineStep({
  name: 'summarize',
  input: SummarizeIn,
  output: SummarizeOut,
  async run(ctx, input) {
    const res = await ctx.llm.generate({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'Return JSON: {summary: string}. Be concise.' },
        { role: 'user', content: input.text },
      ],
      schema: SummarizeOut,
      temperature: 0,
    });
    return res.parsed!;
  },
});

export const summarizeWorkflow = defineWorkflow({
  name: 'summarize-workflow',
  input: SummarizeIn,
  output: SummarizeOut,
  async run(ctx, input) {
    return summarizeStep.run(ctx.child('summarize'), input);
  },
});
```

3) Wire a runtime (`src/run.ts`):
```ts
import OpenAI from 'openai';
import { createRuntime } from '@evalua/core';
import { ProgrammableLLMClient } from '@evalua/llm';
import { summarizeWorkflow } from './steps/summarize';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const runtime = createRuntime({
  llm: new ProgrammableLLMClient({
    responder: async args => {
      const completion = await openai.chat.completions.create({
        model: args.model,
        messages: args.messages,
        response_format: args.schema ? { type: 'json_object' } : undefined,
        temperature: args.temperature ?? 0,
        max_tokens: args.maxTokens,
      });
      const content = completion.choices[0]?.message?.content ?? '';
      return { raw: typeof content === 'string' ? content : JSON.stringify(content) };
    },
  }),
  trace: { directory: 'traces' }, // optional JSONL traces
  // cache: your cache implementation (file/redis/etc); see examples/summarize/run.ts
});

const result = await runtime.run(summarizeWorkflow, { text: 'TypeScript is a typed superset of JavaScript...' });
console.log(result.output.summary);
```

4) Add a script to `package.json`:
```json
{ "scripts": { "run:one": "tsx src/run.ts" } }
```
Run it with `OPENAI_API_KEY=... npm run run:one`.

## Add an eval
```ts
import { defineEval } from '@evalua/eval';
import { summarizeWorkflow } from '../steps/summarize';

export default defineEval({
  name: 'summarize:minimal',
  target: summarizeWorkflow,
  dataset: {
    name: 'summarize:tiny',
    cases: [
      { id: 'short-1', input: { text: 'Dogs are domesticated mammals kept as pets.' }, expected: { mustIncludeAny: ['pets'] } },
    ],
  },
  judges: [
    ({ output, expected }) => {
      const must = (expected as any)?.mustIncludeAny ?? [];
      const ok = must.length === 0 || must.some((w: string) => output.summary.toLowerCase().includes(w));
      return { metrics: { contains_key_terms: ok ? 1 : 0 } };
    },
    ({ output }) => {
      const words = output.summary.trim().split(/\s+/).length;
      return { metrics: { brevity: words <= 25 ? 1 : 0 } };
    },
  ],
  thresholds: { contains_key_terms: 1, brevity: 1 },
});
```
Then run `yourpkg eval summarize:minimal` (or script it via `@evalua/cli`).

## Judges and reuse
- Judges are plain functions that score outputs. You can write custom logic or reuse helpers.
- A shared helper, `createTokenPresenceJudge` (`packages/eval/src/judges/tokenPresence.ts`), checks whether required tokens appear in a string (useful for HTML/JS/text).
- Custom judges remain fully supported; mix and match them per eval.

## Repo examples
- A runnable summarization example lives in `examples/summarize` (workflow + eval). After a root `yarn install`, run `yarn --cwd examples/summarize workflow` to generate a summary and `yarn --cwd examples/summarize eval` to execute the eval.
- An accessibility rewrite example lives in `examples/html-accessibility` and shows how to feed multiple files (HTML + JS) to the LLM to convert clickable divs into proper buttons and tooltips into accessible controls. Sample inputs live under `examples/html-accessibility/public`. Run it with `yarn --cwd examples/html-accessibility workflow` and `yarn --cwd examples/html-accessibility eval`.
- Local artifacts write to `examples/<example>/traces` and `examples/<example>/cache`; both are gitignored and safe to delete or point elsewhere.
