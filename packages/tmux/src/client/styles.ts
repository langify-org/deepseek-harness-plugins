// The tab's styles, with DSH's design tokens; wterm's own stylesheet comes first.

export const cls = {
  root: 'langify-tmux-root',
  screen: 'langify-tmux-screen',
  status: 'langify-tmux-status',
  title: 'langify-tmux-title',
  guideIcon: 'langify-tmux-guide-icon',
} as const

export const CSS: string = `${WTERM_CSS}
.${cls.root}{position:relative;box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;background:#1e1e1e}
.${cls.screen}{flex:1;min-height:0}
.${cls.screen} .wterm{height:100%;--term-font-family:var(--ds-font-family-code),monospace;--term-font-size:13px;--term-row-height:16px}
.${cls.status}{position:absolute;inset:auto 8px 8px auto;display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxs-12)}
.${cls.status} button{border:0;background:none;color:var(--dsw-alias-label-primary);font:inherit;text-decoration:underline;cursor:pointer;padding:0}
.${cls.title}{display:inline-flex;align-items:center;gap:6px}
.${cls.guideIcon}{display:inline-flex;align-items:center;justify-content:center}
`
