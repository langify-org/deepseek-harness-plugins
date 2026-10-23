import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { HOST_ROW_ID } from '../../protocol/settings.ts';
import { type CopyPhase, isCopying, ProfileCopier } from './profile-copier.ts';
import {
  numberInput,
  type SettingField,
  type SettingValue,
  settingFields,
} from './setting-fields.ts';

/** An edit of a form, as DSH's settings service takes it. */
export type ConfigFormOperation =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] };

/** A row's configuration form, as DSH's Plugins page hands it to the row's page. */
export interface ConfigForm {
  readonly state: {
    readonly status: 'loading' | 'ready' | 'unavailable';
    /** The settings in effect. */
    readonly value: Readonly<Record<string, unknown>> | undefined;
    /** The settings the user's DSH profile sets, over the defaults. */
    readonly user: Readonly<Record<string, unknown>> | undefined;
    readonly revision: number | undefined;
    readonly writable: boolean;
  };
  /** Applies the edits, if the form is still at the revision; resolves to whether it was. */
  mutate(
    operations: readonly ConfigFormOperation[],
    revision: number | undefined,
  ): Promise<boolean>;
}

/** What DSH's settings service serves of the rows' configurations: each form's schema. */
export interface ConfigurationsSource {
  getSnapshot(): {
    readonly view?:
      | { readonly namespaces: readonly { readonly ns: string; readonly schema: unknown }[] }
      | undefined;
  };
  subscribe(listener: () => void): () => void;
}

export interface SettingsPageInjected {
  readonly configurations: ConfigurationsSource;
  /** Picks a description's text in the user's language. */
  readonly resolveText: (text: string | Readonly<Record<string, string>>) => string;
  readonly openViewerSocket: () => ConnectionWebSocket;
}

export interface SettingsPageProps extends SettingsPageInjected {
  /** The Plugins page shows a row's summary in its list, and its page when it is opened. */
  readonly view: 'page' | 'summary';
  /** The row's form, while the row runs. */
  readonly form?: ConfigForm | undefined;
}

/**
 * dsh-chrome's page in DSH's plugin settings: a form of its settings, drawn from the host
 * plugin's configuration schema, and the copy of a profile of the user's own Chrome.
 */
export function SettingsPage(props: SettingsPageProps) {
  if (props.view === 'summary') return <>Chrome in the sidebar, shared with the agent</>;
  return (
    <div style={pageStyle}>
      <SettingsForm {...props} />
      <ProfileCopySection openViewerSocket={props.openViewerSocket} />
    </div>
  );
}

function SettingsForm({ form, configurations, resolveText }: SettingsPageProps) {
  // DSH's mirror is a class: its methods need it as `this`.
  const served = useSyncExternalStore(
    (listener) => configurations.subscribe(listener),
    () => configurations.getSnapshot(),
  );
  const schema = served.view?.namespaces.find((namespace) => namespace.ns === HOST_ROW_ID)?.schema;
  const [notice, setNotice] = useState<string>();
  // Counts the changes DSH refused: the fields show the value in effect again.
  const [refused, setRefused] = useState(0);
  if (form === undefined) {
    return <p style={noteStyle}>The settings show while dsh-chrome runs.</p>;
  }
  if (form.state.status !== 'ready' || schema === undefined) {
    return (
      <p style={noteStyle}>
        {form.state.status === 'unavailable' ? 'The settings are not available.' : 'Loading…'}
      </p>
    );
  }
  const { value, user, revision, writable } = form.state;
  const apply = (operation: ConfigFormOperation) => {
    setNotice(undefined);
    form.mutate([operation], revision).then(
      (accepted) => {
        if (!accepted) {
          setNotice('DSH did not take the change.');
          setRefused((count) => count + 1);
        }
      },
      (error: unknown) => {
        setNotice(`DSH did not take the change: ${String(error)}`);
        setRefused((count) => count + 1);
      },
    );
  };
  return (
    <section style={sectionStyle}>
      <h4 style={headingStyle}>Settings</h4>
      <p style={noteStyle}>
        Chrome takes these when it starts again: the sidebar offers to restart it.
        {writable ? '' : ' This DSH profile cannot be changed here.'}
      </p>
      {settingFields(schema, resolveText).map((field) => (
        <SettingRow
          key={field.key}
          refused={refused}
          field={field}
          value={value?.[field.key]}
          changed={user !== undefined && user[field.key] !== undefined}
          disabled={!writable}
          onSet={(next) => apply({ op: 'set', path: [field.key], value: next })}
          onReset={() => apply({ op: 'unset', path: [field.key] })}
        />
      ))}
      {notice === undefined ? null : (
        <p role="alert" style={noteStyle}>
          {notice}
        </p>
      )}
    </section>
  );
}

function SettingRow({
  refused,
  field,
  value,
  changed,
  disabled,
  onSet,
  onReset,
}: {
  /** How many changes DSH has refused; a field drops its draft when it grows. */
  readonly refused: number;
  readonly field: SettingField;
  readonly value: unknown;
  /** Whether the user's profile sets it, over the default. */
  readonly changed: boolean;
  readonly disabled: boolean;
  readonly onSet: (value: SettingValue) => void;
  readonly onReset: () => void;
}) {
  const id = `dsh-chrome-setting-${field.key}`;
  return (
    <div style={rowStyle}>
      <div style={rowHeadStyle}>
        <label htmlFor={id} style={keyStyle}>
          {field.key}
        </label>
        {changed ? (
          <button type="button" style={linkButtonStyle} disabled={disabled} onClick={onReset}>
            Reset to the default
          </button>
        ) : null}
      </div>
      {field.description === undefined ? null : <p style={descriptionStyle}>{field.description}</p>}
      <SettingControl
        id={id}
        refused={refused}
        field={field}
        value={value}
        disabled={disabled}
        onSet={onSet}
      />
    </div>
  );
}

function SettingControl({
  id,
  refused,
  field,
  value,
  disabled,
  onSet,
}: {
  readonly id: string;
  readonly refused: number;
  readonly field: SettingField;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onSet: (value: SettingValue) => void;
}): ReactNode {
  switch (field.kind) {
    case 'boolean':
      return (
        <label style={checkStyle}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onSet(event.target.checked)}
          />
          {value === true ? 'On' : 'Off'}
        </label>
      );
    case 'choice':
      return (
        <ChoiceControl
          id={id}
          refused={refused}
          field={field}
          value={value}
          disabled={disabled}
          onSet={onSet}
        />
      );
    case 'number':
    case 'text':
      return (
        <TextControl
          id={id}
          refused={refused}
          field={field}
          value={value === undefined ? '' : String(value)}
          disabled={disabled}
          onSet={onSet}
        />
      );
    case 'other':
      return <p style={noteStyle}>Set in the DSH profile's configuration.</p>;
  }
}

/**
 * A choice of the schema's values, with a number field besides when the setting also takes a
 * number. The number typed is the setting once the user presses Enter, leaves the field, or
 * chooses the number; choosing another option instead drops it. Choosing the number with none
 * typed sets the one the setting last had while this page showed it, or the least it takes.
 */
function ChoiceControl({
  id,
  refused,
  field,
  value,
  disabled,
  onSet,
}: {
  readonly id: string;
  readonly refused: number;
  readonly field: Extract<SettingField, { kind: 'choice' }>;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onSet: (value: SettingValue) => void;
}) {
  const isOption = field.options.some((option) => option.value === value);
  const number = typeof value === 'number' && !isOption ? value : undefined;
  const shown = number === undefined ? '' : String(number);
  const [lastNumber, setLastNumber] = useState(number);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string>();
  // The option a press in the choice went down on: the field loses the focus before the
  // click that chooses, and a click on an option's text moves the focus to nothing.
  const pressed = useRef<'value' | 'number'>(undefined);
  useEffect(() => {
    if (number !== undefined) setLastNumber(number);
  }, [number]);
  // The setting changed elsewhere, or DSH refused a change: the field shows the value in
  // effect. (`refused` is read only to run the effect again.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger
  useEffect(() => {
    setDraft(shown);
    setError(undefined);
  }, [shown, refused]);
  const numberOption = field.number;
  const drop = () => {
    setDraft(shown);
    setError(undefined);
  };
  /** Sets the number typed, if one is; else, when the number is chosen, the last or least. */
  const takeNumber = (chosen: boolean) => {
    if (numberOption === undefined) return;
    if (draft.trim() !== '' && draft !== shown) {
      const parsed = numberInput(numberOption, draft);
      if ('error' in parsed) {
        setError(parsed.error);
        return;
      }
      setError(undefined);
      onSet(parsed.value);
      return;
    }
    if (chosen && number === undefined) onSet(lastNumber ?? numberOption.min ?? 0);
  };
  return (
    <div
      role="radiogroup"
      id={id}
      style={choicesStyle}
      onPointerDownCapture={(event) => {
        const option = (event.target as Element).closest('[data-option]');
        const kind = option?.getAttribute('data-option');
        pressed.current = kind === 'value' || kind === 'number' ? kind : undefined;
      }}
    >
      {field.options.map((option) => (
        <label key={String(option.value)} style={choiceStyle} data-option="value">
          <input
            type="radio"
            name={id}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => {
              pressed.current = undefined;
              drop();
              onSet(option.value);
            }}
          />
          <span>
            <code>{String(option.value)}</code>
            {option.description === undefined ? null : ` — ${option.description}`}
          </span>
        </label>
      ))}
      {numberOption === undefined ? null : (
        <div style={choiceStyle}>
          <input
            type="radio"
            name={id}
            aria-label="A number"
            data-option="number"
            checked={number !== undefined}
            disabled={disabled}
            readOnly
            // A click, not a change: the number typed is taken when the number is chosen already.
            onClick={() => {
              pressed.current = undefined;
              takeNumber(true);
            }}
          />
          <div>
            <input
              id={`${id}-number`}
              type="number"
              value={draft}
              disabled={disabled}
              min={numberOption.min}
              max={numberOption.max}
              step={numberOption.step}
              style={inputStyle}
              onFocus={() => {
                // A press that went down on an option and was let go elsewhere is over.
                pressed.current = undefined;
              }}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                // Another option is being chosen: the number typed is not the setting.
                if (pressed.current === 'value') drop();
                // The number is being chosen: its click takes what was typed.
                else if (pressed.current !== 'number') takeNumber(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') takeNumber(false);
              }}
            />
            {error === undefined ? null : (
              <p role="alert" style={noteStyle}>
                {error}
              </p>
            )}
            {numberOption.description === undefined ? null : (
              <span>{numberOption.description}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A text or number setting, taken when the user leaves the field or presses Enter. */
function TextControl({
  id,
  refused,
  field,
  value,
  disabled,
  onSet,
}: {
  readonly id: string;
  readonly refused: number;
  readonly field: Extract<SettingField, { kind: 'number' | 'text' }>;
  readonly value: string;
  readonly disabled: boolean;
  readonly onSet: (value: SettingValue) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  // The setting changed elsewhere: the field shows it.
  useEffect(() => setDraft(value), [value]);
  // DSH refused a change: the draft would show a value that is not in effect. (`refused` is
  // read only to run the effect again.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger
  useEffect(() => setDraft(value), [refused]);
  const commit = () => {
    if (draft === value) return;
    if (field.kind === 'text') {
      onSet(draft);
      return;
    }
    const parsed = numberInput(field, draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(undefined);
    onSet(parsed.value);
  };
  return (
    <div>
      <input
        id={id}
        type={field.kind === 'number' ? 'number' : 'text'}
        value={draft}
        disabled={disabled}
        min={field.kind === 'number' ? field.min : undefined}
        max={field.kind === 'number' ? field.max : undefined}
        step={field.kind === 'number' ? field.step : undefined}
        style={inputStyle}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      {error === undefined ? null : (
        <p role="alert" style={noteStyle}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Copies a profile of the user's own Chrome into dsh-chrome's, once the user confirms it. */
function ProfileCopySection({
  openViewerSocket,
}: {
  readonly openViewerSocket: () => ConnectionWebSocket;
}) {
  // Opened in an effect: StrictMode runs an initializer twice, and the extra socket would leak.
  const [copier, setCopier] = useState<ProfileCopier>();
  useEffect(() => {
    const opened = new ProfileCopier(openViewerSocket);
    setCopier(opened);
    return () => {
      opened.dispose();
      setCopier(undefined);
    };
  }, [openViewerSocket]);
  if (copier === undefined) return null;
  return <ProfileCopyForm copier={copier} />;
}

function ProfileCopyForm({ copier }: { readonly copier: ProfileCopier }) {
  const snapshot = useSyncExternalStore(copier.subscribe, copier.getSnapshot);
  const [selected, setSelected] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const profiles = snapshot.profiles ?? [];
  const directory = selected ?? profiles[0]?.directory;
  const chosen = profiles.find((profile) => profile.directory === directory);
  const { phase } = snapshot;
  return (
    <section style={sectionStyle}>
      <h4 style={headingStyle}>Copy a profile of your Chrome</h4>
      <p style={noteStyle}>
        dsh-chrome's Chrome has a profile of its own. Copy one of your Chrome's into it: its
        sign-ins, saved passwords, bookmarks, history, extensions and site settings. The copy joins
        Chrome Sync as a device of its own.
      </p>
      {snapshot.listError !== undefined ? (
        <p role="alert" style={noteStyle}>
          {snapshot.listError}
        </p>
      ) : snapshot.profiles === undefined ? (
        <p style={noteStyle}>Looking for your Chrome's profiles…</p>
      ) : profiles.length === 0 ? (
        <p style={noteStyle}>Your Chrome has no profiles.</p>
      ) : (
        <div style={copyRowStyle}>
          <select
            aria-label="Profile to copy"
            value={directory}
            disabled={isCopying(phase) || confirming}
            style={inputStyle}
            onChange={(event) => setSelected(event.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.directory} value={profile.directory}>
                {profile.name}
                {profile.account === null ? '' : ` (${profile.account})`}
              </option>
            ))}
          </select>
          <button
            type="button"
            style={buttonStyle}
            disabled={isCopying(phase) || confirming || chosen === undefined}
            onClick={() => {
              copier.refresh();
              setConfirming(true);
            }}
          >
            Copy…
          </button>
        </div>
      )}
      {confirming && chosen !== undefined ? (
        <div role="alertdialog" aria-label="Copy the profile?" style={confirmStyle}>
          <p style={{ margin: 0 }}>
            Replace dsh-chrome's profile with a copy of “{chosen.name}”? Chrome closes, with its
            windows in every session, while the copy takes the profile's place. dsh-chrome keeps the
            profile it replaces, as <code>Default.before-copy</code>, until the next copy.
          </p>
          {snapshot.running ? (
            <p style={{ margin: 0 }}>
              Your Chrome is running: what it has not written yet stays out of the copy. Close it
              first for an exact copy.
            </p>
          ) : null}
          <div style={copyRowStyle}>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setConfirming(false);
                copier.copy(chosen.directory);
              }}
            >
              Copy
            </button>
            <button type="button" style={buttonStyle} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <CopyStatus phase={phase} profiles={profiles} />
    </section>
  );
}

function CopyStatus({
  phase,
  profiles,
}: {
  readonly phase: CopyPhase;
  readonly profiles: readonly { readonly directory: string; readonly name: string }[];
}) {
  const nameOf = (directory: string) =>
    profiles.find((profile) => profile.directory === directory)?.name ?? directory;
  switch (phase.kind) {
    case 'asked':
      return <CopyProgress text={`Starting the copy of “${nameOf(phase.directory)}”…`} />;
    case 'host': {
      const { status } = phase;
      const name = nameOf(status.directory);
      switch (status.kind) {
        case 'copying-files':
          // Until the copy has counted what it takes, it says only that it copies.
          return status.totalBytes === 0 ? (
            <CopyProgress text={`Copying “${name}”…`} />
          ) : (
            <CopyProgress
              text={`Copying “${name}”: ${megabytes(status.copiedBytes)} of ${megabytes(status.totalBytes)}.`}
              value={status.copiedBytes}
              max={status.totalBytes}
            />
          );
        case 'checking-databases':
          return (
            <CopyProgress
              text={`Checking the databases copied from “${name}”: ${status.checked} of ${status.total}.`}
              value={status.checked}
              max={status.total}
            />
          );
        case 'replacing':
          return <CopyProgress text="Closing Chrome, and putting the copy in place…" />;
        case 'copied':
          return (
            <p role="status" style={noteStyle}>
              dsh-chrome's profile is now a copy of “{name}”. Open Chrome in a session's sidebar to
              use it.
            </p>
          );
        case 'failed':
          return (
            <p role="alert" style={noteStyle}>
              The profile was not copied: {status.message}
            </p>
          );
      }
      return null;
    }
    case 'connection-lost':
      return (
        <p role="alert" style={noteStyle}>
          The connection to DSH was lost while copying “{nameOf(phase.directory)}”, which goes on in
          DSH: connecting again…
        </p>
      );
    case 'unfinished':
      return (
        <p role="alert" style={noteStyle}>
          The copy of “{nameOf(phase.directory)}” may not have finished: DSH knows of it no more, as
          when dsh-chrome starts anew, which stops a copy before it takes the profile's place. Copy
          it again to be sure.
        </p>
      );
    case 'refused':
      return (
        <p role="alert" style={noteStyle}>
          The profile was not copied: {phase.message}
        </p>
      );
    default:
      return null;
  }
}

/** A step of the copy: a bar that fills while files are copied, and moves otherwise. */
function CopyProgress({
  text,
  value,
  max,
}: {
  readonly text: string;
  readonly value?: number;
  readonly max?: number;
}) {
  return (
    <div role="status" style={progressStyle}>
      <progress
        aria-label="Copy progress"
        style={{ width: '100%' }}
        {...(value === undefined || max === undefined || max === 0 ? {} : { value, max })}
      />
      <p style={noteStyle}>{text}</p>
    </div>
  );
}

/** Bytes as megabytes, as file managers count them. */
function megabytes(bytes: number): string {
  const value = bytes / 1_000_000;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} MB`;
}

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 24 };
const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const headingStyle: CSSProperties = { margin: 0, fontSize: '1em' };
const rowStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const rowHeadStyle: CSSProperties = { display: 'flex', gap: 12, alignItems: 'baseline' };
const keyStyle: CSSProperties = { fontFamily: 'monospace', fontWeight: 600 };
const descriptionStyle: CSSProperties = { margin: 0, fontSize: '0.9em', opacity: 0.8 };
const noteStyle: CSSProperties = { margin: 0, fontSize: '0.9em', opacity: 0.85 };
const choicesStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const checkStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  alignSelf: 'flex-start',
};
const choiceStyle: CSSProperties = { display: 'flex', gap: 6, alignItems: 'baseline' };
const copyRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' };
const progressStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const confirmStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 6,
  background: 'color-mix(in srgb, Highlight 14%, transparent)',
  border: '1px solid color-mix(in srgb, Highlight 40%, transparent)',
};
const inputStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
  borderRadius: 6,
  padding: '4px 8px',
  minWidth: 240,
};
const buttonStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: 6,
  padding: '2px 10px',
  minHeight: 28,
};
const linkButtonStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'none',
  border: 0,
  padding: 0,
  textDecoration: 'underline',
  cursor: 'pointer',
};
