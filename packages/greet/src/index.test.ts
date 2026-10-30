import type { Context } from '@deepseek-ai/cordis'
import { ToolArgsError, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply, greetTool } from './index.ts'

const exec = {} as ToolRunContext

describe('greet', () => {
  it('greets by name', async () => {
    await expect(greetTool.execute({ name: 'Ada' }, exec)).resolves.toBe('Hello, Ada!')
  })

  it('rejects a missing name', async () => {
    await expect(greetTool.execute({}, exec)).rejects.toThrow(ToolArgsError)
  })

  it('registers the tool', () => {
    const register = vi.fn<(definition: ToolDefinition) => () => void>()
    apply({ tools: { register } } as unknown as Context)
    expect(register).toHaveBeenCalledWith(greetTool)
  })
})
