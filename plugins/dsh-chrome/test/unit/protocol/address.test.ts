import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAddress } from '../../../src/protocol/address.ts';

test('opens a bare host over https', () => {
  assert.equal(normalizeAddress('example.com'), 'https://example.com/');
});

test('opens loopback hosts over http', () => {
  assert.equal(normalizeAddress('localhost:3000'), 'http://localhost:3000/');
  assert.equal(normalizeAddress('127.0.0.1:8080/path'), 'http://127.0.0.1:8080/path');
  assert.equal(normalizeAddress('[::1]:5173'), 'http://[::1]:5173/');
});

test('keeps an explicit http or https address', () => {
  assert.equal(normalizeAddress('http://example.com'), 'http://example.com/');
  assert.equal(normalizeAddress('https://example.com/docs?q=1'), 'https://example.com/docs?q=1');
});

test('allows about:blank for a page without content', () => {
  assert.equal(normalizeAddress('about:blank'), 'about:blank');
});

test('trims whitespace around the address', () => {
  assert.equal(normalizeAddress('  example.com  '), 'https://example.com/');
});

test('returns undefined for an empty address', () => {
  assert.equal(normalizeAddress(''), undefined);
  assert.equal(normalizeAddress('   '), undefined);
  assert.equal(normalizeAddress('\t\n'), undefined);
});

test('refuses schemes that reach beyond the web', () => {
  const addresses = [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,x',
    'chrome://settings',
  ];
  for (const address of addresses) {
    assert.equal(normalizeAddress(address), undefined, address);
  }
});

test('refuses an address that carries credentials', () => {
  assert.equal(normalizeAddress('https://user:pw@example.com'), undefined);
  assert.equal(normalizeAddress('https://user@example.com'), undefined);
});
