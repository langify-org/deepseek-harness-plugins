import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Protocol } from 'devtools-protocol';
import { formatAccessibilityTree } from '../../../../src/host/page-operations/snapshot.ts';

type AXNode = Protocol.Accessibility.AXNode;

interface NodeProperty {
  readonly name: string;
  readonly value: { readonly type: string; readonly value: unknown };
}

interface NodeSpec {
  readonly nodeId: string;
  readonly role: string;
  readonly name?: string;
  readonly ignored?: boolean;
  readonly parentId?: string;
  readonly childIds?: readonly string[];
  readonly backendDOMNodeId?: number;
  readonly value?: string;
  readonly properties?: readonly NodeProperty[];
}

function node(spec: NodeSpec): AXNode {
  return {
    nodeId: spec.nodeId,
    ignored: spec.ignored ?? false,
    role: { type: 'role', value: spec.role },
    name: { type: 'computedString', value: spec.name ?? '' },
    ...(spec.parentId === undefined ? {} : { parentId: spec.parentId }),
    ...(spec.childIds === undefined ? {} : { childIds: spec.childIds }),
    ...(spec.backendDOMNodeId === undefined ? {} : { backendDOMNodeId: spec.backendDOMNodeId }),
    ...(spec.value === undefined ? {} : { value: { type: 'computedString', value: spec.value } }),
    ...(spec.properties === undefined ? {} : { properties: spec.properties }),
  } as unknown as AXNode;
}

function textOf(nodes: readonly AXNode[]): string {
  return formatAccessibilityTree(nodes, 1000).text;
}

const tree = [
  node({ nodeId: 'root', role: 'RootWebArea', name: 'Title', childIds: ['save'] }),
  node({
    nodeId: 'save',
    role: 'button',
    name: 'Save',
    parentId: 'root',
    backendDOMNodeId: 42,
  }),
];

test('renders a RootWebArea as a document with its name', () => {
  const snapshot = formatAccessibilityTree(
    [node({ nodeId: 'root', role: 'RootWebArea', name: 'Title' })],
    1000,
  );
  assert.equal(snapshot.text, '- document "Title"');
  assert.equal(snapshot.truncated, false);
});

test('indents each level of the tree by two spaces', () => {
  const nodes = [
    node({ nodeId: 'root', role: 'RootWebArea', name: 'Title', childIds: ['nav'] }),
    node({
      nodeId: 'nav',
      role: 'navigation',
      name: 'Nav',
      parentId: 'root',
      childIds: ['home'],
    }),
    node({ nodeId: 'home', role: 'link', name: 'Home', parentId: 'nav' }),
  ];
  assert.equal(
    textOf(nodes),
    ['- document "Title"', '  - navigation "Nav"', '    - link "Home"'].join('\n'),
  );
});

test('gives an actionable element with a backend node id a ref', () => {
  assert.equal(textOf(tree), '- document "Title"\n  - button "Save" [ref=e42]');
});

test('omits an unnamed generic node and keeps its children at the parent depth', () => {
  const nodes = [
    node({ nodeId: 'root', role: 'RootWebArea', name: 'Title', childIds: ['wrapper'] }),
    node({ nodeId: 'wrapper', role: 'generic', parentId: 'root', childIds: ['go'] }),
    node({
      nodeId: 'go',
      role: 'button',
      name: 'Go',
      parentId: 'wrapper',
      backendDOMNodeId: 5,
    }),
  ];
  assert.equal(textOf(nodes), '- document "Title"\n  - button "Go" [ref=e5]');
});

test('omits an ignored node but keeps its children', () => {
  const nodes = [
    node({ nodeId: 'root', role: 'RootWebArea', name: 'Title', childIds: ['hidden'] }),
    node({
      nodeId: 'hidden',
      role: 'group',
      name: 'Hidden',
      ignored: true,
      parentId: 'root',
      childIds: ['go'],
    }),
    node({
      nodeId: 'go',
      role: 'button',
      name: 'Go',
      parentId: 'hidden',
      backendDOMNodeId: 5,
    }),
  ];
  assert.equal(textOf(nodes), '- document "Title"\n  - button "Go" [ref=e5]');
});

test('omits StaticText that repeats the parent name and keeps other text', () => {
  const nodes = [
    node({ nodeId: 'root', role: 'RootWebArea', name: 'Title', childIds: ['heading'] }),
    node({
      nodeId: 'heading',
      role: 'heading',
      name: 'Hello',
      parentId: 'root',
      childIds: ['same', 'different'],
    }),
    node({ nodeId: 'same', role: 'StaticText', name: 'Hello', parentId: 'heading' }),
    node({
      nodeId: 'different',
      role: 'StaticText',
      name: 'Another   sentence',
      parentId: 'heading',
    }),
  ];
  assert.equal(
    textOf(nodes),
    ['- document "Title"', '  - heading "Hello"', '    - text: Another sentence'].join('\n'),
  );
});

test('renders a textbox value after its ref', () => {
  const nodes = [
    node({ nodeId: 'root', role: 'RootWebArea', name: 'Title', childIds: ['email'] }),
    node({
      nodeId: 'email',
      role: 'textbox',
      name: 'Email',
      value: 'me@example.com',
      parentId: 'root',
      backendDOMNodeId: 7,
    }),
  ];
  assert.equal(
    textOf(nodes),
    '- document "Title"\n  - textbox "Email" [ref=e7] value="me@example.com"',
  );
});

test('renders checked, disabled, expanded, level, and focused states', () => {
  const nodes = [
    node({
      nodeId: 'root',
      role: 'RootWebArea',
      name: 'Title',
      childIds: ['checked', 'mixed', 'disabled', 'expanded', 'collapsed', 'level', 'focused'],
    }),
    node({
      nodeId: 'checked',
      role: 'checkbox',
      name: 'Remember',
      parentId: 'root',
      properties: [{ name: 'checked', value: { type: 'boolean', value: true } }],
    }),
    node({
      nodeId: 'mixed',
      role: 'checkbox',
      name: 'Some',
      parentId: 'root',
      properties: [{ name: 'checked', value: { type: 'tristate', value: 'mixed' } }],
    }),
    node({
      nodeId: 'disabled',
      role: 'button',
      name: 'Send',
      parentId: 'root',
      properties: [{ name: 'disabled', value: { type: 'boolean', value: true } }],
    }),
    node({
      nodeId: 'expanded',
      role: 'button',
      name: 'Open',
      parentId: 'root',
      properties: [{ name: 'expanded', value: { type: 'boolean', value: true } }],
    }),
    node({
      nodeId: 'collapsed',
      role: 'button',
      name: 'Close',
      parentId: 'root',
      properties: [{ name: 'expanded', value: { type: 'boolean', value: false } }],
    }),
    node({
      nodeId: 'level',
      role: 'heading',
      name: 'Chapters',
      parentId: 'root',
      properties: [{ name: 'level', value: { type: 'integer', value: 2 } }],
    }),
    node({
      nodeId: 'focused',
      role: 'textbox',
      name: 'Name',
      parentId: 'root',
      properties: [{ name: 'focused', value: { type: 'boolean', value: true } }],
    }),
  ];
  assert.equal(
    textOf(nodes),
    [
      '- document "Title"',
      '  - checkbox "Remember" [checked]',
      '  - checkbox "Some" [checked=mixed]',
      '  - button "Send" [disabled]',
      '  - button "Open" [expanded]',
      '  - button "Close" [collapsed]',
      '  - heading "Chapters" [level=2]',
      '  - textbox "Name" [focused]',
    ].join('\n'),
  );
});

test('gives a ref to a non-actionable node that is focusable', () => {
  const nodes = [
    node({ nodeId: 'root', role: 'RootWebArea', name: 'Title', childIds: ['panel'] }),
    node({
      nodeId: 'panel',
      role: 'group',
      name: 'Panel',
      parentId: 'root',
      backendDOMNodeId: 9,
      properties: [{ name: 'focusable', value: { type: 'boolean', value: true } }],
    }),
  ];
  assert.equal(textOf(nodes), '- document "Title"\n  - group "Panel" [ref=e9]');
});

test('clips names longer than 200 characters with an ellipsis', () => {
  const snapshot = formatAccessibilityTree(
    [node({ nodeId: 'root', role: 'RootWebArea', name: 'a'.repeat(250) })],
    1000,
  );
  assert.equal(snapshot.text, `- document "${'a'.repeat(199)}…"`);
});

test('collapses whitespace in names', () => {
  const nodes = [node({ nodeId: 'root', role: 'RootWebArea', name: '  Hello \n  world  ' })];
  assert.equal(textOf(nodes), '- document "Hello world"');
});

test('leaves out lines that would exceed maxChars and appends the truncation line', () => {
  const snapshot = formatAccessibilityTree(tree, 20);
  assert.equal(snapshot.truncated, true);
  assert.equal(
    snapshot.text,
    [
      '- document "Title"',
      '- … (more of the page was left out; act on what is shown or scroll)',
    ].join('\n'),
  );
});

test('keeps a tree within maxChars whole', () => {
  const snapshot = formatAccessibilityTree(tree, 100);
  assert.equal(snapshot.truncated, false);
  assert.equal(snapshot.text, '- document "Title"\n  - button "Save" [ref=e42]');
});
