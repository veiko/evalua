import 'dotenv/config';
import { pathToFileURL } from 'url';
import { runEval } from '@evalua/eval';
import { createOpenAIRuntime } from '../../../run.js';
import { htmlAccessibilityButtonEval } from './button.eval.js';
import { htmlAccessibilityTooltipEval } from './tooltip.eval.js';

async function main() {
  const runtime = createOpenAIRuntime();
  const results = [];

  results.push(await runEval(htmlAccessibilityButtonEval, runtime));
  results.push(await runEval(htmlAccessibilityTooltipEval, runtime));

  console.log(JSON.stringify(results, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
