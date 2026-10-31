import { ToolArgsError, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { expect, it } from 'vitest'
import { greetTool } from './index.ts'

const exec = {} as ToolRunContext

it('greets by name', async () => {
  await expect(greetTool.execute({ name: 'Ada' }, exec)).resolves.toBe('Hello, Ada!')
})

it('rejects arguments from the model that miss the name', async () => {
  await expect(greetTool.execute({}, exec)).rejects.toThrow(ToolArgsError)
})
