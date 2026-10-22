import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChromePage, PageEnding } from '../../../../src/host/chrome/pages/page.ts';
import { ElementRefError, ElementRefs } from '../../../../src/host/page-operations/element-refs.ts';

interface FakePage {
  readonly id: string;
  loaderId: string;
  treeReads: number;
  readonly endListeners: Set<(ending: PageEnding) => void>;
  onTreeRead: (() => void) | undefined;
  send(method: string): Promise<unknown>;
  onEnded(listener: (ending: PageEnding) => void): () => void;
  end(): void;
}

const accessibilityTree = {
  nodes: [
    {
      nodeId: 'root',
      ignored: false,
      role: { type: 'role', value: 'RootWebArea' },
      name: { type: 'computedString', value: 'Test page' },
      childIds: ['button'],
    },
    {
      nodeId: 'button',
      ignored: false,
      role: { type: 'role', value: 'button' },
      name: { type: 'computedString', value: 'Save' },
      parentId: 'root',
      backendDOMNodeId: 42,
    },
  ],
};

function fakePage(): FakePage {
  const page: FakePage = {
    id: 'p1',
    loaderId: 'loader-1',
    treeReads: 0,
    endListeners: new Set(),
    onTreeRead: undefined,
    send(method) {
      if (method === 'Page.getFrameTree') {
        return Promise.resolve({
          frameTree: { frame: { id: 'main', loaderId: page.loaderId } },
        });
      }
      if (method === 'Accessibility.getFullAXTree') {
        page.treeReads += 1;
        page.onTreeRead?.();
        return Promise.resolve(accessibilityTree);
      }
      return Promise.reject(new Error(`unexpected CDP method ${method}`));
    },
    onEnded(listener) {
      page.endListeners.add(listener);
      return () => page.endListeners.delete(listener);
    },
    end() {
      for (const listener of [...page.endListeners]) listener('closed');
      page.endListeners.clear();
    },
  };
  return page;
}

function asChromePage(page: FakePage): ChromePage {
  return page as unknown as ChromePage;
}

async function refError(action: Promise<unknown>): Promise<ElementRefError> {
  try {
    await action;
  } catch (error) {
    assert.ok(error instanceof ElementRefError);
    return error;
  }
  assert.fail('expected the action to reject with ElementRefError');
}

test('formats a snapshot whose actionable element carries its backend node id as a ref', async () => {
  const page = fakePage();
  const refs = new ElementRefs();

  const snapshot = await refs.snapshot(asChromePage(page), 1000);

  assert.equal(snapshot.text, '- document "Test page"\n  - button "Save" [ref=e42]');
  assert.equal(snapshot.truncated, false);
  assert.equal(page.treeReads, 1);
});

test('resolves a ref from the snapshot to its backend node id and trims the ref', async () => {
  const page = fakePage();
  const refs = new ElementRefs();
  await refs.snapshot(asChromePage(page), 1000);

  assert.deepEqual(await refs.resolve(asChromePage(page), 'e42'), {
    backendNodeId: 42,
    ref: 'e42',
  });
  assert.deepEqual(await refs.resolve(asChromePage(page), ' e42 '), {
    backendNodeId: 42,
    ref: 'e42',
  });
});

test('rejects a ref that is not an e followed by digits', async () => {
  const page = fakePage();
  const refs = new ElementRefs();
  await refs.snapshot(asChromePage(page), 1000);

  for (const ref of ['42', 'x1']) {
    const error = await refError(refs.resolve(asChromePage(page), ref));
    assert.equal(error.name, 'ElementRefError');
    assert.ok(error.message.includes(`"${ref}" is not an element ref`), error.message);
  }
});

test('rejects a ref before any snapshot with directions to take one', async () => {
  const page = fakePage();
  const refs = new ElementRefs();

  const error = await refError(refs.resolve(asChromePage(page), 'e42'));

  assert.match(error.message, /take a snapshot of page p1 before acting on e42/);
});

test('rejects a ref after another document and resolves it after a new snapshot', async () => {
  const page = fakePage();
  const refs = new ElementRefs();
  await refs.snapshot(asChromePage(page), 1000);

  page.loaderId = 'loader-2';
  const error = await refError(refs.resolve(asChromePage(page), 'e42'));
  assert.match(error.message, /has shown another document since the snapshot e42 came from/);

  await refs.snapshot(asChromePage(page), 1000);
  assert.deepEqual(await refs.resolve(asChromePage(page), 'e42'), {
    backendNodeId: 42,
    ref: 'e42',
  });
});

test('reads the snapshot again when the document changes while it is read', async () => {
  const page = fakePage();
  const refs = new ElementRefs();
  page.onTreeRead = () => {
    page.onTreeRead = undefined;
    page.loaderId = 'loader-2';
  };

  const snapshot = await refs.snapshot(asChromePage(page), 1000);
  assert.equal(snapshot.text, '- document "Test page"\n  - button "Save" [ref=e42]');
  assert.equal(page.treeReads, 2);
  assert.deepEqual(await refs.resolve(asChromePage(page), 'e42'), {
    backendNodeId: 42,
    ref: 'e42',
  });
});

test('rejects after three attempts when the page keeps navigating during the read', async () => {
  const page = fakePage();
  const refs = new ElementRefs();
  let changes = 0;
  page.onTreeRead = () => {
    changes += 1;
    page.loaderId = `loader-${changes + 1}`;
  };

  await assert.rejects(
    refs.snapshot(asChromePage(page), 1000),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'the page kept navigating while it was read; try again once it settles',
  );
  assert.equal(page.treeReads, 3);
});

test('forgets the refs once the page ends', async () => {
  const page = fakePage();
  const refs = new ElementRefs();
  await refs.snapshot(asChromePage(page), 1000);
  assert.equal(page.endListeners.size, 1);

  page.end();

  const error = await refError(refs.resolve(asChromePage(page), 'e42'));
  assert.match(error.message, /take a snapshot of page p1 before acting on e42/);
});
