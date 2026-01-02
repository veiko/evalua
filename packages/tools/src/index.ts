import { InMemoryToolRegistry, Tool, ToolRegistry } from "@evalua/core";

export function createToolRegistry(tools: Tool[] = []): ToolRegistry {
  const registry = new InMemoryToolRegistry();
  tools.forEach((tool) => registry.register(tool));
  return registry;
}

export function defineTool<I, O>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}

export { Tool, ToolRegistry } from "@evalua/core";
