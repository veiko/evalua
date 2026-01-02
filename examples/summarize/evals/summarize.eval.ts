import { z } from 'zod';
import { Dataset, Judge, defineEval } from '@evalua/eval';
import { summarizeWorkflow } from '../workflows/summarize.js';

type SummarizeInput = z.infer<typeof summarizeWorkflow.input>;
type SummarizeOutput = z.infer<typeof summarizeWorkflow.output>;

const summarizeTiny: Dataset<SummarizeInput> = {
  name: 'summarize:tiny',
  cases: [
    {
      id: 'renewable-energy',
      input: {
        text: `Renewable energy sources such as solar, wind, and geothermal are becoming cheaper than fossil fuels in many regions. However, the variability of these sources poses challenges for grid reliability. Energy storage, demand response, and upgraded transmission lines are critical to ensure stable power supply as renewables scale.`,
        maxWords: 60,
      },
      expected: ['renewable', 'solar', 'wind', 'storage'],
    },
    {
      id: 'climate-policy',
      input: {
        text: `Several cities have adopted climate action plans that combine emissions reductions with resilience investments. These plans often emphasize public transit expansion, building electrification, and green space development. Progress is uneven because funding, political support, and community engagement vary widely across regions.`,
        maxWords: 55,
      },
      expected: ['climate action', 'transit', 'electrification', 'green space'],
    },
  ],
};

const keyTermJudge: Judge<SummarizeInput, SummarizeOutput> = ({
  output,
  expected,
}: {
  output: SummarizeOutput;
  expected?: unknown;
}) => {
  const terms = Array.isArray(expected) ? expected : [];
  const normalizedSummary = output.summary.toLowerCase();
  const matched = terms.filter(term => normalizedSummary.includes(String(term).toLowerCase()));
  const score = terms.length ? matched.length / terms.length : 1;

  return {
    metrics: { key_terms: Number(score.toFixed(2)) },
    notes: terms.length ? `Matched ${matched.length} of ${terms.length} key terms` : undefined,
  };
};

const brevityJudge: Judge<SummarizeInput, SummarizeOutput> = ({
  input,
  output,
}: {
  input: SummarizeInput;
  output: SummarizeOutput;
}) => {
  const wordCount = output.summary.trim().split(/\s+/).filter(Boolean).length;
  const limit = input.maxWords ?? 80;
  const ratio = wordCount === 0 ? 0 : Math.min(1, limit / wordCount);

  return {
    metrics: { brevity: Number(ratio.toFixed(2)) },
    notes: `Summary used ${wordCount} words (limit ${limit})`,
  };
};

export const summarizeEval = defineEval({
  name: 'summarize_eval',
  target: summarizeWorkflow,
  dataset: summarizeTiny,
  judges: [keyTermJudge, brevityJudge],
  thresholds: {
    key_terms: 0.75,
    brevity: 0.6,
  },
});

export default summarizeEval;
