# @langify-org/dsh-plugin-build

Builds a DeepSeek Harness plugin package into what DSH loads. A plugin states once, in its
`build.ts`, what it builds from which source:

```ts
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '@langify-org/dsh-plugin-build';

await buildPlugin({
  packageDir: fileURLToPath(new URL('.', import.meta.url)),
  hostPlugins: [
    { id: 'my-plugin', exportPath: '.', source: 'src/host/index.ts' },
    { id: 'my-plugin-tools', exportPath: './tools', source: 'src/host/tools/index.ts' },
  ],
  clientModule: { source: 'src/client/index.tsx' },
  nodePrograms: [{ name: 'helper', source: 'src/helper/main.ts' }],
});
```

`node build.ts` then writes `dist/`:

| Output | What it is |
| --- | --- |
| `dist/host/<name>.js` | Each host plugin as a Node ES module. `@deepseek-ai/*` imports stay external, to resolve to DSH's own copies; everything else is bundled. |
| `dist/client.js` | The browser module, wrapped as a module factory for DSH's web client loader. |
| `dist/bin/<name>.js` | Standalone Node programs other processes start, bundled with no dependencies. |
| `dist/cordis.patch.yml` | The bundle patch: one Loader row per host plugin. |

The build fails with a list of problems when the package would otherwise fail only once
DSH runs it:

- `package.json` disagrees with the declaration: an export that does not point at the
  build output, `dsh.bundle.patch` not naming the generated patch, `files` not publishing
  `dist`, a browser module without `dsh.client.platform: "web"`, or a duplicate row id.
- A package with a browser module declares no host plugin at export `.` (DSH serves a
  browser module only for Loader rows that name the bare package).
- Host code imports an `@deepseek-ai/*` package that is not a peer dependency.
- The browser module requires something DSH's web client does not provide.
- A Node program imports something other than Node's built-in modules.

See [docs/plugin-guidelines.md](../../docs/plugin-guidelines.md) for the DSH behavior
behind these rules.
