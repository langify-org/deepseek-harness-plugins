import type { Protocol } from '../runtime/cdp.ts';
import type { ChromePage } from '../runtime/pages.ts';

/**
 * The page as the agent reads it: the accessibility tree Chrome computes, one line per
 * meaningful node, indented by depth. Elements the agent can act on carry a ref such as
 * `[ref=e42]`, made from Chrome's backend DOM node id; refs stay valid until the page
 * navigates or the element is removed.
 *
 *     - document "Example Domain"
 *       - heading "Example Domain" [level=1]
 *       - text: This domain is for use in illustrative examples.
 *       - link "More information..." [ref=e12]
 */

export interface Snapshot {
  readonly text: string;
  /** Whether lines were left out to stay within the size limit. */
  readonly truncated: boolean;
}

/** Roles whose elements the agent may act on, and which therefore get refs. */
const ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

/** Structural roles that add nothing when they have no name: their children take their place. */
const TRANSPARENT_ROLES: ReadonlySet<string> = new Set([
  'generic',
  'none',
  'presentation',
  'InlineTextBox',
  'LineBreak',
  'ListMarker',
]);

const ROLE_RENAMES: Readonly<Record<string, string>> = {
  RootWebArea: 'document',
  StaticText: 'text',
};
const MAX_NAME_CHARS = 200;
const MAX_VALUE_CHARS = 100;

/** Formats a full accessibility tree, as `Accessibility.getFullAXTree` returns it. */
export function formatAccessibilityTree(
  nodes: readonly Protocol.Accessibility.AXNode[],
  maxChars: number,
): Snapshot {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const roots = nodes.filter((node) => node.parentId === undefined || !byId.has(node.parentId));
  const lines: string[] = [];
  let length = 0;
  let truncated = false;

  const emit = (line: string): boolean => {
    if (length + line.length + 1 > maxChars) {
      truncated = true;
      return false;
    }
    lines.push(line);
    length += line.length + 1;
    return true;
  };

  const walk = (
    node: Protocol.Accessibility.AXNode,
    depth: number,
    parentName: string,
  ): boolean => {
    const role = stringValue(node.role);
    const name = clip(stringValue(node.name), MAX_NAME_CHARS);
    let childDepth = depth;
    let childParentName = parentName;
    if (!node.ignored && !(TRANSPARENT_ROLES.has(role) && name === '')) {
      const line = describe(node, role, name, parentName);
      if (line !== undefined) {
        if (!emit(`${'  '.repeat(depth)}- ${line}`)) return false;
        childDepth = depth + 1;
        childParentName = name;
      }
    }
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child !== undefined && !walk(child, childDepth, childParentName)) return false;
    }
    return true;
  };

  for (const root of roots) {
    if (!walk(root, 0, '')) break;
  }
  if (truncated) lines.push('- … (more of the page was left out; act on what is shown or scroll)');
  return { text: lines.join('\n'), truncated };
}

/** One node's line, or `undefined` when the node repeats its parent's name. */
function describe(
  node: Protocol.Accessibility.AXNode,
  role: string,
  name: string,
  parentName: string,
): string | undefined {
  if (role === 'StaticText')
    return name === '' || name === parentName ? undefined : `text: ${name}`;
  const parts = [ROLE_RENAMES[role] ?? role];
  if (name !== '') parts.push(JSON.stringify(name));
  const properties = new Map(
    (node.properties ?? []).map((property) => [property.name, property.value.value]),
  );
  if (
    node.backendDOMNodeId !== undefined &&
    (ACTIONABLE_ROLES.has(role) || properties.get('focusable') === true)
  ) {
    parts.push(`[ref=e${node.backendDOMNodeId}]`);
  }
  const value = clip(stringValue(node.value), MAX_VALUE_CHARS);
  if (value !== '' && value !== name) parts.push(`value=${JSON.stringify(value)}`);
  for (const state of states(properties)) parts.push(`[${state}]`);
  return parts.join(' ');
}

function states(properties: ReadonlyMap<string, unknown>): string[] {
  const result: string[] = [];
  const checked = properties.get('checked');
  if (checked === 'true' || checked === true) result.push('checked');
  else if (checked === 'mixed') result.push('checked=mixed');
  const pressed = properties.get('pressed');
  if (pressed === 'true' || pressed === true) result.push('pressed');
  const expanded = properties.get('expanded');
  if (expanded === true) result.push('expanded');
  else if (expanded === false) result.push('collapsed');
  if (properties.get('selected') === true) result.push('selected');
  if (properties.get('disabled') === true) result.push('disabled');
  if (properties.get('required') === true) result.push('required');
  if (properties.get('focused') === true) result.push('focused');
  const level = properties.get('level');
  if (typeof level === 'number') result.push(`level=${level}`);
  return result;
}

function stringValue(value: Protocol.Accessibility.AXValue | undefined): string {
  const raw = value?.value;
  return typeof raw === 'string' || typeof raw === 'number'
    ? String(raw).replace(/\s+/g, ' ').trim()
    : '';
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/** Reads the page's accessibility tree from Chrome and formats it. */
export async function readSnapshot(page: ChromePage, maxChars: number): Promise<Snapshot> {
  const { nodes } = await page.send('Accessibility.getFullAXTree');
  return formatAccessibilityTree(nodes, maxChars);
}
