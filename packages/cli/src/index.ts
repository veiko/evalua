#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { createRuntime } from "@evalua/core";
import { runEval } from "@evalua/eval";
import { createEchoLLM } from "@evalua/llm";

const program = new Command();
program
  .name("evalua")
  .description("Evaluation-driven agentic workflow toolkit");

program
  .command("run")
  .argument("target", "Path to workflow or step export")
  .option("--input <file>", "JSON file with input")
  .action(async (target, options) => {
    const mod = await import(path.resolve(target));
    const exported =
      mod.default ?? mod.workflow ?? mod.step ?? Object.values(mod)[0];
    if (!exported) throw new Error("No export found in target module");
    const input = options.input
      ? JSON.parse(fs.readFileSync(options.input, "utf-8"))
      : {};
    const runtime = createRuntime({ llm: createEchoLLM() });
    const { output, record } = await runtime.run(exported as any, input);
    console.log(JSON.stringify({ output, record }, null, 2));
  });

program
  .command("eval")
  .argument("spec", "Path to eval definition")
  .action(async (specPath) => {
    const mod = await import(path.resolve(specPath));
    const spec = mod.default ?? Object.values(mod)[0];
    const runtime = createRuntime({ llm: createEchoLLM() });
    const result = await runEval(spec as any, runtime);
    if (!result.passed) {
      console.error("Eval failed", JSON.stringify(result, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  });

program.parseAsync();
