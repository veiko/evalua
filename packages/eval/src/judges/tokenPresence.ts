import { Judge } from '../index.js';

type ContentProvider<I, O> =
  | ((args: { input: I; output: O; expected?: unknown }) => string)
  | ((args: { input: I; output: O; expected?: unknown }) => { text: string; label?: string });

type TokenProvider<I, O> = (args: { input: I; output: O; expected?: unknown }) => string[];

export type TokenPresenceJudgeOptions<I, O> = {
  metric: string;
  content: ContentProvider<I, O>;
  tokens: TokenProvider<I, O>;
  normalize?: (value: string) => string;
  scoreWhenNoTokens?: number;
};

/**
 * createTokenPresenceJudge builds a simple judge that scores based on how many expected
 * tokens appear in a provided text content.
 */
export function createTokenPresenceJudge<I, O>(options: TokenPresenceJudgeOptions<I, O>): Judge<I, O> {
  const normalize = options.normalize ?? (value => value);
  const scoreWhenNoTokens = options.scoreWhenNoTokens ?? 1;

  return ({ input, output, expected }) => {
    const contentResult = options.content({ input, output, expected });
    const text = typeof contentResult === 'string' ? contentResult : contentResult.text;
    const label = typeof contentResult === 'string' ? undefined : contentResult.label;

    const tokens = options.tokens({ input, output, expected });
    const normalizedText = normalize(text ?? '');

    const hits = tokens.filter(token => normalizedText.includes(normalize(token ?? '')));
    const score = tokens.length ? hits.length / tokens.length : scoreWhenNoTokens;

    return {
      metrics: { [options.metric]: Number(score.toFixed(2)) },
      notes: label
        ? `${label}: matched ${hits.length}/${tokens.length || 0} tokens`
        : `Matched ${hits.length}/${tokens.length || 0} tokens`,
    };
  };
}
