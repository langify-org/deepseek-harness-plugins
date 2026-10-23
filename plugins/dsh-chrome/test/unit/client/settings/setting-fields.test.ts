import assert from 'node:assert/strict';
import { test } from 'node:test';
import z from '@deepseek-ai/schemastery';
import {
  numberInput,
  type SettingField,
  settingFields,
} from '../../../../src/client/settings/setting-fields.ts';

const fieldsOf = (schema: { toJSON(): unknown }, resolve?: Parameters<typeof settingFields>[1]) =>
  settingFields(schema.toJSON(), resolve);

test('reads a boolean with its description and default', () => {
  const schema = z.object({ on: z.boolean().default(true).description('Whether it is on.') });
  assert.deepEqual(fieldsOf(schema), [
    { kind: 'boolean', key: 'on', description: 'Whether it is on.', defaultValue: true },
  ]);
});

test('reads a number with its bounds, step and default', () => {
  const schema = z.object({ scale: z.number().min(1).max(4).step(0.25).default(2) });
  assert.deepEqual(fieldsOf(schema), [
    {
      kind: 'number',
      key: 'scale',
      description: undefined,
      defaultValue: 2,
      min: 1,
      max: 4,
      step: 0.25,
    },
  ]);
});

test('reads a number without bounds as unbounded', () => {
  const [field] = fieldsOf(z.object({ n: z.number() }));
  assert.deepEqual(field, {
    kind: 'number',
    key: 'n',
    description: undefined,
    defaultValue: undefined,
    min: undefined,
    max: undefined,
    step: undefined,
  });
});

test('reads a string as text with its default', () => {
  const schema = z.object({ executable: z.string().default('chrome') });
  assert.deepEqual(fieldsOf(schema), [
    { kind: 'text', key: 'executable', description: undefined, defaultValue: 'chrome' },
  ]);
});

test('reads a union of constants as a choice, each option with its description', () => {
  const schema = z.object({
    mode: z
      .union([z.const('gpu').description('On the GPU.'), z.const('off')])
      .default('gpu')
      .description('How to draw.'),
  });
  assert.deepEqual(fieldsOf(schema), [
    {
      kind: 'choice',
      key: 'mode',
      description: 'How to draw.',
      defaultValue: 'gpu',
      options: [
        { value: 'gpu', description: 'On the GPU.' },
        { value: 'off', description: undefined },
      ],
      number: undefined,
    },
  ]);
});

test('reads a union of constants and a number as a choice that also takes a number in bounds', () => {
  const schema = z.object({
    scale: z
      .union([
        z.const('auto').description('As the display.'),
        z.number().min(1).max(4).step(0.25).description('This many.'),
      ])
      .default('auto'),
  });
  assert.deepEqual(fieldsOf(schema), [
    {
      kind: 'choice',
      key: 'scale',
      description: undefined,
      defaultValue: 'auto',
      options: [{ value: 'auto', description: 'As the display.' }],
      number: { description: 'This many.', min: 1, max: 4, step: 0.25 },
    },
  ]);
});

test('a union with two numbers, or with another kind of member, is not edited', () => {
  const twoNumbers = z.object({ value: z.union([z.number(), z.natural()]) });
  const withText = z.object({ value: z.union([z.const('a'), z.string()]) });
  assert.equal(fieldsOf(twoNumbers)[0]?.kind, 'other');
  assert.equal(fieldsOf(withText)[0]?.kind, 'other');
});

test('reads a choice of numbers', () => {
  const [field] = fieldsOf(z.object({ n: z.union([z.const(1), z.const(2)]) }));
  assert.equal(field?.kind, 'choice');
  assert.deepEqual(field?.kind === 'choice' ? field.options.map((o) => o.value) : [], [1, 2]);
});

test('resolves a description given as a language map with the function it is passed', () => {
  const schema = z.object({
    on: z
      .boolean()
      .description(languageMap({ en: 'Switch', ja: 'スイッチ' }))
      .default(false),
  });
  const seen: unknown[] = [];
  const [field] = fieldsOf(schema, (text) => {
    seen.push(text);
    return typeof text === 'string' ? text : (text['ja'] ?? '');
  });
  assert.equal(field?.description, 'スイッチ');
  assert.deepEqual(seen, [{ en: 'Switch', ja: 'スイッチ' }]);
});

test('reads the English description of a language map by default', () => {
  const schema = z.object({
    on: z.boolean().description(languageMap({ ja: 'スイッチ', en: 'Switch' })),
  });
  assert.equal(fieldsOf(schema)[0]?.description, 'Switch');
});

test('skips hidden fields', () => {
  const schema = z.object({ shown: z.string(), secret: z.string().hidden() });
  assert.deepEqual(
    fieldsOf(schema).map((field) => field.key),
    ['shown'],
  );
});

test('shows a type the form does not edit as other, with its type', () => {
  const schema = z.object({
    list: z.array(z.string()).description('Many.'),
    mixed: z.union([z.string(), z.number()]),
  });
  assert.deepEqual(fieldsOf(schema), [
    { kind: 'other', key: 'list', description: 'Many.', type: 'array' },
    { kind: 'other', key: 'mixed', description: undefined, type: 'union' },
  ]);
});

test('keeps the order of the schema', () => {
  const schema = z.object({ b: z.string(), a: z.boolean(), c: z.number() });
  assert.deepEqual(
    fieldsOf(schema).map((field) => field.key),
    ['b', 'a', 'c'],
  );
});

test('gives no fields for a schema that is not an object, or for garbage', () => {
  assert.deepEqual(fieldsOf(z.string()), []);
  assert.deepEqual(fieldsOf(z.array(z.string())), []);
  for (const garbage of [undefined, null, 5, 'x', [], {}, { uid: 1 }, { uid: 1, refs: {} }]) {
    assert.deepEqual(settingFields(garbage), []);
  }
  assert.deepEqual(settingFields({ uid: 1, refs: { 1: { type: 'object', meta: {} } } }), []);
});

test('numberInput accepts a number within the bounds, trimmed', () => {
  const field = numberField({ min: 1, max: 4 });
  assert.deepEqual(numberInput(field, ' 2.5 '), { value: 2.5 });
  assert.deepEqual(numberInput(field, '1'), { value: 1 });
  assert.deepEqual(numberInput(field, '4'), { value: 4 });
});

test('numberInput asks for a number when the text is empty or not finite', () => {
  const field = numberField({});
  for (const text of ['', '  ', 'abc', 'Infinity', 'NaN']) {
    assert.deepEqual(numberInput(field, text), { error: 'Enter a number.' });
  }
});

test('numberInput names the bound a number passes', () => {
  const field = numberField({ min: 1, max: 4 });
  assert.deepEqual(numberInput(field, '0.5'), { error: 'At least 1.' });
  assert.deepEqual(numberInput(field, '5'), { error: 'At most 4.' });
});

test('numberInput accepts any number for a field without bounds', () => {
  assert.deepEqual(numberInput(numberField({}), '-1000'), { value: -1000 });
});

test('numberInput refuses a number that is not in steps of the field, counted from 0', () => {
  const field = numberField({ step: 0.25 });
  assert.deepEqual(numberInput(field, '1.3'), { error: 'In steps of 0.25.' });
  assert.deepEqual(numberInput(field, '1.25'), { value: 1.25 });
  assert.deepEqual(numberInput(field, '-0.5'), { value: -0.5 });
});

test('numberInput counts the steps from the minimum when the field has one', () => {
  const field = numberField({ min: 0.1, step: 0.2 });
  assert.deepEqual(numberInput(field, '0.3'), { value: 0.3 });
  assert.deepEqual(numberInput(field, '0.2'), { error: 'In steps of 0.2.' });
});

test('numberInput accepts decimal steps that binary floats would miss', () => {
  const field = numberField({ step: 0.1 });
  assert.deepEqual(numberInput(field, '0.3'), { value: 0.3 });
  assert.deepEqual(numberInput(field, '0.35'), { error: 'In steps of 0.1.' });
  assert.deepEqual(numberInput(numberField({ step: 1 }), '2'), { value: 2 });
  assert.deepEqual(numberInput(numberField({ step: 1 }), '2.5'), { error: 'In steps of 1.' });
});

function numberField(bounds: {
  min?: number;
  max?: number;
  step?: number;
}): Extract<SettingField, { kind: 'number' }> {
  return {
    kind: 'number',
    key: 'n',
    description: undefined,
    defaultValue: undefined,
    min: bounds.min,
    max: bounds.max,
    step: bounds.step,
  };
}

/** Schemastery's types take a string; its serialized form also carries language maps (i18n). */
function languageMap(texts: Record<string, string>): string {
  return texts as unknown as string;
}
