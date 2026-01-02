import { Step, Workflow } from "@pkg/core";

export type Case<I> = {
  id: string;
  input: I;
  tags?: string[];
  expected?: unknown;
  rubric?: string;
  metadata?: Record<string, any>;
};

export type Dataset<I> = {
  name: string;
  cases: Case<I>[];
};

export type Score = {
  metrics: Record<string, number>;
  notes?: string;
  artifacts?: Record<string, any>;
};

export type Judge<I, O> = (args: {
  input: I;
  output: O;
  expected?: unknown;
  trace: any;
}) => Promise<Score> | Score;

export type EvalSpec<I, O> = {
  name: string;
  target: Step<I, O> | Workflow<I, O>;
  dataset: Dataset<I>;
  judges: Judge<I, O>[];
  thresholds: Record<string, number>;
};

export function defineEval<I, O>(spec: EvalSpec<I, O>): EvalSpec<I, O> {
  return spec;
}

export type EvalCaseResult = {
  id: string;
  metrics: Record<string, number>;
  notes?: string[];
  artifacts?: Record<string, any>[];
};

export type EvalRunResult = {
  name: string;
  dataset: string;
  cases: EvalCaseResult[];
  aggregates: Record<string, number>;
  passed: boolean;
};

export async function runEval<I, O>(spec: EvalSpec<I, O>, runtime: { run: (target: any, input: any) => Promise<{ output: O }> }): Promise<EvalRunResult> {
  const cases: EvalCaseResult[] = [];
  const aggregates: Record<string, number[]> = {};
  for (const c of spec.dataset.cases) {
    const { output } = await runtime.run(spec.target, c.input);
    const metrics: Record<string, number> = {};
    const notes: string[] = [];
    const artifacts: Record<string, any>[] = [];

    for (const judge of spec.judges) {
      const score = await judge({ input: c.input, output, expected: c.expected, trace: {} });
      Object.entries(score.metrics).forEach(([k, v]) => {
        aggregates[k] = aggregates[k] ?? [];
        aggregates[k].push(v);
        metrics[k] = v;
      });
      if (score.notes) notes.push(score.notes);
      if (score.artifacts) artifacts.push(score.artifacts);
    }

    cases.push({ id: c.id, metrics, notes: notes.length ? notes : undefined, artifacts: artifacts.length ? artifacts : undefined });
  }

  const aggregateSummary: Record<string, number> = {};
  Object.entries(aggregates).forEach(([k, values]) => {
    aggregateSummary[k] = values.reduce((a, b) => a + b, 0) / values.length;
  });

  const passed = Object.entries(spec.thresholds).every(([metric, threshold]) => {
    const achieved = aggregateSummary[metric];
    return achieved !== undefined && achieved >= threshold;
  });

  return {
    name: spec.name,
    dataset: spec.dataset.name,
    cases,
    aggregates: aggregateSummary,
    passed,
  };
}
