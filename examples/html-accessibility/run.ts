import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import OpenAI from 'openai';
import { Cache, createRuntime } from '@evalua/core';
import { ProgrammableLLMClient } from '@evalua/llm';
import { semanticHtmlWorkflow } from './workflows/semanticHtml';

class FileCache implements Cache {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private fileFor(key: string): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.baseDir, `${hash}.json`);
  }

  async get(key: string): Promise<unknown | undefined> {
    const file = this.fileFor(key);
    try {
      const contents = await fs.promises.readFile(file, 'utf-8');
      return JSON.parse(contents);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const file = this.fileFor(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(value, null, 2), 'utf-8');
  }
}

export function createOpenAILLM(apiKey: string): ProgrammableLLMClient {
  const openai = new OpenAI({ apiKey });
  return new ProgrammableLLMClient({
    responder: async args => {
      const completion = await openai.chat.completions.create({
        model: args.model,
        messages: args.messages,
        ...(args.temperature !== undefined && args.temperature !== 0 && { temperature: args.temperature }),
        max_tokens: args.maxTokens,
        response_format: args.schema ? { type: 'json_object' } : undefined,
      });

      const messageContent = completion.choices[0]?.message?.content ?? '';
      const raw = typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent);

      return {
        raw,
        tokens: {
          in: completion.usage?.prompt_tokens ?? undefined,
          out: completion.usage?.completion_tokens ?? undefined,
        },
      };
    },
  });
}

export function createOpenAIRuntime(options?: { apiKey?: string; cacheDir?: string; traceDir?: string }) {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Set OPENAI_API_KEY to run the example');
  }

  const cacheDir = options?.cacheDir ?? path.join(process.cwd(), 'cache');
  const traceDir = options?.traceDir ?? path.join(process.cwd(), 'traces');

  return createRuntime({
    llm: createOpenAILLM(apiKey),
    cache: new FileCache(cacheDir),
    trace: {
      directory: traceDir,
    },
  });
}

async function main() {
  const runtime = createOpenAIRuntime();

  const legacyHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Evaluation CTA</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="page">
      <div class="header">Ready to start your evaluation?</div>
      <div class="content">Click the primary action below to begin.</div>
      <div id="cta" class="cta primary" role="button" tabindex="0" aria-label="Start evaluation">
        Start evaluation
      </div>
      <div id="status" class="status" aria-live="polite"></div>
    </div>
    <script src="./cta.js"></script>
  </body>
</html>`;

  const legacyScript = `const cta = document.getElementById('cta');
const status = document.getElementById('status');

cta?.addEventListener('click', () => {
  if (status) {
    status.textContent = 'Preparing your evaluation...';
  }
});

cta?.addEventListener('keypress', event => {
  if (event.key === 'Enter') {
    cta.click();
  }
});`;

  const uxDescription =
    'A single hero call-to-action labeled "Start evaluation" should look and behave like a primary button. It must be obviously clickable, keyboard accessible, and announce progress in the status area.';

  const { output, record } = await runtime.run(semanticHtmlWorkflow, {
    uxDescription,
    files: [
      {
        path: 'public/index.html',
        content: legacyHtml,
        kind: 'html',
        description: 'Legacy markup uses divs for everything, including the primary call-to-action.',
      },
      {
        path: 'public/cta.js',
        content: legacyScript,
        kind: 'js',
        description: 'Handles the click on the CTA and updates status text.',
      },
    ],
  });

  console.log('Rewritten files:');
  for (const file of output.files) {
    console.log(`--- ${file.path} ---`);
    console.log(file.content);
    if (file.notes) {
      console.log(`Notes: ${file.notes}`);
    }
    console.log('');
  }

  if (output.summary) {
    console.log('Summary:');
    console.log(output.summary);
  }

  console.log('Run record:');
  console.log(JSON.stringify(record, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
