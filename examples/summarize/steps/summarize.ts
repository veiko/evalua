import { defineStep, defineWorkflow } from '@evalua/core';
import { z } from 'zod';

const summarizeInputSchema = z.object({
  text: z.string().min(1, 'Provide text to summarize'),
  maxWords: z.number().int().positive().max(200).default(80),
});

const summarizeOutputSchema = z.object({
  summary: z.string(),
});

export const summarizeStep = defineStep({
  name: 'summarize_step',
  input: summarizeInputSchema,
  output: summarizeOutputSchema,
  async run(ctx, input) {
    const maxWords = input.maxWords ?? 80;
    const { parsed } = await ctx.llm.generate<{ summary: string }>(ctx, {
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a concise assistant that creates faithful summaries. Use the schema to return the summary in JSON format.',
        },
        {
          role: 'user',
          content: [
            `Summarize the following text in ${maxWords} words or fewer.`,
            'Prioritize clarity, avoid embellishment, and keep key terms intact.',
            '',
            input.text,
          ].join('\n'),
        },
      ],
      schema: summarizeOutputSchema,
      temperature: 0,
    });

    return {
      summary: parsed?.summary ?? '',
    };
  },
});

export const summarizeWorkflow = defineWorkflow({
  name: 'summarize_workflow',
  input: summarizeInputSchema,
  output: summarizeOutputSchema,
  async run(ctx, input) {
    return summarizeStep.run(ctx, input);
  },
});

export default summarizeWorkflow;
