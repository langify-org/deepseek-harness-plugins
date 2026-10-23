/**
 * The settings a form shows, read from the host plugin's configuration schema as DSH's
 * settings service serves it: Schemastery's serialized form, `{ uid, refs }`, with each node
 * referring to its children by uid. The schema is the one definition of the settings; the
 * form shows what it declares, with its descriptions, bounds and choices.
 */

/** A value a setting takes: the configuration is JSON. */
export type SettingValue = string | number | boolean;

/** One of a choice's values, with what it means. */
export interface SettingOption {
  readonly value: SettingValue;
  readonly description: string | undefined;
}

interface FieldBase {
  /** The setting's key in the configuration, which the form writes. */
  readonly key: string;
  readonly description: string | undefined;
}

export type SettingField =
  | (FieldBase & { readonly kind: 'boolean'; readonly defaultValue: boolean | undefined })
  | (FieldBase & {
      readonly kind: 'number';
      readonly defaultValue: number | undefined;
      readonly min: number | undefined;
      readonly max: number | undefined;
      readonly step: number | undefined;
    })
  | (FieldBase & { readonly kind: 'text'; readonly defaultValue: string | undefined })
  | (FieldBase & {
      readonly kind: 'choice';
      readonly defaultValue: SettingValue | undefined;
      readonly options: readonly SettingOption[];
    })
  /** A setting of a type this form does not edit; it is shown, and left as it is. */
  | (FieldBase & { readonly kind: 'other'; readonly type: string });

interface SerializedNode {
  readonly type: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly dict: Readonly<Record<string, unknown>> | undefined;
  readonly list: readonly unknown[] | undefined;
  readonly value: unknown;
}

/**
 * The settings of an object schema, in the schema's order; none for a schema of another
 * shape, or one this reading cannot follow.
 * @param schema - the serialized schema.
 * @param resolveText - picks the text of a description in the user's language.
 */
export function settingFields(
  schema: unknown,
  resolveText: (text: string | Readonly<Record<string, string>>) => string = englishText,
): SettingField[] {
  if (!isRecord(schema) || !isRecord(schema['refs'])) return [];
  const refs = schema['refs'];
  const node = (uid: unknown): SerializedNode | undefined => {
    const raw = typeof uid === 'number' || typeof uid === 'string' ? refs[String(uid)] : undefined;
    if (!isRecord(raw) || typeof raw['type'] !== 'string') return undefined;
    return {
      type: raw['type'],
      meta: isRecord(raw['meta']) ? raw['meta'] : {},
      dict: isRecord(raw['dict']) ? raw['dict'] : undefined,
      list: Array.isArray(raw['list']) ? raw['list'] : undefined,
      value: raw['value'],
    };
  };
  const root = node(schema['uid']);
  if (root?.type !== 'object' || root.dict === undefined) return [];
  const describe = (meta: SerializedNode['meta']): string | undefined => {
    const text = meta['description'];
    if (typeof text === 'string') return text;
    if (isRecord(text) && Object.values(text).every((value) => typeof value === 'string')) {
      return resolveText(text as Record<string, string>);
    }
    return undefined;
  };
  return Object.entries(root.dict).flatMap(([key, uid]): SettingField[] => {
    const field = node(uid);
    if (field === undefined || field.meta['hidden'] === true) return [];
    const description = describe(field.meta);
    const fallback = field.meta['default'];
    switch (field.type) {
      case 'boolean':
        return [{ kind: 'boolean', key, description, defaultValue: asType(fallback, 'boolean') }];
      case 'number':
      case 'natural':
        return [
          {
            kind: 'number',
            key,
            description,
            defaultValue: asType(fallback, 'number'),
            min: asType(field.meta['min'], 'number') ?? (field.type === 'natural' ? 0 : undefined),
            max: asType(field.meta['max'], 'number'),
            step:
              asType(field.meta['step'], 'number') ?? (field.type === 'natural' ? 1 : undefined),
          },
        ];
      case 'string':
        return [{ kind: 'text', key, description, defaultValue: asType(fallback, 'string') }];
      case 'union': {
        const options = (field.list ?? []).map(node);
        if (options.every((option) => option?.type === 'const' && isSettingValue(option.value))) {
          return [
            {
              kind: 'choice',
              key,
              description,
              defaultValue: isSettingValue(fallback) ? fallback : undefined,
              options: (options as SerializedNode[]).map((option) => ({
                value: option.value as SettingValue,
                description: describe(option.meta),
              })),
            },
          ];
        }
        return [{ kind: 'other', key, description, type: field.type }];
      }
      default:
        return [{ kind: 'other', key, description, type: field.type }];
    }
  });
}

/** A setting's value, as the user enters it in the field, or an error to show instead. */
export function numberInput(
  field: Extract<SettingField, { kind: 'number' }>,
  text: string,
): { readonly value: number } | { readonly error: string } {
  const value = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(value)) return { error: 'Enter a number.' };
  if (field.min !== undefined && value < field.min) return { error: `At least ${field.min}.` };
  if (field.max !== undefined && value > field.max) return { error: `At most ${field.max}.` };
  if (field.step !== undefined && field.step !== 0) {
    if (!isMultipleOf(value, field.min ?? 0, field.step)) {
      return { error: `In steps of ${Math.abs(field.step)}.` };
    }
  }
  return { value };
}

/**
 * Whether the host's schema takes the value for the step: Schemastery counts steps from the
 * minimum (0 without one), in decimal digits of the step so that 0.1 steps are not lost to
 * binary floats. The remainder is compared with a tolerance for what the shift still rounds.
 */
function isMultipleOf(value: number, min: number, step: number): boolean {
  const size = Math.abs(step);
  const tolerance = 1e-9;
  const isWhole = (remainder: number, divisor: number) =>
    remainder < tolerance || divisor - remainder < tolerance;
  if (!/^\d+\.\d+$/.test(size.toString())) {
    return isWhole(Math.abs(value - min) % size, size);
  }
  const digits = size.toString().split('.')[1]?.length ?? 0;
  const shiftedStep = decimalShift(size, digits);
  return isWhole(
    Math.abs(decimalShift(value, digits) - decimalShift(min, digits)) % shiftedStep,
    shiftedStep,
  );
}

/** Moves the decimal point right by `digits` places in the number's text, as Schemastery does. */
function decimalShift(value: number, digits: number): number {
  const text = value.toString();
  const index = text.indexOf('.');
  if (text.includes('e') || index === -1) return value * 10 ** digits;
  const fraction = text.slice(index + 1);
  const integer = text.slice(0, index);
  if (fraction.length <= digits) return Number(integer + fraction.padEnd(digits, '0'));
  return Number(`${integer}${fraction.slice(0, digits)}.${fraction.slice(digits)}`);
}

function englishText(text: string | Readonly<Record<string, string>>): string {
  if (typeof text === 'string') return text;
  return text['en'] ?? text[''] ?? Object.values(text)[0] ?? '';
}

function asType<T extends 'boolean' | 'number' | 'string'>(
  value: unknown,
  type: T,
): (T extends 'boolean' ? boolean : T extends 'number' ? number : string) | undefined {
  return typeof value === type ? (value as never) : undefined;
}

function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
