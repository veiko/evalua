import { defineStep, defineWorkflow } from '@evalua/core';
import { z } from 'zod';

const sourceFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  kind: z.enum(['html', 'js', 'css', 'md', 'other']).default('other'),
  description: z.string().optional(),
});

const rewriteInputSchema = z.object({
  files: z.array(sourceFileSchema).min(1, 'Provide at least one file to rewrite'),
  uxDescription: z.string().min(1, 'Describe the intended UX so clickable elements are clear'),
});

const rewrittenFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  notes: z.string().optional(),
});

const rewriteOutputSchema = z.object({
  files: z.array(rewrittenFileSchema),
  summary: z.string().optional(),
});

const semanticRewriteStep = defineStep({
  name: 'semantic_html_rewrite',
  input: rewriteInputSchema,
  output: rewriteOutputSchema,
  async run(ctx, input) {
    const serializedFiles = input.files
      .map(file => {
        const meta: string[] = [`Path: ${file.path}`, `Kind: ${file.kind ?? 'other'}`];
        if (file.description) meta.push(`Notes: ${file.description}`);
        return [meta.join(' | '), 'Content:', file.content].join('\n');
      })
      .join('\n\n-----\n\n');

    const message = [
      'Rewrite the provided front-end files to use semantic HTML and improve accessibility.',
      'Handle multiple files without inlining JavaScript or styles into HTML.',
      'Replace generic clickable containers with real controls (e.g., convert clickable <div> elements into <button type="button"> with accessible labels).',
      'Keep file paths the same, update related JavaScript so behavior remains intact, and ensure keyboard and screen reader support.',
      'Return valid JSON that follows the schema.',
      '',
      `UX description: ${input.uxDescription}`,
      '',
      'Files:',
      serializedFiles,
    ].join('\n');

    const { parsed } = await ctx.llm.generate<z.infer<typeof rewriteOutputSchema>>(ctx, {
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are an accessibility-focused frontend engineer. Improve semantics, ARIA where needed, and keyboard support while preserving functionality. Respond with JSON per the schema only.',
        },
        { role: 'user', content: message },
      ],
      schema: rewriteOutputSchema,
      temperature: 0,
    });

    return (
      parsed ?? {
        files: [],
        summary: 'No response generated',
      }
    );
  },
});

export const semanticHtmlWorkflow = defineWorkflow({
  name: 'semantic_html_workflow',
  input: rewriteInputSchema,
  output: rewriteOutputSchema,
  async run(ctx, input) {
    return semanticRewriteStep.run(ctx, input);
  },
});

export default semanticHtmlWorkflow;
