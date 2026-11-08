import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../tsdown.client.ts'

const client = clientBundle(import.meta.dirname)
// noVNC exports only its RFB class. The tab feeds noVNC's keyboard translation
// from its own text box (so the user's input method works), which needs the
// Keyboard module the package does not export: point an alias at its file.
// The catalog pins the noVNC version, and with it this path.
const novncCore = dirname(createRequire(import.meta.url).resolve('@novnc/novnc'))
client.alias = { 'novnc-keyboard': join(novncCore, 'input', 'keyboard.js') }

// DSH loads a CommonJS factory, which cannot hold noVNC's one top-level await:
// a probe for H.264 decoding, read only when a connection lists its encodings.
// The flag starts false and is set once the probe answers. A noVNC whose probe
// reads differently fails the build here rather than shipping unchanged.
const PROBE = 'supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();'
client.plugins = [
  client.plugins,
  {
    name: 'novnc-no-top-level-await',
    transform(code, id) {
      if (!id.endsWith(join('@novnc', 'novnc', 'core', 'util', 'browser.js'))) return null
      if (!code.includes(PROBE)) throw new Error(`${id}: noVNC's H.264 probe changed`)
      return code.replace(
        PROBE,
        '_checkWebCodecsH264DecodeSupport().then((supported) => { supportsWebCodecsH264Decode = supported; });',
      )
    },
  },
]

const config: UserConfig[] = [
  // Host half, loaded by DSH's Loader. Nothing imports its types, so none are emitted.
  { entry: { index: 'src/host/index.ts' }, outDir: 'dist', platform: 'node', dts: false },
  client,
]

export default config
