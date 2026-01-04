import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Dataset, defineEval, createTokenPresenceJudge } from '@evalua/eval';
import { semanticHtmlWorkflow } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');
const loadPublic = (file: string) => fs.readFileSync(path.join(publicDir, file), 'utf-8');

type SemanticInput = typeof semanticHtmlWorkflow.input._type;
type SemanticOutput = typeof semanticHtmlWorkflow.output._type;

const tooltipDataset: Dataset<SemanticInput> = {
  name: 'html-accessibility:tooltip',
  cases: [
    {
      id: 'tooltip-div-to-control',
      input: {
        uxDescription:
          'An info icon should present a tooltip explaining data collection. It must be discoverable by screen readers, toggle with keyboard focus/Enter/Space, and hide on Escape or blur.',
        files: [
          {
            path: 'public/index.html',
            kind: 'html',
            content: loadPublic('tooltip.html'),
            description: 'Info icon is a div, tooltip markup is hidden via CSS classes only.',
          },
          {
            path: 'public/tooltip.js',
            kind: 'js',
            content: loadPublic('tooltip.js'),
            description: 'Toggles tooltip on hover/click only; lacks keyboard and aria wiring.',
          },
        ],
      },
      expected: {
        htmlPath: 'public/index.html',
        scriptPath: 'public/tooltip.js',
        htmlMustContain: ['role="tooltip"', 'aria-describedby', '<button'],
        scriptMustContainAny: ['keydown', 'focus', 'blur', 'escape', 'space', 'enter'],
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
    const scriptPath = (expected as any)?.scriptPath ?? 'public/tooltip.js';
    const scriptFile = output.files.find(file => file.path === scriptPath);
    return {
      text: scriptFile?.content ?? '',
      label: scriptFile ? scriptFile.path : 'Script file missing',
    };
  },
  tokens: ({ expected }) => ((expected as any)?.scriptMustContainAny ?? []) as string[],
  normalize: value => value.toLowerCase(),
});

export const htmlAccessibilityTooltipEval = defineEval({
  name: 'html_accessibility_tooltip_eval',
  target: semanticHtmlWorkflow,
  dataset: tooltipDataset,
  judges: [htmlRequirementsJudge, scriptRequirementsJudge],
  thresholds: {
    html_requirements: 0.9,
    script_requirements: 0.6,
  },
});

export default htmlAccessibilityTooltipEval;
