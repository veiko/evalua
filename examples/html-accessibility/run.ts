import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import OpenAI from 'openai';
import { Cache, createRuntime } from '@evalua/core';
import { ProgrammableLLMClient } from '@evalua/llm';
import { semanticHtmlWorkflow } from './steps/semantic-html';

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

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(__dirname, 'public');
  const loadPublic = (relativePath: string) => fs.readFileSync(path.join(publicDir, relativePath), 'utf-8');

  const uxDescription =
    'A single hero call-to-action labeled "Start evaluation" should look and behave like a primary button. It must be obviously clickable, keyboard accessible, and announce progress in the status area.';

  const tooltipUxDescription =
    'An info icon should present a tooltip explaining data collection. It must be discoverable by screen readers, toggle with keyboard focus/Enter/Space, and hide on Escape or blur.';

  const scenarios = [
    {
      name: 'CTA button rewrite',
      uxDescription,
      files: [
        {
          path: 'public/index.html',
          content: loadPublic('cta.html'),
          kind: 'html',
          description: 'Legacy markup uses divs for everything, including the primary call-to-action.',
        },
        {
          path: 'public/cta.js',
          content: loadPublic('cta.js'),
          kind: 'js',
          description: 'Handles the click on the CTA and updates status text.',
        },
      ],
    },
    {
      name: 'Tooltip rewrite',
      uxDescription: tooltipUxDescription,
      files: [
        {
          path: 'public/index.html',
          content: loadPublic('tooltip.html'),
          kind: 'html',
          description: 'Info icon is a div, tooltip markup is hidden via CSS classes only.',
        },
        {
          path: 'public/tooltip.js',
          content: loadPublic('tooltip.js'),
          kind: 'js',
          description: 'Toggles tooltip on hover/click only; lacks keyboard and aria wiring.',
        },
      ],
    },
  ];

  for (const scenario of scenarios) {
    const { output, record } = await runtime.run(semanticHtmlWorkflow, scenario);

    console.log(`Scenario: ${scenario.name}`);
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
    console.log('========================\n');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
