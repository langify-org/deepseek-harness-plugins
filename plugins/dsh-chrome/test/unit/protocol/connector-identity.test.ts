import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  CONNECTOR_EXTENSION_ID,
  CONNECTOR_EXTENSION_KEY,
} from '../../../src/protocol/connector-identity.ts';

const ALPHABET = 'abcdefghijklmnop';

test('derives the connector id the way Chrome derives it from the manifest key', () => {
  const digest = createHash('sha256')
    .update(Buffer.from(CONNECTOR_EXTENSION_KEY, 'base64'))
    .digest('hex');
  const expected = [...digest.slice(0, 32)]
    .map((digit) => ALPHABET.charAt(Number.parseInt(digit, 16)))
    .join('');
  assert.equal(CONNECTOR_EXTENSION_ID, expected);
});

test('uses the 32 letters a through p Chrome puts in an extension id', () => {
  assert.match(CONNECTOR_EXTENSION_ID, /^[a-p]{32}$/);
});
