// The tab's styles, with DSH's design tokens. noVNC draws its own canvas inside
// the screen element; the text box sits over it, unseen until an input method
// composes in it.

export const cls = {
  root: 'langify-browser-root',
  screen: 'langify-browser-screen',
  input: 'langify-browser-input',
  composing: 'langify-browser-composing',
  cover: 'langify-browser-cover',
  notices: 'langify-browser-notices',
  notice: 'langify-browser-notice',
  title: 'langify-browser-title',
  guideIcon: 'langify-browser-guide-icon',
} as const

export const CSS: string = `
.${cls.root}{position:relative;box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;overflow-x:auto;background:var(--dsw-alias-bg-base)}
/* No Chromium window is narrower than 500px (MIN_SIZE): a narrower tab scrolls to the rest. */
.${cls.screen}{position:relative;flex:1;min-height:0;min-width:500px;overflow:hidden}
.${cls.input}{position:absolute;z-index:2;left:0;top:0;width:1px;height:1.6em;margin:0;padding:0;border:0;outline:none;resize:none;overflow:hidden;opacity:0;pointer-events:none;font-size:14px;line-height:1.6em;white-space:nowrap;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.${cls.input}.${cls.composing}{opacity:1;width:auto;min-width:4em;max-width:80%;padding:0 6px;border-radius:var(--dsw-radius-md);box-shadow:0 0 0 1px var(--dsw-alias-label-secondary);field-sizing:content}
.${cls.cover}{position:absolute;z-index:3;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxs-12);background:var(--dsw-alias-bg-base)}
.${cls.cover} button,.${cls.notice} button,.${cls.notice} a{border:0;background:none;color:var(--dsw-alias-label-primary);font:inherit;text-decoration:underline;cursor:pointer;padding:0}
.${cls.notices}{position:absolute;z-index:4;inset:auto 8px 8px auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:calc(100% - 16px)}
.${cls.notice}{display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxs-12);overflow-wrap:anywhere}
.${cls.title}{display:inline-flex;align-items:center;gap:6px}
.${cls.guideIcon}{display:inline-flex;align-items:center;justify-content:center}
`
