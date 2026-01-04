import 'dotenv/config';
import { pathToFileURL } from 'url';
import { runEval } from '@evalua/eval';
import { createOpenAIRuntime } from '../../../run.js';
import { htmlAccessibilityEval } from './html-accessibility.eval';

async function main() {
  const runtime = createOpenAIRuntime();
  const result = await runEval(htmlAccessibilityEval, runtime);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
