// The tab's styles, with DSH's design tokens; wterm's own stylesheet comes first.
// The terminal follows DSH's theme as DSH's own terminal does: its background,
// text and terminal font tokens, which switch with light and dark, and xterm's
// 16 colors, for which DSH has no tokens.

export const cls = {
  root: 'langify-tmux-root',
  screen: 'langify-tmux-screen',
  notices: 'langify-tmux-notices',
  status: 'langify-tmux-status',
  title: 'langify-tmux-title',
  guideIcon: 'langify-tmux-guide-icon',
} as const

/** xterm's default 16 colors, which DSH's own terminal uses in both themes. */
const ANSI = [
  '#2e3436',
  '#cc0000',
  '#4e9a06',
  '#c4a000',
  '#3465a4',
  '#75507b',
  '#06989a',
  '#d3d7cf',
  '#555753',
  '#ef2929',
  '#8ae234',
  '#fce94f',
  '#729fcf',
  '#ad7fa8',
  '#34e2e2',
  '#eeeeec',
]

const TERMINAL_FONT_SIZE = 'var(--dsh-terminal-font-size,13px)'

export const CSS: string = `${WTERM_CSS}
.${cls.root}{position:relative;box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;padding:8px 8px 0;background:var(--dsw-alias-bg-base)}
.${cls.screen}{flex:1;min-height:0}
/* wterm puts its own class on the screen element itself. */
.${cls.screen}.wterm{--term-bg:var(--dsw-alias-bg-base);--term-fg:var(--dsw-alias-label-primary);--term-cursor:var(--dsw-alias-label-primary);--term-selection-bg:var(--dsw-alias-bg-document-selection);--term-font-family:var(--dsh-font-family-terminal,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);--term-font-size:${TERMINAL_FONT_SIZE};--term-line-height:1.2;--term-row-height:calc(${TERMINAL_FONT_SIZE} * 1.2);${ANSI.map((color, i) => `--term-color-${i}:${color}`).join(';')}}
.${cls.screen}.wterm ::selection{background:var(--dsw-alias-bg-document-selection)}
.${cls.notices}{position:absolute;inset:auto 8px 8px auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.${cls.status}{display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxs-12)}
.${cls.status} button{border:0;background:none;color:var(--dsw-alias-label-primary);font:inherit;text-decoration:underline;cursor:pointer;padding:0}
.${cls.title}{display:inline-flex;align-items:center;gap:6px}
.${cls.guideIcon}{display:inline-flex;align-items:center;justify-content:center}
`
