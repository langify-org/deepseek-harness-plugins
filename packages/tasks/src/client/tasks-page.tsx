import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  Button,
  Checkbox,
  IconPlayOutlineRegular,
  Input,
  type IconProps,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { buildCommand, type Values } from '../command.ts'
import { justfileLabel, parameterLabel } from '../display.ts'
import type { ListResponse, Parameter, Recipe } from '../rpc.ts'
import type { NAMESPACE } from './messages.ts'
import { cls } from './styles.ts'

type T = TranslateNS<typeof NAMESPACE>

export interface TasksPageProps {
  readonly sessionId: string
  readonly list: () => Promise<ListResponse>
  /** Type `line` into a new terminal tab and press Enter. */
  readonly run: (line: string) => Promise<void>
  readonly describe: (error: unknown) => string
  readonly t: T
}

interface Listing {
  readonly listing?: ListResponse
  readonly error?: string
}

/**
 * The justfile's recipes as a list whose rows run them. The list reads the
 * justfile when the tab opens and again whenever the window regains focus,
 * keeping what it shows while it reads.
 */
export function TasksPage({ sessionId, list, run, describe, t }: TasksPageProps): JSX.Element {
  const [state, setState] = useState<Listing>({})
  // The injected functions may be new on every render.
  const latest = useRef({ list, describe })
  latest.current = { list, describe }
  useEffect(() => {
    let live = true
    let reading = false
    setState({})
    const read = (): void => {
      if (reading) return
      reading = true
      latest.current
        .list()
        .then((listing) => live && setState({ listing }))
        .catch((error: unknown) => live && setState({ error: latest.current.describe(error) }))
        .finally(() => {
          reading = false
        })
    }
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [sessionId])

  const { listing, error } = state
  if (error !== undefined) return <Note text={error} alert />
  if (listing === undefined) return <Note text={t('loading')} />
  if (listing.justfile === null) return <Note text={t('noJustfile')} />
  if (listing.recipes.length === 0) return <Note text={t('noRecipes')} />
  const from = justfileLabel(listing.cwd, listing.justfile)
  return (
    <div className={cls.root}>
      <ul className={cls.list}>
        {listing.recipes.map((recipe) => (
          <RecipeRow key={recipe.name} recipe={recipe} run={run} describe={describe} t={t} />
        ))}
      </ul>
      {from !== undefined && (
        <p className={cls.from} title={listing.justfile}>
          {t('from', { path: from })}
        </p>
      )}
    </div>
  )
}

function Note({
  text,
  alert = false,
}: {
  readonly text: string
  readonly alert?: boolean
}): JSX.Element {
  return (
    <div className={cls.empty} role={alert ? 'alert' : 'status'}>
      {text}
    </div>
  )
}

interface RecipeRowProps {
  readonly recipe: Recipe
  readonly run: (line: string) => Promise<void>
  readonly describe: (error: unknown) => string
  readonly t: T
}

/** One recipe: pressing the row runs it, or opens its arguments first. */
function RecipeRow({ recipe, run, describe, t }: RecipeRowProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Values>(() => initialValues(recipe.parameters))
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<string>()
  const rowButton = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLFormElement>(null)

  const hasForm = recipe.parameters.length > 0
  const formId = `langify-tasks-form-${recipe.name}`

  useEffect(() => {
    if (open) form.current?.querySelector('input')?.focus()
  }, [open])

  const close = (): void => {
    setOpen(false)
    rowButton.current?.focus()
  }

  const start = useCallback(() => {
    const built = buildCommand(recipe, values)
    if (!built.ok) {
      setProblem(t(built.reason, { name: built.parameter }))
      return
    }
    setProblem(undefined)
    setPending(true)
    run(built.line)
      .then(() => setOpen(false))
      .catch((error: unknown) => setProblem(describe(error)))
      .finally(() => setPending(false))
  }, [recipe, values, run, describe, t])

  return (
    <li className={cls.row} data-open={open}>
      <button
        ref={rowButton}
        type="button"
        className={cls.rowButton}
        disabled={pending}
        aria-expanded={hasForm ? open : undefined}
        aria-controls={hasForm ? formId : undefined}
        onClick={() => (hasForm ? setOpen((o) => !o) : start())}
      >
        <IconPlayOutlineRegular size={16} className={cls.play} />
        <span className={cls.rowText}>
          <span className={cls.titleLine}>
            <span className={cls.name}>{recipe.name}</span>
            {hasForm && (
              <span className={cls.signature}>
                {recipe.parameters.map(parameterLabel).join(' ')}
              </span>
            )}
          </span>
          {recipe.doc !== null && <span className={cls.doc}>{recipe.doc}</span>}
        </span>
        {pending && <span className={cls.time}>{t('running')}</span>}
      </button>
      {problem !== undefined && (
        <p role="alert" className={cls.problem}>
          {problem}
        </p>
      )}
      {hasForm && open && (
        <form
          ref={form}
          id={formId}
          className={cls.form}
          onSubmit={(event) => {
            event.preventDefault()
            start()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
            }
          }}
        >
          <div className={cls.fields}>
            {recipe.parameters.map((p) => (
              <Field
                key={p.name}
                parameter={p}
                value={values[p.name]}
                onChange={(value) => setValues((previous) => ({ ...previous, [p.name]: value }))}
                t={t}
              />
            ))}
          </div>
          <div className={cls.formFooter}>
            <span className={cls.hint}>{t('runHint')}</span>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={pending}
              icon={<IconPlayOutlineRegular size={14} />}
            >
              {t('run')}
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

interface FieldProps {
  readonly parameter: Parameter
  readonly value: string | boolean | undefined
  readonly onChange: (value: string | boolean) => void
  readonly t: T
}

/** One argument: its name beside a text box, or a checkbox for a flag. Help shows on hover. */
function Field({ parameter: p, value, onChange, t }: FieldProps): JSX.Element {
  const name = p.option ?? p.name
  const help = p.help ?? undefined
  if (p.flag) {
    return (
      <div className={cls.flag}>
        <Checkbox checked={value === true} onChange={onChange} label={name} title={help} />
      </div>
    )
  }
  const placeholder =
    p.kind !== 'singular'
      ? t('values')
      : p.optional && p.default === null
        ? t('optional')
        : undefined
  return (
    <label className={cls.field} title={help}>
      <code className={cls.fieldName}>{p.kind === 'singular' ? name : parameterLabel(p)}</code>
      <Input
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/** Literal defaults prefilled; flags start unset. */
function initialValues(parameters: readonly Parameter[]): Values {
  return Object.fromEntries(
    parameters.flatMap((p) => (p.flag || p.default === null ? [] : [[p.name, p.default]])),
  )
}

/** The guide card's glyph, at the size and tone of the guide's placeholder cube. */
export function GuideIcon({ className }: IconProps): JSX.Element {
  return (
    <span className={[cls.guideIcon, className].filter(Boolean).join(' ')}>
      <IconPlayOutlineRegular size={18} />
    </span>
  )
}

export interface TasksTitleProps {
  readonly t: T
}

/** The tab title: the Tasks glyph and name. */
export function TasksTitle({ t }: TasksTitleProps): JSX.Element {
  return (
    <span className={cls.title}>
      <IconPlayOutlineRegular size={16} />
      {t('title')}
    </span>
  )
}
