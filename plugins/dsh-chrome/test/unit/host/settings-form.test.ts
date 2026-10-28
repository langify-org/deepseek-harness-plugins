import assert from 'node:assert/strict';
import { test } from 'node:test';
import type z from '@deepseek-ai/schemastery';
import { settingFields } from '../../../src/client/settings/setting-fields.ts';
import { Config } from '../../../src/host/index.ts';

interface Serialized {
  uid: number;
  refs: Record<
    string,
    { type: string; meta: Record<string, unknown>; dict?: Record<string, number> }
  >;
}

/** What DSH's settings service serves: the schema with only the volatile fields. */
function volatileOnly(): Serialized {
  const schema = (Config as unknown as z<unknown>).toJSON() as unknown as Serialized;
  const root = schema.refs[String(schema.uid)];
  assert.ok(root?.dict);
  const dict = Object.fromEntries(
    Object.entries(root.dict).filter(
      ([, uid]) => schema.refs[String(uid)]?.meta['volatile'] === true,
    ),
  );
  return { ...schema, refs: { ...schema.refs, [String(schema.uid)]: { ...root, dict } } };
}

test('the volatile settings are the five a user edits, in order', () => {
  assert.deepEqual(
    settingFields(volatileOnly()).map((field) => field.key),
    ['executable', 'deviceScaleFactor', 'announceAutomation', 'webgl', 'shareNativeHosts'],
  );
});

test('the form shows each volatile setting as the kind that suits it', () => {
  const fields = settingFields(volatileOnly());
  const byKey = new Map(fields.map((field) => [field.key, field]));
  assert.equal(byKey.get('executable')?.kind, 'text');
  const scale = byKey.get('deviceScaleFactor');
  assert.equal(scale?.kind, 'choice');
  if (scale?.kind === 'choice') {
    assert.deepEqual(
      scale.options.map((option) => option.value),
      ['auto'],
    );
    assert.equal(scale.defaultValue, 'auto');
    assert.deepEqual([scale.number?.min, scale.number?.max, scale.number?.step], [1, 4, 0.25]);
    assert.ok((scale.number?.description ?? '') !== '');
  }
  assert.equal(byKey.get('announceAutomation')?.kind, 'boolean');
  const webgl = byKey.get('webgl');
  assert.equal(webgl?.kind, 'choice');
  if (webgl?.kind === 'choice') {
    assert.deepEqual(
      webgl.options.map((option) => option.value),
      ['gpu', 'gpu-or-cpu', 'off'],
    );
    assert.ok(webgl.options.every((option) => (option.description ?? '') !== ''));
    assert.equal(webgl.defaultValue, 'gpu');
  }
  assert.equal(byKey.get('shareNativeHosts')?.kind, 'boolean');
});

test('every field of the full schema carries a description, and the volatile ones are the five', () => {
  const fields = settingFields((Config as unknown as z<unknown>).toJSON());
  assert.ok(fields.every((field) => (field.description ?? '') !== ''));
  const volatile = settingFields(volatileOnly()).map((field) => field.key);
  assert.deepEqual(
    fields.filter((field) => volatile.includes(field.key)).map((field) => field.kind),
    ['text', 'choice', 'boolean', 'choice', 'boolean'],
  );
});
