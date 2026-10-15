/**
 * Standalone build for the cascade model picker.
 *
 * DSH loads a UI plugin as two halves, so this config emits three artifacts:
 *
 * 1. `lib/index.js` — the node half. It exports the cordis `apply` hook; a pure
 *    surface plugin has no host-side behaviour, so the body is empty.
 * 2. `lib/invariant.js` — the package-owned invariant companion, imported by
 *    the host's `invariants` service through the `./invariant` subpath export.
 * 3. `lib/client.js` — the browser half. DSH fetches it from
 *    `/plugins/<row name>/client.js` and evaluates it inside the shell's module
 *    loader, so the artifact must (a) hand its factory to
 *    `window.__ModuleLoader__.load({ id, factory })`, (b) keep every
 *    shell-provided specifier an external `require` — the loader answers those
 *    from its module table — and (c) inline everything else, because a
 *    `require()` the table cannot answer throws at runtime.
 *
 * `ID` must equal the `name` field in package.json: the loader keys the module
 * by the id in the handoff, and the row name in `cordis.patch.yml` is what the
 * registry resolves to find this file.
 *
 * CSS Modules are compiled here by lightningcss: each `.module.css` becomes a
 * virtual module that exports the hashed class map and injects one tagged
 * `<style>` element when the factory runs.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

/** Plugin id: the package name, the row name, and the module-loader key. */
const ID = 'dsh-cascade-model-picker'

/**
 * Shell-provided module-table specifiers this bundle imports. Anything listed
 * here stays `require('…')` in the output; anything else is inlined. The list is
 * exactly what a React-based seat over the session-controller, store, and
 * primitives surfaces needs — do not add a specifier the shell does not serve.
 */
const EXTERNALS = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
])

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
/** The virtual id must not end in `.css`, or tsdown's own CSS pipeline claims it. */
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Emit one plugin-owned style injector plus the CSS-Modules class map. */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** Node-half artifacts: plain ESM, no dependencies to bundle. */
const host: UserConfig = {
  name: ID,
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  // `type: module` would otherwise emit index.mjs / invariant.mjs.
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** Browser-half artifact: one file at a pinned name, wrapped for the loader. */
const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // Plugin code is fetched outside the app's own module graph, so its map is the
  // only path from a browser stack frame back to the source.
  sourcemap: true,
  deps: {
    neverBundle: (specifier: string) => EXTERNALS.has(specifier),
    alwaysBundle: (specifier: string) => !EXTERNALS.has(specifier),
  },
  // Inlined dependencies read the build environment (zustand/immer probe both
  // `process.env.NODE_ENV` and `import.meta.env`); a CJS browser bundle cannot
  // carry a live `import.meta`, so both keys are substituted at build time.
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const fileId = importer === undefined ? source : resolve(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + fileId + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      // The virtual id hides the physical file from the watch graph.
      if (existsSync(fileId)) this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      const entries = Object.entries(exports ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      for (const [local, exported] of entries) classMap[local] = exported.name
      return styleInjectionModule(ID, fileId, code.toString(), classMap)
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [host, client]
