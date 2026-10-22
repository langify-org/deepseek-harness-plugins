# Writing DSH plugins

What this workspace has learned about DeepSeek Harness 0.2 plugins. Each rule names the
behavior behind it, so that a later DSH release can be checked against it.

## How DSH loads a plugin

- DSH installs a plugin package into a profile and mounts its **bundle patch**
  (`dsh.bundle.patch`): a list of Loader rows, each naming a module by package specifier
  (`@scope/name` or `@scope/name/subpath`). `@langify-org/dsh-plugin-build` generates the
  patch from the plugin's `build.ts`.
- DSH serves a package's browser module (`exports["./client"]`, `dsh.client`) **only when
  some Loader row names the bare package**. A plugin with a browser half therefore needs a
  host plugin at export `.`, even a small one. The build tool enforces this.
- A Loader row can be turned off from the profile's `cordis.patch.yml`
  (`- id: <row id>` / `disabled: true`). Give separable features their own rows, as
  dsh-chrome does with its tools and its context reading.
- `engines.dsh` alone decides compatibility when present (DSH's
  `evaluatePluginCompatibility`). Prereleases take part in ranges.

## Host plugins

- Imports of `@deepseek-ai/*` resolve to DSH's own copies at run time; keep them external
  and declare them as peer dependencies. Bundle everything else.
- **Cordis calls a service's methods and getters through a proxy** of the instance (to
  track which context uses it). Inside them, `this` is that proxy, and ECMAScript private
  fields (`#field`) throw `Cannot read private member`. Classes that extend `Service` use
  TypeScript `private` members instead. Plain objects a service holds are not proxied.
- A `Service` subclass that needs asynchronous setup does it in `[Service.init]()`, and
  releases what it acquired with `this.ctx.effect(() => () => …)`.
- **A row counts as started once its `apply` returns.** DSH then checks the rows that
  inject its services, and reports those still waiting as "did not activate". A row whose
  service other rows inject awaits it: `await ctx.plugin(MyService, config)`.
- Keep a plugin's files in the DSH home (`dshHomePath()` from
  `@deepseek-ai/dsh-home-paths`), not in a fixed place: Desktop, a `dsh` of one's own and a
  development DSH each have their own home. Name anything else they would share, such as a
  socket, by the home.
- `dsh web` does not print what plugins log with `ctx.logger`. Tell the user what they need
  to do in the plugin's own UI, or in the error a request returns.
- Authenticate every network route the way DSH authenticates `/api`: call
  `ctx.connection.requestRejection(request)` before upgrading or answering. Remote clients
  (a phone over a tunnel) then work with no extra configuration, and nothing else can reach
  the route. Do not open a port of your own.
- Tools: `defineTool` from `@deepseek-ai/dsh-tools` validates parameters and the output
  value against the declared schemas; `output.render` turns the value into content blocks.
  A tool learns its session from `exec.agent?.id`.
- Context for the model: an `agent/pre-step` listener may prepend user messages with a
  source kind of the plugin's own (declare it in `MessageSourceMap`). Add one only when the
  state it reports changed, so cached prompt prefixes stay valid.

## Browser modules

- The shell provides a fixed set of modules (React, Cordis, the slot and store kits, the
  UI primitives); a bundle may require only those and the packages it lists in
  `dsh.client.external`. The build tool rejects anything else, because it would fail only
  at run time.
- Types of client services come from `@deepseek-ai/*/client` subpaths. Some services are
  not declared on `Context` in DSH 0.2.1-rc.2 (the web client's `ctx.connection`); declare
  them in one place in the plugin.
- Right-sidebar tabs: register the type with `ctx.sidebarRightTabs.register` and its body
  in the `sidebar.right.pane.tab` slot under the same id. `keepMounted: true` keeps a tab
  alive in the background; tell the host when it is hidden instead of streaming to it.
- Session-scope slot components receive the session's `inputActions` (the message
  composer) as a prop when DSH's conversation UI is composed.

## Tests

| Tier | Runs | Proves |
| --- | --- | --- |
| Unit | always | Pure logic: parsing, formatting, state machines. |
| Compat | always, after a build | The built bundles inside a real Cordis context with DSH's own Host services, at the DSH version `engines.dsh` names. This tier caught the private-field proxy rule above. |
| Integration | on demand | The plugin against the real external software it drives. |
| Development DSH | by hand, `pnpm dev` | The installed plugin in a whole DSH: the Loader, startup order, the real web client. This is where the row start-up rule above showed. |

Keep fakes at the edges: a fake stands in for a whole DSH service only when the real one
needs the full agent composition, and says which checks it reduces.
