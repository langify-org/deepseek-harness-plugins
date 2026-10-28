import { type Context, Service } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

/**
 * Stands in for DSH's tool runtime (`ctx.tools`), which needs the whole agent
 * composition: it keeps the definitions plugins register.
 */
export class RecordingTools extends Service {
  readonly registered: ToolDefinition[] = [];

  constructor(ctx: Context) {
    super(ctx, 'tools');
  }

  register(definition: ToolDefinition): () => void {
    this.registered.push(definition);
    return () => {
      this.registered.splice(this.registered.indexOf(definition), 1);
    };
  }

  /** The registered tool of that name. */
  definition(name: string): ToolDefinition {
    const tool = this.registered.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new Error(`no tool ${name} is registered`);
    return tool;
  }
}
