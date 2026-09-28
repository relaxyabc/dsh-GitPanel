/**
 * Visual preview generator for the Git panel.
 *
 * Builds a throwaway workspace holding repositories with branches, changes, a
 * submodule and a bare remote, runs the real Host half against it, renders the
 * real client bundle through a minimal React stand-in, and serializes the
 * full-page three-column panel to a standalone HTML page in both palettes.
 * The markup and classes are the plugin's own; only the theme token values are
 * supplied here because the running application owns them.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'preview')

/** A repository that carries branches, changes, a commit history and a submodule. */
const workspace = join(tmpdir(), 'dsh-git-preview')
rmSync(workspace, { recursive: true, force: true })
mkdirSync(workspace, { recursive: true })

/** Isolated git config so the fixture never reads the operator's identity. */
const GIT_CONFIG = join(workspace, '.gitconfig')
writeFileSync(GIT_CONFIG, '[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n[protocol "file"]\n\tallow = always\n')

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: GIT_CONFIG,
  GIT_CONFIG_SYSTEM: GIT_CONFIG,
  GIT_TERMINAL_PROMPT: '0',
}

// The Host half spawns `git` with the process environment, so the identity and
// transport this fixture relies on must also reach the plugin's own children.
process.env.GIT_CONFIG_GLOBAL = GIT_CONFIG
process.env.GIT_CONFIG_SYSTEM = GIT_CONFIG
process.env.GIT_ALLOW_PROTOCOL = 'file:git:http:https'

/**
 * Run git in a directory.
 * @param {string} cwd - directory.
 * @param {string[]} args - argv.
 * @returns {string} stdout.
 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' })
}

// ---- fixture ----------------------------------------------------------------
const app = join(workspace, 'app')
mkdirSync(app, { recursive: true })
git(app, ['init', '-b', 'main'])
writeFileSync(join(app, 'package.json'), '{"name":"app"}\n')
mkdirSync(join(app, 'src'), { recursive: true })
writeFileSync(join(app, 'src', 'index.ts'), "export const main = () => 'hello'\n")
git(app, ['add', '-A'])
git(app, ['commit', '-m', 'chore: scaffold the project'])
writeFileSync(join(app, 'src', 'index.ts'), "export const main = () => 'hello world'\nexport const version = 2\n")
git(app, ['add', '-A'])
git(app, ['commit', '-m', 'feat: greet the world and expose a version'])
git(app, ['checkout', '-b', 'fix/rename-docs'])
git(app, ['checkout', 'main'])
git(app, ['branch', 'chore/bump-deps'])
git(app, ['branch', 'feature/git-panel'])

const lib = join(workspace, 'libsource')
mkdirSync(lib, { recursive: true })
git(lib, ['init', '-b', 'main'])
writeFileSync(join(lib, 'lib.ts'), 'export const answer = 42\n')
git(lib, ['add', '-A'])
git(lib, ['commit', '-m', 'feat: add the answer'])
git(app, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '../libsource', 'vendor/lib'])
git(app, ['commit', '-m', 'build: vendor the shared library as a submodule'])

const bare = join(workspace, 'origin.git')
mkdirSync(bare, { recursive: true })
git(bare, ['init', '--bare', '-b', 'main'])
git(app, ['remote', 'add', 'origin', bare.replace(/\\/g, '/')])
git(app, ['push', '--quiet', '--set-upstream', 'origin', 'main'])
writeFileSync(join(app, 'README.md'), '# Application\n')
writeFileSync(join(app, 'src', 'index.ts'), "export const main = () => 'hello world'\nexport const version = 3\nexport const ready = true\n")
rmSync(join(app, 'package.json'))
mkdirSync(join(app, 'docs'), { recursive: true })
writeFileSync(join(app, 'docs', 'guide.md'), '# Guide\n')
git(app, ['add', '-A'])

// ---- host half --------------------------------------------------------------
const { apply } = await import('../index.js')

/** The registered Fetch route. */
let route = null
apply({
  effect: (callback) => callback(),
  connection: {
    fetch: {
      register: (registered) => {
        route = registered
        return async () => {}
      },
    },
  },
})

/**
 * Answer one operation by running the real Host half.
 * @param {object} envelope - the posted request body.
 * @returns {Promise<object>} the decoded envelope.
 */
async function host(envelope) {
  const response = await route.fetch(
    new Request('http://127.0.0.1/api/local-git', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    }),
  )
  return response.json()
}

// ---- component harness ------------------------------------------------------
let currentOwner = null
let rootInstance = null
let timers = []

/** Host calls in flight, so the settle loop can await them. */
const pending = new Set()

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const flat = children.flat()
    return { type, props: { ...(props ?? {}), children: flat }, children: flat }
  },
  useState(initial) {
    const hook = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    const root = rootInstance
    return [hook.value, (next) => {
      const value = typeof next === 'function' ? next(hook.value) : next
      if (Object.is(value, hook.value)) return
      hook.value = value
      if (root !== null) root.dirty = true
    }]
  },
  useMemo(factory, deps) {
    const hook = slot(() => ({ deps: undefined, result: undefined }))
    if (!same(hook.deps, deps)) {
      hook.result = factory()
      hook.deps = deps
    }
    return hook.result
  },
  useCallback(callback, deps) {
    const hook = slot(() => ({ deps: undefined, result: undefined }))
    if (!same(hook.deps, deps)) {
      hook.result = callback
      hook.deps = deps
    }
    return hook.result
  },
  useEffect(effect, deps) {
    const hook = slot(() => ({ deps: undefined, cleanup: undefined, effect: undefined }))
    if (same(hook.deps, deps)) return
    hook.deps = deps
    hook.effect = () => {
      if (typeof hook.cleanup === 'function') hook.cleanup()
      const cleanup = effect()
      hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  },
}

/**
 * Compare dependency arrays.
 * @param {readonly unknown[]|undefined} left - previous.
 * @param {readonly unknown[]|undefined} right - next.
 * @returns {boolean} whether they match.
 */
function same(left, right) {
  if (left === undefined || right === undefined) return false
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

/**
 * Take one hook slot.
 * @param {Function} initial - slot factory.
 * @returns {object} the slot.
 */
function slot(initial) {
  const index = currentOwner.cursor
  currentOwner.cursor += 1
  if (currentOwner.hooks.length <= index) currentOwner.hooks.push(initial())
  return currentOwner.hooks[index]
}

globalThis.window = {
  __ModuleLoader__: { load: (entry) => { globalThis.__registration = entry } },
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (callback) => {
    timers.push(callback)
    return 0
  },
  clearTimeout: () => {},
}
globalThis.require = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
}

/**
 * Wrap the Host call so the settle loop can await every call the panel made.
 * @param {RequestInfo} url - request URL.
 * @param {RequestInit} init - request inputs.
 * @returns {Promise<object>} the response.
 */
function trackedFetch(url, init) {
  const body = JSON.parse(init.body)
  const answer = (async () => {
    const data = (await host(body)).data
    if (process.env.DSH_PREVIEW_DEBUG === '1') {
      const shape = Array.isArray(data?.repositories) ? `${data.repositories.length} repositories`
        : Array.isArray(data?.files) ? `${data.files.length} files`
        : Array.isArray(data?.commits) ? `${data.commits.length} commits`
        : 'ok'
      console.error(`[preview] ${body.op} -> ${shape}`)
    }
    return { status: 200, json: async () => ({ ok: true, data }) }
  })()
  const tracked = answer.finally(() => pending.delete(tracked))
  pending.add(tracked)
  return tracked
}

const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
new Function('window', 'require', 'fetch', source)(globalThis.window, globalThis.require, trackedFetch)

const loaded = globalThis.__registration.factory(globalThis.require)

/** The locale service stand-in: captures dictionaries, renders DSH_PREVIEW_LANG (default en). */
const PREVIEW_LANG = process.env.DSH_PREVIEW_LANG === 'zh' ? 'zh' : 'en'
const previewLocale = { dicts: {} }
/** The main panel component. */
let panelComponent = null
loaded.apply({
  effect: (callback) => {
    callback()
    return () => {}
  },
  locale: {
    register: (ns, dicts) => {
      previewLocale.dicts[ns] = dicts
      return () => {}
    },
    bind: () => (key) => previewLocale.dicts.sidebarGit?.[PREVIEW_LANG]?.[key] ?? key,
  },
  sidebarRightTabs: { register: () => () => {} },
  slots: {
    inject: (name, callback) => {
      callback()
      return () => {}
    },
    register: (options, component) => {
      if (options.name === 'main') panelComponent = component
      return () => {}
    },
  },
})
void PREVIEW_LANG

/**
 * Drain scheduled timers and in-flight Host calls.
 * @returns {Promise<void>} nothing.
 */
async function drain() {
  for (let round = 0; round < 60; round += 1) {
    await Promise.resolve()
    while (pending.size > 0) await Promise.all([...pending])
    const queued = timers
    timers = []
    for (const callback of queued) callback()
    if (queued.length === 0 && pending.size === 0 && round > 3) return
  }
}

/**
 * Expand function components with per-position hook caching.
 * @param {object} node - element.
 * @param {object} owner - enclosing hook table.
 * @returns {object} the expanded node.
 */
function expand(node, owner) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((child) => expand(child, { children: new Map(), cursor: 0 }))
  if (typeof node.type === 'function') {
    const outer = currentOwner
    let instance = owner.children.get(node.type)
    if (instance === undefined) {
      instance = { hooks: [], cursor: 0 }
      owner.children.set(node.type, instance)
    }
    instance.cursor = 0
    currentOwner = instance
    const rendered = node.type(node.props)
    currentOwner = outer
    return expand(rendered, { children: new Map(), cursor: 0 })
  }
  if (typeof node.type === 'symbol') return (node.children ?? []).map((child) => expand(child, { children: new Map(), cursor: 0 }))
  return { ...node, children: (node.children ?? []).flat().map((child) => expand(child, { children: new Map(), cursor: 0 })) }
}

/**
 * Render the panel and settle its effects.
 *
 * @param {(view: { tree: object, redraw: Function }) => Promise<void>} [drive] - an optional interaction applied after the first settle, before the tree is returned.
 * @returns {Promise<object>} the settled render.
 */
async function render(drive) {
  const instance = { hooks: [], cursor: 0, dirty: true, tree: null, expanded: null, children: new Map() }
  const activeOwner = currentOwner
  rootInstance = instance
  const pass = async () => {
    instance.dirty = false
    instance.cursor = 0
    currentOwner = instance
    instance.tree = panelComponent({
      sessionId: 'session-1',
      useWorkspaces: () => [{ path: workspace, title: 'dsh-git-preview' }],
      useSessions: (selector) => selector({ ids: ['session-1'], byId: { 'session-1': { cwd: workspace, retainedBy: { mainView: 1 } } } }),
    })
    currentOwner = activeOwner
    instance.expanded = expand(instance.tree, instance)
    for (const hooks of [instance, ...instance.children.values()]) {
      for (const hook of hooks.hooks) {
        if (hook.effect === undefined) continue
        const effect = hook.effect
        hook.effect = undefined
        effect()
      }
    }
    await drain()
  }
  for (let round = 0; round < 40; round += 1) {
    await pass()
    if (!instance.dirty) break
  }
  if (typeof drive === 'function') {
    /**
     * Re-render after the interaction changed state.
     *
     * @returns {Promise<object>} the new expanded tree.
     */
    const redraw = async () => {
      instance.dirty = true
      for (let round = 0; round < 40; round += 1) {
        if (!instance.dirty) break
        await pass()
      }
      return instance.expanded
    }
    await drive({ tree: instance.expanded, redraw })
  }
  rootInstance = null
  return instance.expanded
}

/**
 * Find the first element satisfying a predicate.
 *
 * @param {object} node - element tree.
 * @param {Function} predicate - matcher.
 * @returns {object|undefined} the element.
 */
function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node.props !== undefined && predicate(node)) return node
  for (const child of node.children ?? []) {
    const hit = findNode(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * Collect the text one element renders.
 *
 * @param {object} node - element tree.
 * @param {Array<string>} bucket - accumulator.
 * @returns {Array<string>} the text.
 */
function textOf(node, bucket = []) {
  if (typeof node === 'string' || typeof node === 'number') {
    bucket.push(String(node))
    return bucket
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, bucket)
    return bucket
  }
  if (node !== null && typeof node === 'object') for (const child of node.children ?? []) textOf(child, bucket)
  return bucket
}

const tree = await render()

// The second artefact is the same panel with the side-by-side diff modal open,
// so a style change to the modal is visible without driving the real app.
const modalTree = await render(async (view) => {
  const row = findNode(
    view.tree,
    (element) => typeof element.props?.className === 'string' && element.props.className.includes('dsh-git-row') && typeof element.props?.onDoubleClick === 'function' && textOf(element).includes('index.ts'),
  )
  if (row === undefined) {
    console.error('[preview] no changed-path row was found; the modal artefact is empty')
    return
  }
  row.props.onDoubleClick()
  await view.redraw()
})

/** The stylesheet the panel ships, extracted from its own style element. */
let stylesheet = ''
const stack = [tree]
while (stack.length > 0) {
  const node = stack.pop()
  if (node === null || typeof node !== 'object') continue
  if (node.type === 'style') stylesheet = node.children?.[0] ?? ''
  for (const child of node.children ?? []) stack.push(child)
}

/**
 * Serialize an element tree to HTML.
 * @param {object} node - element.
 * @returns {string} the markup.
 */
function toHtml(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  if (Array.isArray(node)) return node.map(toHtml).join('')
  if (typeof node.type !== 'string') return toHtml(node.children)
  const attributes = []
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'children' || value === undefined || value === null || typeof value === 'function') continue
    if (key === 'className') attributes.push(`class="${String(value)}"`)
    else if (key === 'style' && typeof value === 'object') {
      attributes.push(`style="${Object.entries(value).map(([name, entry]) => `${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${entry}`).join(';')}"`)
    } else if (key === 'checked' || key === 'disabled' || key === 'autoFocus') {
      if (value === true) attributes.push(key.toLowerCase())
    } else if (['value', 'placeholder', 'title', 'type', 'aria-label', 'aria-expanded', 'aria-hidden'].includes(key)) {
      attributes.push(`${key}="${String(value).replace(/"/g, '&quot;')}"`)
    }
  }
  const body = toHtml(node.children)
  if (node.type === 'input' || node.type === 'textarea') return `<${node.type} ${attributes.join(' ')}>`
  return `<${node.type} ${attributes.join(' ')}>${body}</${node.type}>`
}

/** Light and dark values for the tokens the panel uses, in the DSW palette's spirit. */
const PALETTES = {
  light: {
    '--dsw-alias-bg-base': '#ffffff',
    '--dsw-alias-bg-layer-1': '#ffffff',
    '--dsw-alias-bg-layer-2': '#f4f5f7',
    '--dsw-alias-bg-overlay': '#ffffff',
    '--dsw-alias-border-l1': '#e3e5e8',
    '--dsw-alias-border-l2': '#cdd1d6',
    '--dsw-alias-brand-primary': '#4d6bfe',
    '--dsw-alias-label-primary': '#1f2328',
    '--dsw-alias-label-secondary': '#6b7280',
    '--dsw-alias-state-error-primary': '#d1242f',
    '--dsw-alias-state-success-primary': '#1a7f37',
    '--dsw-alias-state-warn-primary': '#9a6700',
  },
  dark: {
    '--dsw-alias-bg-base': '#1b1c1e',
    '--dsw-alias-bg-layer-1': '#212225',
    '--dsw-alias-bg-layer-2': '#2a2c30',
    '--dsw-alias-bg-overlay': '#26282c',
    '--dsw-alias-border-l1': '#33363b',
    '--dsw-alias-border-l2': '#44484e',
    '--dsw-alias-brand-primary': '#6c86ff',
    '--dsw-alias-label-primary': '#e8eaed',
    '--dsw-alias-label-secondary': '#9aa0a6',
    '--dsw-alias-state-error-primary': '#f07178',
    '--dsw-alias-state-success-primary': '#4ec26a',
    '--dsw-alias-state-warn-primary': '#d5a021',
  },
}

/**
 * Render one palette pane.
 *
 * @param {string} label - the pane caption.
 * @param {object} view - the element tree to serialize.
 * @param {'light'|'dark'} name - palette name.
 * @param {string} [frameClass] - extra frame class; `frame-modal` anchors the fixed overlay inside the frame.
 * @returns {string} the pane markup.
 */
function pane(label, view, name, frameClass = '') {
  const tokens = Object.entries(PALETTES[name]).map(([token, value]) => `${token}:${value}`).join(';')
  return `<figure class="pane ${name}" style="${tokens}">
    <figcaption>${label}</figcaption>
    <div class="frame ${frameClass}">${toHtml(view)}</div>
  </figure>`
}

mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, 'git-panel.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Git panel preview</title>
<style>
  body { margin: 0; padding: 24px; background: #6b7280; font-family: ui-sans-serif, system-ui, sans-serif; }
  .pane { margin: 0 0 24px; }
  .pane figcaption { color: #fff; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
  .frame { width: 1180px; max-width: 96vw; height: 820px; overflow: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
  /* A transformed ancestor makes the fixed-position modal overlay this frame. */
  .frame-modal { position: relative; transform: translateZ(0); }
  ${stylesheet}
</style></head>
<body>${pane('panel — light', tree, 'light')}${pane('panel — dark', tree, 'dark')}${pane('diff modal — light', modalTree, 'light', 'frame-modal')}${pane('diff modal — dark', modalTree, 'dark', 'frame-modal')}</body></html>
`,
)

console.log(`wrote ${join(outDir, 'git-panel.html')}`)
console.log(`fixture kept at ${workspace} (delete it when done inspecting)`)
