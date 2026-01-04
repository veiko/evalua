import { z } from 'zod';
import { Dataset, Judge, defineEval } from '@evalua/eval';
import { semanticHtmlWorkflow } from '../workflows/semanticHtml.js';

type SemanticInput = z.infer<typeof semanticHtmlWorkflow.input>;
type SemanticOutput = z.infer<typeof semanticHtmlWorkflow.output>;

const legacyDataset: Dataset<SemanticInput> = {
  name: 'html-accessibility:cta',
  cases: [
    {
      id: 'clickable-div-to-button',
      input: {
        uxDescription:
          'A primary call-to-action labeled "Start evaluation" should look and behave like a button. It must be keyboard accessible and update a status region as the user starts.',
        files: [
          {
            path: 'public/index.html',
            kind: 'html',
            content: `<!doctype html>
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
</html>`,
          },
          {
            path: 'public/cta.js',
            kind: 'js',
            content: `const cta = document.getElementById('cta');
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
});`,
          },
        ],
      },
      expected: {
        htmlPath: 'public/index.html',
        scriptPath: 'public/cta.js',
        htmlMustContain: ['<button', 'type="button"', 'aria-live="polite"'],
        scriptMustContainAny: ['keydown', 'Enter', 'Space', 'click'],
      },
    },
  ],
};

const semanticButtonJudge: Judge<SemanticInput, SemanticOutput> = ({ output, expected }) => {
  const htmlPath = (expected as any)?.htmlPath ?? 'public/index.html';
  const mustContain: string[] = (expected as any)?.htmlMustContain ?? [];

  const htmlFile = output.files.find(file => file.path === htmlPath);
  const html = htmlFile?.content ?? '';
  const hits = mustContain.filter(token => html.includes(token));
  const score = mustContain.length ? hits.length / mustContain.length : 1;

  return {
    metrics: { semantic_button: Number(score.toFixed(2)) },
    notes: htmlFile ? `Found ${hits.length}/${mustContain.length} required HTML markers` : 'HTML file missing',
  };
};

const keyboardSupportJudge: Judge<SemanticInput, SemanticOutput> = ({ output, expected }) => {
  const scriptPath = (expected as any)?.scriptPath ?? 'public/cta.js';
  const mustAny: string[] = (expected as any)?.scriptMustContainAny ?? [];

  const scriptFile = output.files.find(file => file.path === scriptPath);
  const script = scriptFile?.content ?? '';
  const matches = mustAny.filter(token => script.toLowerCase().includes(token.toLowerCase()));
  const score = matches.length > 0 ? 1 : 0;

  return {
    metrics: { keyboard_support: score },
    notes: scriptFile ? `Keyboard-related tokens matched: ${matches.join(', ') || 'none'}` : 'Script file missing',
  };
};

export const htmlAccessibilityEval = defineEval({
  name: 'html_accessibility_eval',
  target: semanticHtmlWorkflow,
  dataset: legacyDataset,
  judges: [semanticButtonJudge, keyboardSupportJudge],
  thresholds: {
    semantic_button: 0.9,
    keyboard_support: 1,
  },
});

export default htmlAccessibilityEval;
