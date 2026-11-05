import { describe, expect, it } from 'vitest'
import {
  atPrompt,
  digest,
  parseWindows,
  shortPath,
  readsOnly,
  tmuxCommand,
  WINDOW_FORMAT,
  type TmuxWindow,
} from './windows.ts'

const row = (...fields: string[]): string => fields.join('\u001f')

describe('parseWindows', () => {
  it('reads list-windows output in WINDOW_FORMAT order', () => {
    expect(WINDOW_FORMAT.split('\u001f')).toHaveLength(4)
    const output = [
      row('@0', 'bash', 'bash', '/home/u/repo'),
      row('@3', 'dev | server', 'node', '/home/u/repo'),
      '',
      'garbage',
      row('x', 'bad id', 'bash', '/'),
    ].join('\n')
    expect(parseWindows(output)).toEqual([
      { id: '@0', name: 'bash', command: 'bash', path: '/home/u/repo' },
      { id: '@3', name: 'dev | server', command: 'node', path: '/home/u/repo' },
    ])
  })
})

const w = (extra: Partial<TmuxWindow>): TmuxWindow => ({
  id: '@0',
  name: 'bash',
  command: 'bash',
  path: '/home/u/repo',
  ...extra,
})

describe('digest', () => {
  it('lists windows as XML, without contents', () => {
    const text = digest([w({ id: '@0' }), w({ id: '@1', name: 'dev', command: 'pnpm' })], '/home/u')
    expect(text).toBe(
      [
        '<tmux>',
        '<window id="@0" name="bash" path="~/repo" command="bash"/>',
        '<window id="@1" name="dev" path="~/repo" command="pnpm"/>',
        '</tmux>',
      ].join('\n'),
    )
  })

  it('escapes names and folders', () => {
    const text = digest([w({ name: 'a "b" <c> & d', path: '/x"y' })], '/home/u')
    expect(text).toContain('name="a &quot;b&quot; &lt;c&gt; &amp; d" path="/x&quot;y"')
  })

  it('is absent without windows', () => {
    expect(digest([], '/home/u')).toBeUndefined()
  })

  it('treats shells, including login shells, as at a prompt', () => {
    expect(atPrompt(w({ command: '-zsh' }))).toBe(true)
    expect(atPrompt(w({ command: 'vim' }))).toBe(false)
  })
})

describe('shortPath', () => {
  it('writes the home directory as ~ only at a path boundary', () => {
    expect(shortPath('/home/u', '/home/u')).toBe('~')
    expect(shortPath('/home/u/a', '/home/u')).toBe('~/a')
    expect(shortPath('/home/user2', '/home/u')).toBe('/home/user2')
    expect(shortPath('/x', '')).toBe('/x')
  })
})

describe('tmuxCommand', () => {
  it('aims the command at the target, right after its name', () => {
    expect(tmuxCommand('@3.1', 'send-keys', ['-l', 'ls'], '/w')).toEqual([
      'send-keys',
      '-t',
      '@3.1',
      '-l',
      'ls',
    ])
  })

  it("starts new shells in the conversation's folder and prints new window ids", () => {
    expect(tmuxCommand('=dsh-s1:', 'new-window', ['-d', '-n', 'tests'], '/w')).toEqual([
      'new-window',
      '-t',
      '=dsh-s1:',
      '-c',
      '/w',
      '-P',
      '-F',
      '#{window_id}',
      '-d',
      '-n',
      'tests',
    ])
    expect(tmuxCommand('@3', 'split-window', ['-c', '/x'], '/w')).toEqual([
      'split-window',
      '-t',
      '@3',
      '-c',
      '/x',
    ])
  })

  it("refuses -a on the list commands, which reaches every conversation's windows", () => {
    expect(() => tmuxCommand('=dsh-s1:', 'list-windows', ['-a'], '/w')).toThrow('-a')
    expect(() => tmuxCommand('@3', 'list-panes', ['-aF', '#{pane_id}'], '/w')).toThrow('-a')
    expect(() => tmuxCommand('=dsh-s1:', 'lsw', ['-a'], '/w')).toThrow('-a')
    expect(tmuxCommand('@3', 'capture-pane', ['-pa'], '/w')).toEqual([
      'capture-pane',
      '-t',
      '@3',
      '-pa',
    ])
  })

  it('refuses a target of its own and what is not a command name', () => {
    expect(() => tmuxCommand('@3', 'capture-pane', ['-p', '-t', '@9'], '/w')).toThrow('-t')
    expect(() => tmuxCommand('@3', '-S', [], '/w')).toThrow('not a tmux command name')
    expect(() => tmuxCommand('@3', 'send-keys;kill-server', [], '/w')).toThrow(
      'not a tmux command name',
    )
  })
})

describe('readsOnly', () => {
  it('lets reading commands through', () => {
    expect(readsOnly('capture-pane', ['-p'])).toBe(true)
    expect(readsOnly('capture-pane', ['-pJ', '-S', '-100'])).toBe(true)
    expect(readsOnly('list-windows', ['-F', '#{window_name}'])).toBe(true)
    expect(readsOnly('show-options', ['-w'])).toBe(true)
  })

  it('refuses commands that change something or can run a shell command', () => {
    expect(readsOnly('send-keys', ['ls', 'Enter'])).toBe(false)
    expect(readsOnly('list-windows', ['-F', '#(rm -rf ~)'])).toBe(false)
    expect(readsOnly('capture-pane', ['-p', ';'])).toBe(false)
    expect(readsOnly('capture-pane', ['-p', 'x;'])).toBe(false)
    expect(readsOnly('capture-pane', [])).toBe(false)
    expect(readsOnly('capture-pane', ['-p', '-b', 'buf'])).toBe(false)
    expect(readsOnly('display-message', ['-p', '#W'])).toBe(false)
  })
})
