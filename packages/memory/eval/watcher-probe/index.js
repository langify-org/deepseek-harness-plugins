// Watcher replay probe: in a throwaway DSH home, asks the watcher's model each case of
// $DSH_HOME/watcher-cases.json with each system prompt variant, and writes the replies to
// $DSH_HOME/watcher-result.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

export const name = 'memory-watcher-probe'
export const inject = ['llm']

export function apply(ctx) {
  const home = process.env.DSH_HOME
  const spec = JSON.parse(readFileSync(join(home, 'watcher-cases.json'), 'utf8'))
  const out = { results: [], done: false }
  const save = () => writeFileSync(join(home, 'watcher-result.json'), JSON.stringify(out))
  const jobs = []
  for (const c of spec.cases)
    for (const v of spec.only ?? Object.keys(spec.variants))
      for (let r = 0; r < spec.runs; r++) jobs.push({ c, v, r })
  let next = 0
  const one = async ({ c, v, r }) => {
    const started = Date.now()
    const signal = AbortSignal.timeout(60_000)
    try {
      const call = await ctx.llm.prepareCall(
        {
          provider: 'anthropic',
          model: 'claude-haiku-5-5',
          maxTokens: 2000,
          reasoningEffort: ReasoningEffortId('low'),
        },
        signal,
      )
      const assembler = new BlockAssembler()
      const options = {
        ...call.config,
        system: spec.variants[v][c.set],
        messages: [
          createUserMessage({
            content: [{ type: 'text', text: c.request }],
            source: {
              kind: 'langify-memory-hunch',
              form: 'notice',
              summary: 'What the watcher was shown',
            },
          }),
        ],
        signal,
      }
      for await (const chunk of call.stream(options)) assembler.push(chunk)
      const { finish } = assembler
      if (finish.kind === 'error' || finish.kind === 'aborted')
        throw new Error(finish.failure.message)
      const reply = assembler
        .blocks()
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('\n')
      out.results.push({ name: c.name, v, r, ms: Date.now() - started, reply })
    } catch (error) {
      out.results.push({
        name: c.name,
        v,
        r,
        ms: Date.now() - started,
        error: String(error?.message ?? error),
      })
    }
    save()
  }
  const worker = async () => {
    while (next < jobs.length) await one(jobs[next++])
  }
  ctx.effect(() => {
    // The LLM providers register after the plugins start: give them a moment.
    void new Promise((resolve) => setTimeout(resolve, 5000))
      .then(() => Promise.all([worker(), worker(), worker()]))
      .finally(() => {
        out.done = true
        save()
      })
    return () => {}
  })
}
