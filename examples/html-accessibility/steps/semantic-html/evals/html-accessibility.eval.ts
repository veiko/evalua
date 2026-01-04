import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Dataset, defineEval, createTokenPresenceJudge } from '@evalua/eval';
import { semanticHtmlWorkflow } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');
const loadPublic = (file: string) => fs.readFileSync(path.join(publicDir, file), 'utf-8');

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
            content: loadPublic('cta.html'),
          },
          {
            path: 'public/cta.js',
            kind: 'js',
            content: loadPublic('cta.js'),
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
    {
      id: 'tooltip-div-to-button',
      input: {
        uxDescription:
          'An info icon should present a tooltip explaining data collection. It must be discoverable by screen readers, toggle with keyboard focus/Enter/Space, and hide on Escape or blur.',
        files: [
          {
            path: 'public/index.html',
            kind: 'html',
            content: loadPublic('tooltip.html'),
          },
          {
            path: 'public/tooltip.js',
            kind: 'js',
            content: loadPublic('tooltip.js'),
          },
        ],
      },
      expected: {
        htmlPath: 'public/index.html',
        scriptPath: 'public/tooltip.js',
        htmlMustContain: ['role="tooltip"', 'aria-describedby', '<button'],
        scriptMustContainAny: ['keydown', 'focus', 'blur', 'Escape', 'Space', 'Enter'],
      },
    },
  ],
};

const htmlRequirementsJudge = createTokenPresenceJudge<SemanticInput, SemanticOutput>({
  metric: 'html_requirements',
  content: ({ output, expected }) => {
    const htmlPath = (expected as any)?.htmlPath ?? 'public/index.html';
    const htmlFile = output.files.find(file => file.path === htmlPath);
    return { text: htmlFile?.content ?? '', label: htmlFile ? htmlFile.path : 'HTML file missing' };
  },
  tokens: ({ expected }) => ((expected as any)?.htmlMustContain ?? []) as string[],
});

const scriptRequirementsJudge = createTokenPresenceJudge<SemanticInput, SemanticOutput>({
  metric: 'script_requirements',
  content: ({ output, expected }) => {
    const scriptPath = (expected as any)?.scriptPath ?? 'public/cta.js';
    const scriptFile = output.files.find(file => file.path === scriptPath);
    return {
      text: scriptFile?.content ?? '',
      label: scriptFile ? scriptFile.path : 'Script file missing',
    };
  },
  tokens: ({ expected }) => ((expected as any)?.scriptMustContainAny ?? []) as string[],
  normalize: value => value.toLowerCase(),
});

export const htmlAccessibilityEval = defineEval({
  name: 'html_accessibility_eval',
  target: semanticHtmlWorkflow,
  dataset: legacyDataset,
  judges: [htmlRequirementsJudge, scriptRequirementsJudge],
  thresholds: {
    html_requirements: 0.9,
    script_requirements: 0.6,
  },
});

export default htmlAccessibilityEval;
