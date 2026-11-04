// The Tasks tab's stylesheet, after DSH's Web styling reference
// (deepseek-harness docs/web-styling.md): theme `--dsw-alias-*` tokens only,
// 0.5px neutral hairlines, hover under `(hover: hover)`, and typography from
// the theme's font roles. Class names carry the plugin prefix because the
// sheet is global.
// ponytail: a CSS string, not a CSS Module; the client build has no CSS step.
// Upgrade path: a `*.module.css` loader in tsdown.client.ts once a second plugin needs real CSS.

/** Prefixed class names used by the Tasks tab. */
export const cls = {
  root: 'langify-tasks-root',
  empty: 'langify-tasks-empty',
  list: 'langify-tasks-list',
  row: 'langify-tasks-row',
  rowButton: 'langify-tasks-row-button',
  play: 'langify-tasks-play',
  rowText: 'langify-tasks-row-text',
  titleLine: 'langify-tasks-title-line',
  name: 'langify-tasks-name',
  signature: 'langify-tasks-signature',
  doc: 'langify-tasks-doc',
  time: 'langify-tasks-time',
  problem: 'langify-tasks-problem',
  form: 'langify-tasks-form',
  fields: 'langify-tasks-fields',
  field: 'langify-tasks-field',
  fieldName: 'langify-tasks-field-name',
  flag: 'langify-tasks-flag',
  formFooter: 'langify-tasks-form-footer',
  hint: 'langify-tasks-hint',
  from: 'langify-tasks-from',
  title: 'langify-tasks-title',
  guideIcon: 'langify-tasks-guide-icon',
} as const

const code = 'font-family:var(--ds-font-family-code)'

export const CSS: string = `
.${cls.root}{box-sizing:border-box;height:100%;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:8px 2px 8px 8px;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}
.${cls.empty}{box-sizing:border-box;height:100%;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;overflow-wrap:anywhere}
.${cls.list}{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.${cls.row}{border-radius:var(--dsw-radius-md)}
.${cls.row}[data-open=true]{background:var(--dsw-alias-interactive-bg-hover)}
.${cls.rowButton}{box-sizing:border-box;width:100%;display:flex;align-items:flex-start;gap:8px;padding:7px 10px 7px 8px;border:0;border-radius:var(--dsw-radius-md);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.${cls.rowButton}:disabled{cursor:progress}
.${cls.play}{flex:none;margin-top:2px;color:var(--dsw-alias-label-tertiary)}
@media (hover:hover){.${cls.row}:not([data-open=true]) .${cls.rowButton}:hover{background:var(--dsw-alias-interactive-bg-hover)}.${cls.rowButton}:hover .${cls.play}{color:var(--dsw-alias-label-primary)}}
.${cls.row}[data-open=true] .${cls.play}{color:var(--dsw-alias-label-primary)}
.${cls.rowText}{flex:auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.${cls.titleLine}{display:flex;align-items:baseline;gap:8px;min-width:0}
.${cls.name}{flex:none;${code};color:var(--dsw-alias-label-primary)}
.${cls.signature}{min-width:0;font:var(--dsw-font-xxs-12);${code};color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.${cls.doc}{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);overflow-wrap:anywhere}
.${cls.time}{flex:none;margin-top:2px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11)}
.${cls.problem}{margin:0;padding:0 10px 8px 32px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);overflow-wrap:anywhere}
.${cls.form}{display:flex;flex-direction:column;gap:10px;padding:2px 10px 10px 32px}
.${cls.fields}{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:6px 10px}
.${cls.field}{display:contents}
.${cls.fieldName}{font:var(--dsw-font-xxs-12);${code};color:var(--dsw-alias-label-secondary)}
.${cls.flag}{grid-column:1 / -1}
.${cls.formFooter}{display:flex;align-items:center;justify-content:flex-end;gap:10px}
.${cls.hint}{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11)}
.${cls.from}{margin:8px 0 0;padding:0 10px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);${code}}
.${cls.guideIcon}{display:inline-flex;color:var(--dsw-alias-label-secondary)}
.${cls.title}{display:inline-flex;align-items:center;gap:6px;min-width:0}
`
