/**
 * Render test for the Git manager browser half.
 *
 * Loads `client.js` through the real `window.__ModuleLoader__` contract with a
 * minimal React stand-in that keeps per-component hook tables, runs effects, and
 * re-renders when a setter fires. It drives the full-page panel through its
 * real states — repository discovery, branch list, history, the selected
 * commit's details and a file diff — and inspects the captured registrations.
 * It catches structural errors, not visual ones.
 */
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createModuleLoader } from './module-loader.mjs'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
let checks = 0

/**
 * Assert one condition.
 * @param {boolean} condition - condition to assert.
 * @param {string} label - what was asserted.
 * @param {unknown} detail - extra detail on failure.
 */
function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 400)}`}`)
}

let currentOwner = null
let rootInstance = null

/**
 * Compare dependency arrays.
 * @param {readonly unknown[]|undefined} left - previous.
 * @param {readonly unknown[]|undefined} right - next.
 * @returns {boolean} whether they match.
 */
function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

/**
 * Take the hook slot at the cursor.
 * @param {Function} initial - slot factory.
 * @returns {object} the slot.
 */
function slot(initial) {
  if (currentOwner === null) throw new Error('a hook ran while no component was rendering')
  const index = currentOwner.cursor
  currentOwner.cursor += 1
  if (currentOwner.hooks.length <= index) currentOwner.hooks.push(initial())
  return currentOwner.hooks[index]
}

/** The React stand-in. */
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
    if (!sameDeps(hook.deps, deps)) {
      hook.result = factory()
      hook.deps = deps
    }
    return hook.result
  },
  useCallback(callback, deps) {
    const hook = slot(() => ({ deps: undefined, result: undefined }))
    if (!sameDeps(hook.deps, deps)) {
      hook.result = callback
      hook.deps = deps
    }
    return hook.result
  },
  useEffect(effect, deps) {
    const hook = slot(() => ({ deps: undefined, cleanup: undefined, effect: undefined }))
    if (sameDeps(hook.deps, deps)) return
    hook.deps = deps
    hook.effect = () => {
      if (typeof hook.cleanup === 'function') hook.cleanup()
      const cleanup = effect()
      hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  },
  useRef(initial) {
    const hook = slot(() => ({ value: { current: initial } }))
    return hook.value
  },
}

// ---- module loading ---------------------------------------------------------
globalThis.window = {
  __DSH_GIT_TRACE__: process.env.DSH_SMOKE_TRACE === '1',
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (callback) => {
    timers.push(callback)
    return 0
  },
  clearTimeout: () => {},
}
/**
 * Help regions the settings-field stub has been asked to open, keyed by field id.
 *
 * The harness rebuilds a nested component's hook table on every pass, so the
 * disclosure this stub would hold in `useState` lives here instead.
 */
const openedHelp = new Set()

/**
 * The `@deepseek-ai/dsh-client-ui-primitives` stand-in: the shared settings form
 * and the staged form model the Plugins page card is built from. The model keeps
 * the framework's contract — stage on edit, one revision-fenced write on save —
 * because that staging is what the card's assertions are about.
 */
const primitivesStub = {
  SettingsFormModel: class {
    constructor(scope, specs) {
      this.scope = scope
      this.specs = specs
      this.staged = new Map()
    }
    bind(project) {
      return { getSnapshot: () => project() }
    }
    shell() {
      const snapshot = this.scope.getSnapshot()
      return { available: snapshot.status === 'ready', writable: snapshot.writable === true, dirty: this.staged.size > 0, invalid: false, saving: false, failed: false }
    }
    field(name) {
      const spec = this.specs.find((entry) => entry.field === name)
      const snapshot = this.scope.getSnapshot()
      const staged = this.staged.get(name)
      return {
        text: staged === undefined ? spec.format(snapshot.value?.[name]) : staged,
        overridden: staged !== undefined ? staged !== '' : Object.hasOwn(snapshot.user ?? {}, name),
        invalid: staged !== undefined && spec.parse(staged) === undefined,
      }
    }
    actions() {
      return {
        edit: (field, text) => this.staged.set(field, text),
        resetField: (field) => this.staged.set(field, ''),
        save: () => this.save(),
        discard: () => this.staged.clear(),
      }
    }
    async save() {
      for (const spec of this.specs) {
        const staged = this.staged.get(spec.field)
        if (staged === undefined) continue
        const write = spec.parse(staged)
        if (write === undefined) continue
        const op = write.kind === 'clear' ? { op: 'unset', path: [spec.field] } : { op: 'set', path: [spec.field], value: write.value }
        await this.scope.mutate([op], this.scope.getSnapshot().revision)
      }
      this.staged.clear()
    }
    dispose() {}
  },
  settingsNumberField: (field) => ({
    field,
    format: (value) => (value === undefined || value === null ? '' : String(value)),
    parse: (text) => (text.trim() === '' ? { kind: 'clear' } : Number.isFinite(Number(text)) ? { kind: 'set', value: Number(text) } : undefined),
  }),
  SettingsForm: (props) =>
    React.createElement(
      'div',
      { className: 'stub-settings-form', 'data-available': String(props.state.available) },
      props.children,
      React.createElement('button', { type: 'button', onClick: props.onSave }, props.labels.save),
      React.createElement('button', { type: 'button', onClick: props.onDiscard }, props.labels.readOnly),
    ),
  SettingsValueField: (props) => {
    const open = openedHelp.has(props.id)
    const message = props.invalid ? props.invalidLabel : props.hint
    return React.createElement(
      'div',
      { className: 'stub-settings-field' },
      React.createElement('label', { htmlFor: props.id }, props.label),
      props.help === undefined
        ? null
        : React.createElement(
            'button',
            {
              type: 'button',
              className: 'stub-settings-help-button',
              'aria-label': props.help.label,
              'aria-expanded': String(open === true),
              onClick: () => openedHelp.add(props.id),
            },
            props.help.label,
          ),
      React.createElement('input', { id: props.id, value: props.text, disabled: props.disabled, onChange: (event) => props.onEdit(event.target.value) }),
      message === undefined ? null : React.createElement('span', null, message),
      props.help !== undefined && open ? React.createElement('div', { className: 'stub-settings-help' }, props.help.content) : null,
    )
  },
  Tag: (props) => React.createElement('span', { className: 'stub-settings-tag' }, props.children),
  IconInfoOutlineRegular: (props) => React.createElement('span', { className: 'stub-icon-info', 'aria-hidden': true, 'data-size': props.size }, 'i'),
  Switch: (props) =>
    React.createElement('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': String(props.checked === true),
      'aria-label': props.label,
      disabled: props.disabled,
      onClick: () => props.onChange(props.checked !== true),
    }),
}

globalThis.require = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
  throw new Error(`unexpected require(${name})`)
}

/** Timer callbacks the panel scheduled. */
let timers = []

/**
 * Let every pending microtask and scheduled timer run.
 * @returns {Promise<void>} nothing once quiet.
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
 * Let a freshly fetched value reach the tree, then redraw once.
 *
 * @param {object} view - the current render.
 * @returns {Promise<object>} the refreshed render.
 */
async function settle(view) {
  await drain()
  return view.refresh()
}

/** Host calls in flight, so the settle loop can await them. */
const pending = new Set()

/** Every request the panel made. */
const requests = []

/** The fake workspace the panel browses. */
const WORKSPACE = '/home/me/project'

/**
 * Whether a repository path lies inside one workspace root, the way the Host's
 * fence decides it.
 *
 * @param {string} root - the workspace root.
 * @param {string} path - the repository path.
 * @returns {boolean} whether the path is inside the root.
 */
function isInside(root, path) {
  const foldedRoot = root.replace(/[\\/]+$/, '')
  return path === foldedRoot || path.startsWith(`${foldedRoot}/`) || path.startsWith(`${foldedRoot}\\`)
}

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  requests.push(body)
  // Discovery really is the slow call — it walks the tree and spawns git per
  // repository — while a refused path is answered at once. Holding the answer
  // back by a few microtasks reproduces that ordering, which is what makes a
  // stale pairing visible as a flash instead of a silent no-op.
  if (body.op === 'repos') for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
  if (staleHost && NEWER_OPERATIONS.includes(body.op)) {
    return { status: 200, json: async () => ({ ok: false, error: `unknown operation "${body.op}"` }) }
  }
  // The real Host refuses a repository path that its workspace root does not
  // contain, so the harness must refuse it too — that refusal flashing during a
  // workspace switch is exactly what a stale pairing produces.
  if (typeof body.args?.path === 'string' && typeof body.args?.workspaceRoot === 'string' && !isInside(body.args.workspaceRoot, body.args.path)) {
    return { status: 200, json: async () => ({ ok: false, error: 'the path is outside the workspace root' }) }
  }
  const answer = answerFor(body)
  return { status: 200, json: async () => ({ ok: true, data: answer }) }
}

/**
 * Wrap a Host call so the harness can await every call the panel triggered.
 *
 * @param {RequestInfo} url - request URL.
 * @param {RequestInit} init - request inputs.
 * @returns {Promise<object>} the response.
 */
function trackedFetch(url, init) {
  const answer = globalThis.fetch(url, init)
  const tracked = answer.finally(() => pending.delete(tracked))
  pending.add(tracked)
  return tracked
}

/** The depth the fake Host currently has stored. */
let serverDepth = 3

/** The whole-file diff switch the fake Host currently has stored. */
let serverWholeFile = false

/** Whether the fake Host answers like a build that predates the newest operations. */
let staleHost = false

/** The operations a Host build without the newest additions does not know. */
const NEWER_OPERATIONS = ['commitFiles', 'discoveryDepth']

/**
 * Answer one Host operation.
 * @param {object} request - the posted envelope.
 * @returns {object} the payload.
 */
function answerFor(request) {
  if (request.op === 'repos') {
    // Discovery answers for the root it was asked about, so every repository a
    // later call names really lies inside the workspace in force.
    const root = typeof request.args?.workspaceRoot === 'string' && request.args.workspaceRoot !== '' ? request.args.workspaceRoot : WORKSPACE
    return {
      workspaceRoot: root,
      // A Host build that predates the newest operations reports no depth and
      // no whole-file switch.
      ...(staleHost ? {} : { discoveryDepth: serverDepth, wholeFileDiff: serverWholeFile }),
      repositories: [
        { path: `${root}/app`, name: 'app', relative: 'app', isSubmodule: false },
        { path: `${root}/libsource`, name: 'libsource', relative: 'libsource', isSubmodule: false },
        { path: `${root}/app/vendor/lib`, name: 'lib', relative: 'app/vendor/lib', isSubmodule: true },
      ],
    }
  }
  if (request.op === 'state') {
    return {
      root: `${WORKSPACE}/app`,
      name: 'app',
      branch: 'main',
      detached: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      remoteNames: ['origin'],
      branches: [
        { name: 'main', current: true, upstream: 'origin/main', track: '[ahead 2]', subject: 'initial', timestamp: 1, remote: false },
        { name: 'fix/rename-docs', current: false, upstream: null, track: null, subject: 'rename', timestamp: 1, remote: false },
        { name: 'topic', current: false, upstream: null, track: null, subject: 'work', timestamp: 1, remote: false },
      ],
      remotes: [{ name: 'origin/main', current: false, upstream: null, track: null, subject: 'initial', timestamp: 1, remote: true }],
      submodules: [{ path: 'vendor/lib', head: 'abcdef0123456789', describe: '', state: 'uninitialized' }],
      files: [
        { path: 'src/index.ts', from: null, status: 'M', added: 4, removed: 2, binary: false, staged: false, untracked: false },
        { path: 'docs/old.md', from: 'docs/new.md', status: 'R', added: 0, removed: 0, binary: false, staged: true, untracked: false },
        { path: 'fresh.txt', from: null, status: '?', added: 0, removed: 0, binary: false, staged: false, untracked: true },
      ],
    }
  }
  if (request.op === 'log') {
    return {
      commits: [
        {
          hash: 'a'.repeat(40),
          short: 'aaaaaaaa',
          author: 'Ada Lovelace',
          email: 'ada@example.com',
          timestamp: 1700000000,
          parents: ['b'.repeat(40)],
          refs: ['HEAD -> main'],
          subject: 'feat: greet the world',
          body: 'A longer explanation\nof the change.',
          // A Host build that predates `commitFiles` reports the file stats here.
          files: [
            { added: 3, removed: 1, path: 'src/index.ts' },
            { added: null, removed: null, path: 'assets/logo.png' },
          ],
        },
        { hash: 'b'.repeat(40), short: 'bbbbbbbb', author: 'Bob', email: 'bob@example.com', timestamp: 1690000000, parents: [], refs: [], subject: 'chore: scaffold', body: '' },
      ],
    }
  }
  if (request.op === 'commitFiles') {
    return {
      commit: request.args?.commit,
      parent: request.args?.commit === 'a'.repeat(40) ? 'b'.repeat(40) : null,
      files: request.args?.commit === 'a'.repeat(40)
        ? [
            { added: 3, removed: 1, path: 'src/index.ts', binary: false },
            { added: null, removed: null, path: 'assets/logo.png', binary: true },
          ]
        : [{ added: 1, removed: 0, path: 'README.md', binary: false }],
    }
  }
  if (request.op === 'discoveryDepth') {
    serverDepth = Number(request.args?.value)
    return { discoveryDepth: serverDepth, persisted: true }
  }
  if (request.op === 'diff') {
    // An older Host ignores the commit argument and answers with the worktree
    // diff, which is empty for a file that only the commit touched.
    if (staleHost && typeof request.args?.commit === 'string') return { diff: '', untracked: false }
    if (request.args?.file === 'assets/logo.png') return { diff: 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files a/assets/logo.png and b/assets/logo.png differ\n', untracked: false }
    return { diff: 'diff --git a/src/index.ts b/src/index.ts\nindex 111..222 100644\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,2 +1,3 @@\n-old line\n+new line\n+another\n', untracked: false }
  }
  return {}
}

// The page installs its module loader before any bundle runs, so the harness does
// the same: `client.js` and every chunk it asks for go through the contract the
// browser module system enforces (see test/module-loader.mjs).
/** The parser the page shipped with, captured before the repair can replace it. */
const nativeUrl = globalThis.URL
const moduleLoader = createModuleLoader({
  packageDir: join(here, '..', 'src'),
  packageId: 'GitPanel',
  require: globalThis.require,
  evaluate: (source) => new Function('window', 'require', 'fetch', source)(globalThis.window, moduleLoader.require, trackedFetch),
})
globalThis.window.__ModuleLoader__ = moduleLoader.moduleLoader

console.log('\nmodule face')
const clientModule = moduleLoader.loadEntry()
// A wrong `id` cannot even register (the loader rejects it the way the module
// system does), so this asserts the entry really arrived under the package name.
check(moduleLoader.registered().includes('client.js'), 'the bundle registers its entry factory through the module loader', moduleLoader.registered())
check(clientModule?.inject?.includes('slots'), 'it injects the slot registry')
check(clientModule?.inject?.includes('sidebarRightTabs'), 'it injects the tab-type registry')
check(clientModule?.inject?.includes('layout'), 'it injects the layout service')
check(clientModule?.inject?.includes('configForms'), 'it injects the shared configuration forms')
check(typeof clientModule?.apply === 'function', 'the module exports apply')

/** Everything the fake client context captured. */
const captured = { main: [], panels: [], types: [], bodies: [], titles: [], bundleConfigs: [] }

/** Main-panel ids the fake layout service was asked to select. */
const selectedPanels = []

/** While true the fake layout service refuses the transition, as it does before the key is committed. */
let refusePanels = false

/** While true the fake tab close refuses, standing in for a record with no committed occurrence. */
let failClose = false

/** The settings document the fake `configForms` service serves. */
const settingsDocument = { status: 'ready', value: { discoveryDepth: 3, filePreviewFix: true }, base: {}, user: {}, writable: true, revision: 1 }

/** The composition layer the fake Host resolves the document over: this plugin's schema defaults. */
const settingsBase = { discoveryDepth: 3, filePreviewFix: true }

/** The user layer the fake Host holds: only what a save wrote. */
const settingsUser = {}

/** Every write the settings card staged, in order. */
const settingsWrites = []

/** The one form controller per namespace the service hands out, as the real one does. */
const settingsForms = {}

/** Snapshot listeners the service notified, one per consumer that subscribed. */
const settingsListeners = new Set()

/** The `configForms` service stand-in: one namespace, served while its status says so. */
const configFormsStub = {
  // Real deployments cache one controller per namespace, so both consumers —
  // the panel's own settings watch and the Plugins page card — must observe the
  // same object here too; a fresh one per call would hide the live edit path.
  get: (ns) => {
    settingsForms[ns] ??= {
      getSnapshot: () => settingsDocument,
      subscribe: (listener) => {
        settingsListeners.add(listener)
        return () => settingsListeners.delete(listener)
      },
      mutate: async (ops, revision) => {
        settingsWrites.push({ ns, ops, revision })
        for (const op of ops) {
          if (op.op === 'set') {
            settingsUser[op.path[0]] = op.value
          } else {
            delete settingsUser[op.path[0]]
          }
        }
        // A clear lets the field re-inherit the composition default, which is
        // where `filePreviewFix` gets its `true` from — so the resolved section
        // must be recomputed from the layers, not patched in place.
        const resolved = { ...settingsBase, ...settingsUser }
        for (const [key, value] of Object.entries(resolved)) if (value === undefined) delete resolved[key]
        settingsDocument.value = resolved
        settingsDocument.user = { ...settingsUser }
        settingsDocument.revision = (settingsDocument.revision ?? 0) + 1
        for (const listener of settingsListeners) listener()
        return true
      },
    }
    return settingsForms[ns]
  },
  whileServed: (namespaces, register) => {
    if (namespaces.includes(settingsDocument.ns ?? 'GitPanel')) return register()
    return () => {}
  },
}

/** The locale service stand-in: captures registered dictionaries, reads one current language. */
const localeState = { current: 'en', registered: [], ns: null }
const localeStub = {
  register: (ns, dicts) => {
    localeState.registered.push({ ns, dicts })
    localeState.ns = { ns, dicts }
    return () => {}
  },
  bind: () => (key) => localeState.ns?.dicts?.[localeState.current]?.[key] ?? key,
}

/** Tab ids the fake sidebar controller was asked to close. */
const closedTabs = []

await clientModule.apply({
  effect: (callback) => {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  locale: localeStub,
  layout: {
    selectPanel: (panelId) => {
      if (refusePanels) throw new Error('the git panel is not committed yet')
      selectedPanels.push(panelId)
    },
  },
  sidebarRightTabs: { register: (definition) => { captured.types.push(definition); return () => {} } },
  sidebarRight: {
    isExpanded: () => true,
    toggleExpanded: () => {},
    close: (tabId) => { closedTabs.push(tabId) },
  },
  configForms: configFormsStub,
  slots: {
    inject: (name, callback) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    register: (options, component) => {
      if (options.name === 'main') captured.main.push({ options, component })
      if (options.name === 'sidebar.panellist') captured.panels.push({ options, component })
      if (options.name === 'sidebar.right.pane.tab') captured.bodies.push({ options, component })
      if (options.name === 'sidebar.right.pane.tab.title') captured.titles.push({ options, component })
      if (options.name === 'plugins.bundle.config') captured.bundleConfigs.push({ options, component })
      return () => {}
    },
  },
})

console.log('\nchunk graph')
// Every package-local chunk has to be requested by the entry and register itself
// under the package name: a file nobody loads is dead code, and one that registers
// late or under another owner would surface only as a blank seat in the app.
const chunkFiles = readdirSync(join(here, '..', 'src')).filter((name) => /^client\..+\.js$/.test(name)).sort()
const requestedChunks = moduleLoader.registered().filter((key) => key !== 'client.js').sort()
check(chunkFiles.length > 0, 'the browser half is split into chunks', chunkFiles)
check(
  chunkFiles.join(' ') === requestedChunks.join(' '),
  'every chunk file is requested by the entry and registers itself',
  { files: chunkFiles, registered: requestedChunks },
)

console.log('\nresource addresses')
/** The parser in force after the plugin applied, when the repair is on. */
const patchedUrl = globalThis.URL
check(typeof clientModule?.auditResourceAddress === 'function', 'the module exposes the address reader', Object.keys(clientModule ?? {}))
check(clientModule?.auditResourceAddress('dsh-resource://file/x') === 'file', 'a file address names the file protocol', clientModule?.auditResourceAddress('dsh-resource://file/x'))
check(clientModule?.auditResourceAddress('dsh-resource://file/session/s1/home/me/a.md') === 'file', 'a session-scoped file address names the file protocol')
check(clientModule?.auditResourceAddress('DSH-RESOURCE://FILE/x') === 'file', 'the scheme and host are compared case-insensitively', clientModule?.auditResourceAddress('DSH-RESOURCE://FILE/x'))
check(clientModule?.auditResourceAddress('dsh-resource://plan/session/s1/call') === 'plan', 'another protocol is read the same way')
check(clientModule?.auditResourceAddress('dsh-resource://file?q=1') === 'file', 'a query ends the host', clientModule?.auditResourceAddress('dsh-resource://file?q=1'))
check(clientModule?.auditResourceAddress('dsh-resource://file#frag') === 'file', 'a fragment ends the host', clientModule?.auditResourceAddress('dsh-resource://file#frag'))
check(clientModule?.auditResourceAddress('dsh-resource://') === undefined, 'an address with no host names no protocol', clientModule?.auditResourceAddress('dsh-resource://'))
check(clientModule?.auditResourceAddress('dsh-resource:///x') === undefined, 'an empty authority names no protocol', clientModule?.auditResourceAddress('dsh-resource:///x'))
check(clientModule?.auditResourceAddress('sidebar://guide') === undefined, 'another scheme names no resource', clientModule?.auditResourceAddress('sidebar://guide'))
check(clientModule?.auditResourceAddress(undefined) === undefined && clientModule?.auditResourceAddress(7) === undefined, 'a non-string address names no resource')
check(patchedUrl !== nativeUrl, 'the browser half replaces the URL parser so resource addresses carry a host', patchedUrl?.name)
// Chromium reports no host for this address; the repair is what the preview
// needs, and Node's parser already agrees with the repaired answer.
check(new globalThis.URL('dsh-resource://file/x').hostname === 'file', 'the patched parser reports the resource host', new globalThis.URL('dsh-resource://file/x').hostname)
check(new globalThis.URL('dsh-resource://FILE/x').hostname === 'file', 'the patched parser lower-cases the host', new globalThis.URL('dsh-resource://FILE/x').hostname)
check(new globalThis.URL('dsh-resource://file/x').protocol === 'dsh-resource:', 'the patched parser keeps the scheme')
check(new globalThis.URL('dsh-resource://file/session/s1/a.md').pathname === '/session/s1/a.md', 'the parsed address still carries its path', new globalThis.URL('dsh-resource://file/session/s1/a.md').pathname)
check(new globalThis.URL('dsh-resource://file/x').href === 'dsh-resource://file/x', 'the parsed address still stringifies to what came in', String(new globalThis.URL('dsh-resource://file/x')))
check(Object.prototype.toString.call(new globalThis.URL('dsh-resource://file/x')) === '[object URL]', 'the parsed address still reports itself as a URL')
check(new globalThis.URL('https://example.com/x').hostname === 'example.com', 'every other address is untouched', new globalThis.URL('https://example.com/x').hostname)
check(new globalThis.URL('https://example.com/x') instanceof nativeUrl, 'an ordinary address is still a native URL')
check(new globalThis.URL('/x', 'https://example.com/a/b').href === 'https://example.com/x', 'the base argument still resolves', new globalThis.URL('/x', 'https://example.com/a/b').href)
// The rest of the Web client reaches URL statics through this same global —
// blob URLs are how attachments and document renderers carry their bytes — so
// the wrapper must leave every one of them reachable.
check(typeof globalThis.URL.createObjectURL === 'function' && typeof globalThis.URL.revokeObjectURL === 'function', 'the URL statics the client uses survive the wrapper')
check(typeof globalThis.URL.parse !== 'function' || globalThis.URL.parse('https://example.com/x').href === 'https://example.com/x', 'a static address parser still answers for an ordinary address')
let unsupportedAddressFailed = false
try {
  new globalThis.URL('not a url')
} catch {
  unsupportedAddressFailed = true
}
check(unsupportedAddressFailed, 'an address the parser rejects still throws')

console.log('\nregistrations')
check(captured.main.length === 1, 'a main panel is registered', captured.main.length)
check(captured.main[0]?.options?.key === 'git', 'the main panel key is git', captured.main[0]?.options?.key)
check(captured.panels.length === 1, 'a sidebar panel entry is registered', captured.panels.length)
check(captured.panels[0]?.options?.id === captured.main[0]?.options?.key, 'the sidebar entry id matches the main panel key')
check(captured.panels[0]?.options?.label?.() === 'Git', 'the sidebar entry is labelled Git', captured.panels[0]?.options?.label?.())
check(typeof captured.panels[0]?.component === 'function', 'the sidebar entry renders an icon')
check(captured.types.length === 1 && captured.types[0]?.kind === 'git', 'the right-Sidebar tab type is registered')
check(captured.bodies.length === 1, 'the right-Sidebar launcher body is registered', captured.bodies.length)
check(captured.titles.length === 1, 'the right-Sidebar chip title is registered', captured.titles.length)

console.log('\ni18n')
check(localeState.registered.length === 1, 'the dictionaries are registered once', localeState.registered.length)
check(localeState.registered[0]?.ns === 'gitPanel', 'the locale namespace is gitPanel', localeState.registered[0]?.ns)
check(localeState.ns?.dicts?.en?.launcherHint === 'Branches, commits, changes and remotes', 'the English guide copy is registered')
check(localeState.ns?.dicts?.zh?.launcherHint === '分支、提交、改动与远程', 'the Chinese guide copy is registered')
check(localeState.ns?.dicts?.en?.['settings.save'] === 'Save' && localeState.ns?.dicts?.zh?.['settings.save'] === '保存', 'the settings form copy is registered in both languages')
check(localeState.ns?.dicts?.en?.['diff.before'] === 'Before' && localeState.ns?.dicts?.zh?.['diff.before'] === '修改前', 'the side-by-side headings are registered in both languages')
check(
  Object.keys(localeState.ns?.dicts?.en ?? {}).every((key) => Object.hasOwn(localeState.ns?.dicts?.zh ?? {}, key)) &&
    Object.keys(localeState.ns?.dicts?.zh ?? {}).every((key) => Object.hasOwn(localeState.ns?.dicts?.en ?? {}, key)),
  'both dictionaries carry the same keys',
  Object.keys(localeState.ns?.dicts?.en ?? {}).length,
)
check(captured.types[0]?.guide?.[0]?.description() === 'Branches, commits, changes and remotes', 'the guide description reads English by default', captured.types[0]?.guide?.[0]?.description())
localeState.current = 'zh'
check(captured.types[0]?.guide?.[0]?.description() === '分支、提交、改动与远程', 'the guide description follows the locale', captured.types[0]?.guide?.[0]?.description())
check(captured.types[0]?.guide?.[0]?.title() === 'Git', 'the guide title follows the locale')
check(captured.panels[0]?.options?.label?.() === 'Git', 'the panel label follows the locale', captured.panels[0]?.options?.label?.())
localeState.current = 'en'

const GitPanel = captured.main[0]?.component

// The launcher registers through a wrapper; it is a different component identity.
const Launcher = captured.bodies[0]?.component

// ---- rendering --------------------------------------------------------------
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
 * Collect rendered text.
 * @param {object} node - element tree.
 * @param {Array<string>} bucket - accumulator.
 * @returns {Array<string>} the text.
 */
function collectText(node, bucket = []) {
  if (typeof node === 'string' || typeof node === 'number') {
    bucket.push(String(node))
    return bucket
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, bucket)
    return bucket
  }
  if (node !== null && typeof node === 'object') for (const child of node.children ?? []) collectText(child, bucket)
  return bucket
}

/**
 * Find the first element satisfying a predicate.
 * @param {object} node - element tree.
 * @param {Function} predicate - matcher.
 * @returns {object|undefined} the element.
 */
function find(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node.props !== undefined && predicate(node)) return node
  for (const child of node.children ?? []) {
    const hit = find(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * Find every element satisfying a predicate.
 * @param {object} node - element tree.
 * @param {Function} predicate - matcher.
 * @param {Array<object>} bucket - accumulator.
 * @returns {Array<object>} the matches.
 */
function findAll(node, predicate, bucket = []) {
  if (node === null || node === undefined || typeof node !== 'object') return bucket
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, bucket)
    return bucket
  }
  if (node.props !== undefined && predicate(node)) bucket.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, bucket)
  return bucket
}

/**
 * Find one settings switch by the label it announces.
 *
 * @param {object} tree - element tree.
 * @param {string} label - the switch's accessible label.
 * @returns {object|undefined} the switch element.
 */
function switchByLabel(tree, label) {
  return find(tree, (element) => element.props?.role === 'switch' && element.props?.['aria-label'] === label)
}

/**
 * Render a component with the executing-hook harness.
 * @param {Function} component - the component.
 * @param {object} props - its props.
 * @returns {Promise<object>} the settled render.
 */
async function render(component, props) {
  const instance = { hooks: [], cursor: 0, dirty: true, tree: null, expanded: null, children: new Map() }
  const outerRoot = rootInstance
  rootInstance = instance
  const outerOwner = currentOwner
  const pass = async () => {
    instance.dirty = false
    instance.cursor = 0
    currentOwner = instance
    try {
      instance.tree = component(props)
    } finally {
      currentOwner = outerOwner
    }
    // Expand with the persistent child cache, so nested components' hooks live
    // here and their effects run in this pass.
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
  rootInstance = outerRoot
  const draw = () => {
    const next = instance.expanded ?? expand(instance.tree, instance)
    return { tree: next, text: () => collectText(next) }
  }
  const finished = () => {
    rootInstance = outerRoot
    return draw()
  }
  /**
   * Re-render after a captured handler changed state.
   * @returns {Promise<object>} the new render.
   */
  const refresh = async () => {
    rootInstance = instance
    instance.dirty = true
    for (let round = 0; round < 40; round += 1) {
      if (!instance.dirty) break
      await pass()
    }
    rootInstance = outerRoot
    return { ...draw(), refresh }
  }
  return { ...finished(), refresh }
}

console.log('\nfull page with no workspace')
requests.length = 0
const empty = await render(GitPanel, { useWorkspaces: () => [], useSessions: () => undefined })
check(empty.text().some((text) => text.includes('No workspace')), 'the empty state explains itself', empty.text().slice(0, 12))
check(empty.text().includes('Push'), 'the toolbar still renders', empty.text().slice(0, 12))

console.log('\nrender: localized state')
localeState.current = 'zh'
const zhPanel = await render(GitPanel, { useWorkspaces: () => [], useSessions: () => undefined })
check(zhPanel.text().some((text) => text.includes('尚未打开任何工作区')), 'the empty state renders in Chinese', zhPanel.text().slice(0, 12))
check(zhPanel.text().includes('推送'), 'the toolbar renders Chinese copy', zhPanel.text().slice(0, 14))
localeState.current = 'en'

console.log('\nfull page over a workspace')
requests.length = 0
/** The sessions snapshot the framework would deliver for the current Session. */
const SESSIONS = { ids: ['s1'], byId: { s1: { cwd: WORKSPACE, retainedBy: { mainView: 1 } } } }
let view = await render(GitPanel, {
  useWorkspaces: () => [{ path: WORKSPACE, title: 'project' }],
  useSessions: (selector) => selector(SESSIONS),
})
const text = view.text()
check(requests.some((entry) => entry.op === 'repos'), 'the panel discovers repositories', requests.map((entry) => entry.op))
check(requests.some((entry) => entry.op === 'state'), 'the panel reads the selected repository')
check(requests.some((entry) => entry.op === 'log'), 'the panel reads the history')
check(text.includes('Branches'), 'the branch column renders', text.slice(0, 20))
check(text.includes('Commits'), 'the commit column renders')
check(text.includes('Working tree'), 'the changes pane renders')
check(text.includes('main'), 'the current branch renders')
check(text.includes('fix/rename-docs'), 'the local branches render')
check(text.includes('feat: greet the world'), 'the commit subjects render')
check(text.includes('index.ts'), 'the changed paths render')
check(text.includes('Commit & push'), 'the commit controls render')
check(text.includes('Fetch'), 'the toolbar offers a fetch')
check(text.includes('Pull'), 'the toolbar offers a pull')
check(text.includes('vendor/lib'), 'the submodule is listed')
check(text.filter((entry) => entry === 'app').length >= 1, 'the repository name renders in the toolbar')

console.log('\ntoolbar')
const toolbarSelects = findAll(view.tree, (element) => element.type === 'select' && typeof element.props?.className === 'string' && element.props.className.includes('git-panel-select'))
check(toolbarSelects.length >= 2, 'the workspace and repository fields always render', toolbarSelects.length)
const workspaceSelect = toolbarSelects.find((element) => collectText(element).includes('project'))
check(workspaceSelect !== undefined, 'the workspace field shows the workspace name', collectText(toolbarSelects[0]))
const workspaceOption = find(workspaceSelect, (element) => element.type === 'option')
check(workspaceOption?.props?.title === WORKSPACE, 'the workspace option keeps the full path as its title', workspaceOption?.props)
const repositorySelect = toolbarSelects.find((element) => collectText(element).includes('app'))
check(repositorySelect !== undefined, 'the repository field shows the repository', collectText(toolbarSelects[1] ?? {}))
const branchChip = find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-branch-chip'))
check(branchChip !== undefined && collectText(branchChip).includes('main'), 'the branch chip names the current branch')
const styleNode = find(view.tree, (element) => element.type === 'style')
const css = Array.isArray(styleNode?.children) ? styleNode.children.flat().join('') : ''
const primaryRule = /\.git-panel-btn-primary\{[^}]*\}/.exec(css)?.[0] ?? ''
check(primaryRule.includes('color-mix') && !primaryRule.includes('#fff'), 'the primary button stays readable in the dark palette', primaryRule)
const tagRule = /\.git-panel-tag\{[^}]*\}/.exec(css)?.[0] ?? ''
check(tagRule.includes('color-mix') && !tagRule.includes('#fff'), 'the HEAD tag stays readable in the dark palette', tagRule)
const modalRule = /\.git-panel-modal\{position:fixed[^}]*\}/.exec(css)?.[0] ?? ''
check(modalRule.includes('position:fixed'), 'the diff modal renders centered over the panel', modalRule.slice(0, 48))
check(!view.text().includes('Back to chat'), 'the back-to-chat button is gone from the toolbar')

console.log('\nPlugins page settings card')
check(captured.bundleConfigs.length === 1, 'one bundle configuration entry is registered', captured.bundleConfigs.length)
check(captured.bundleConfigs[0]?.options?.key === 'GitPanel', 'the entry is keyed by this bundle package name', captured.bundleConfigs[0]?.options?.key)
check(captured.bundleConfigs[0]?.options?.name === 'plugins.bundle.config', 'the entry lives on the bundle page, not in the official group', captured.bundleConfigs[0]?.options?.name)
const cardComponent = captured.bundleConfigs[0]?.component
const cardFace = captured.bundleConfigs[0]?.options?.inject?.() ?? {}
// The framework binds each injected hook store as a selector hook of the same
// name, prefixed with `use`; mirror that binding here.
const cardStore = cardFace.hooks?.gitSettings
const cardProps = { ...cardFace, useGitSettings: (selector) => selector(cardStore.getSnapshot()), t: localeStub.bind() }
check(typeof cardStore?.getSnapshot === 'function', 'the card injects one form snapshot store', Object.keys(cardFace.hooks ?? {}))
check(typeof cardProps.useGitSettings === 'function' && typeof cardProps.useGitSettings((snapshot) => snapshot.writable) === 'boolean', 'the injected hook answers a selector', cardProps.useGitSettings((snapshot) => snapshot))
check(typeof cardFace.edit === 'function' && typeof cardFace.save === 'function' && typeof cardFace.resetField === 'function', 'the card receives the form actions', Object.keys(cardFace))
localeState.current = 'en'
const card = await render(cardComponent, { ...cardProps, view: 'page' })
const depthInput = find(card.tree, (element) => element.props?.id === 'GitPanel-discovery-depth')
check(depthInput !== undefined, 'the card renders the depth field', collectText(card.tree).slice(0, 6))
const cardStyle = find(card.tree, (element) => element.type === 'style')
const cardCss = Array.isArray(cardStyle?.children) ? cardStyle.children.flat().join('') : ''
check(
  cardCss.includes('.git-panel-config-toggle-row{') && cardCss.includes('.git-panel-config-help{') && cardCss.includes('.git-panel-config-help-button{'),
  'the card carries the stylesheet its own classes need',
  cardCss.length,
)
check(depthInput?.props?.value === '3', 'the field shows the configured value', depthInput?.props?.value)
const helpButton = find(card.tree, (element) => element.props?.className === 'stub-settings-help-button')
check(helpButton?.props?.['aria-label'] === 'About the discovery depth', 'the depth field names its explanation button', helpButton?.props)
check(!collectText(card.tree).some((entry) => entry.includes('Directory levels scanned')), 'the explanation stays closed until it is asked for', collectText(card.tree).slice(0, 8))
helpButton?.props?.onClick?.()
const helped = await settle(card)
check(
  collectText(helped.tree).some((entry) => entry.includes('Directory levels scanned below the workspace root')) &&
    collectText(helped.tree).some((entry) => entry.includes('clamped to 1-8')),
  'the explanation button reveals the depth rules',
  collectText(helped.tree).slice(-6),
)
check(
  collectText(card.tree).includes('Repository discovery') && collectText(card.tree).includes('Diff display'),
  'the card groups its settings under headings',
  collectText(card.tree).slice(0, 8),
)
depthInput?.props?.onChange?.({ target: { value: '6' } })
const staged = await settle(card)
const saveButton = find(staged.tree, (element) => element.type === 'button' && collectText(element).includes('Save'))
check(saveButton !== undefined, 'the card offers a save', collectText(staged.tree).slice(0, 8))
settingsWrites.length = 0
saveButton?.props?.onClick?.()
await drain()
check(
  settingsWrites.length === 1 && settingsWrites[0].ns === 'GitPanel' && settingsWrites[0].ops[0]?.op === 'set' && settingsWrites[0].ops[0]?.path?.[0] === 'discoveryDepth' && settingsWrites[0].ops[0]?.value === 6,
  'saving writes the staged depth to this plugin namespace',
  settingsWrites,
)
check(settingsWrites[0]?.revision === 1, 'the write is fenced by the revision it was staged from', settingsWrites[0]?.revision)
check(
  findAll(staged.tree, (element) => element.type === 'input' && element.props?.id === 'GitPanel-discovery-depth').length === 1,
  'the panel itself no longer carries a depth control',
  findAll(view.tree, (element) => element.type === 'select').map((element) => collectText(element)),
)
const wholeToggle = switchByLabel(staged.tree, 'Whole-file diff')
check(wholeToggle !== undefined, 'the card renders the whole-file switch', collectText(staged.tree).slice(-4))
check(wholeToggle?.props?.['aria-checked'] === 'false', 'the whole-file switch starts off', wholeToggle?.props)
const toggleHelpButton = find(staged.tree, (element) => element.props?.['aria-controls'] === 'GitPanel-whole-file-help')
check(toggleHelpButton?.props?.['aria-label'] === 'About the whole-file diff', 'the switch row names its explanation button', toggleHelpButton?.props)
check(toggleHelpButton?.props?.['aria-controls'] === 'GitPanel-whole-file-help', 'the explanation button points at its region', toggleHelpButton?.props)
check(!collectText(staged.tree).some((entry) => entry.includes('Off: only the changed hunks')), 'the switch row explains nothing until it is asked to', collectText(staged.tree).slice(-4))
toggleHelpButton?.props?.onClick?.()
const helpShown = await settle(staged)
check(
  collectText(helpShown.tree).some((entry) => entry.includes('Off: only the changed hunks are shown.')) &&
    collectText(helpShown.tree).some((entry) => entry.includes('at most 3000 rows')),
  'the explanation button reveals the whole-file rules',
  collectText(helpShown.tree).slice(-6),
)
check(
  find(helpShown.tree, (element) => element.props?.id === 'GitPanel-whole-file-help')?.props?.role === 'region',
  'the revealed rules are a labelled region',
  collectText(helpShown.tree).slice(-6),
)
wholeToggle?.props?.onClick?.()
const toggled = await settle(helpShown)
const onToggle = switchByLabel(toggled.tree, 'Whole-file diff')
check(onToggle?.props?.['aria-checked'] === 'true', 'clicking the switch stages the on state', onToggle?.props)
check(collectText(toggled.tree).includes('modified'), 'a staged edit previews the override badge', collectText(toggled.tree).slice(-6))
settingsWrites.length = 0
find(toggled.tree, (element) => element.type === 'button' && collectText(element).includes('Save'))?.props?.onClick?.()
await drain()
check(
  settingsWrites.length === 1 && settingsWrites[0].ops[0]?.op === 'set' && settingsWrites[0].ops[0]?.path?.[0] === 'wholeFileDiff' && settingsWrites[0].ops[0]?.value === true,
  'saving writes the whole-file switch as a boolean',
  settingsWrites,
)
settingsWrites.length = 0
cardFace.resetField('wholeFileDiff')
const resetView = await settle(toggled)
const resetToggle = switchByLabel(resetView.tree, 'Whole-file diff')
check(resetToggle?.props?.['aria-checked'] === 'false', 'a cleared whole-file draft shows the inherited default', resetToggle?.props)
find(resetView.tree, (element) => element.type === 'button' && collectText(element).includes('Save'))?.props?.onClick?.()
await drain()
check(
  settingsWrites.length === 1 && settingsWrites[0].ops[0]?.op === 'unset' && settingsWrites[0].ops[0]?.path?.[0] === 'wholeFileDiff',
  'resetting the whole-file switch clears the override',
  settingsWrites,
)

console.log('\nfile-preview repair setting')
const previewToggle = switchByLabel(resetView.tree, 'Repair file-preview addresses')
check(previewToggle !== undefined, 'the card renders the file-preview switch', collectText(resetView.tree).slice(-6))
check(previewToggle?.props?.['aria-checked'] === 'true', 'the repair starts on, as its default says', previewToggle?.props)
check(
  collectText(resetView.tree).includes('File preview'),
  'the repair is grouped under its own heading',
  collectText(resetView.tree).slice(0, 10),
)
const previewHelpButton = find(resetView.tree, (element) => element.props?.['aria-controls'] === 'GitPanel-file-preview-help')
check(previewHelpButton?.props?.['aria-label'] === 'About the file-preview repair', 'the repair row names its explanation button', previewHelpButton?.props)
check(!collectText(resetView.tree).some((entry) => entry.includes('protocolOf')), 'the repair explains nothing until it is asked to', collectText(resetView.tree).slice(-4))
previewHelpButton?.props?.onClick?.()
const previewHelpShown = await settle(resetView)
const previewHelpText = collectText(previewHelpShown.tree).join('\n')
check(
  previewHelpText.includes('protocolOf') && previewHelpText.includes('new URL(address).hostname') && previewHelpText.includes('discussions/6437'),
  'the explanation button names the upstream cause and links it',
  previewHelpText.slice(-400),
)
check(
  find(previewHelpShown.tree, (element) => element.props?.id === 'GitPanel-file-preview-help')?.props?.role === 'region',
  'the revealed repair rules are a labelled region',
  collectText(previewHelpShown.tree).slice(-8),
)
settingsWrites.length = 0
switchByLabel(previewHelpShown.tree, 'Repair file-preview addresses')?.props?.onClick?.()
await drain()
check(
  settingsWrites.length === 0,
  'turning the repair off stages the edit instead of writing it at once',
  settingsWrites,
)
const previewOn = await settle(previewHelpShown)
check(
  switchByLabel(previewOn.tree, 'Repair file-preview addresses')?.props?.['aria-checked'] === 'false',
  'the staged off state is what the switch shows',
  switchByLabel(previewOn.tree, 'Repair file-preview addresses')?.props,
)
settingsWrites.length = 0
find(previewOn.tree, (element) => element.type === 'button' && collectText(element).includes('Save'))?.props?.onClick?.()
await drain()
check(
  settingsWrites.length === 1 && settingsWrites[0].ns === 'GitPanel' && settingsWrites[0].ops[0]?.op === 'set' && settingsWrites[0].ops[0]?.path?.[0] === 'filePreviewFix' && settingsWrites[0].ops[0]?.value === false,
  'saving writes the repair switch as a boolean',
  settingsWrites,
)
// The panel plugin watches this same namespace, so the write the card just
// landed reaches the live repair too — the path a user actually takes.
check(
  globalThis.URL === nativeUrl,
  'a saved off value removes the repair from the running page',
  globalThis.URL === nativeUrl,
)
settingsWrites.length = 0
cardFace.edit('filePreviewFix', 'true')
find((await settle(previewOn)).tree, (element) => element.type === 'button' && collectText(element).includes('Save'))?.props?.onClick?.()
await drain()
check(
  globalThis.URL !== nativeUrl && new globalThis.URL('dsh-resource://file/x').hostname === 'file',
  'turning the repair back on restores it without a reload',
  settingsWrites,
)
cardFace.resetField('filePreviewFix')
const previewReset = await settle(previewOn)
settingsWrites.length = 0
find(previewReset.tree, (element) => element.type === 'button' && collectText(element).includes('Save'))?.props?.onClick?.()
await drain()
check(
  settingsWrites.length === 1 && settingsWrites[0].ops[0]?.op === 'unset' && settingsWrites[0].ops[0]?.path?.[0] === 'filePreviewFix',
  'resetting the repair switch clears the override, so its default returns',
  settingsWrites,
)
check(
  globalThis.URL !== nativeUrl && new globalThis.URL('dsh-resource://file/x').hostname === 'file',
  'a cleared repair override leaves the repair on, as the default says',
  globalThis.URL === nativeUrl,
)

const invalidCard = await render(cardComponent, { ...cardProps, view: 'page' })
const invalidInput = find(invalidCard.tree, (element) => element.props?.id === 'GitPanel-discovery-depth')
invalidInput?.props?.onChange?.({ target: { value: 'deep' } })
const invalidSettled = await settle(invalidCard)
settingsWrites.length = 0
find(invalidSettled.tree, (element) => element.type === 'button' && collectText(element).includes('Save'))?.props?.onClick?.()
await drain()
check(settingsWrites.length === 0, 'an unparsable draft blocks the save instead of writing garbage', settingsWrites)
check(collectText(invalidSettled.tree).some((entry) => entry.includes('whole number between 1 and 8')), 'the field says what it accepts', collectText(invalidSettled.tree).slice(-4))

console.log('\nworkspace from the current session')
requests.length = 0
const sessionView = await render(GitPanel, {
  useWorkspaces: () => [],
  useSessions: (selector) => selector({ ids: ['s9'], byId: { s9: { cwd: `${WORKSPACE}/app`, retainedBy: { mainView: 1 } } } }),
})
check(
  requests.some((entry) => entry.op === 'repos' && entry.args?.workspaceRoot === `${WORKSPACE}/app`),
  'the panel opens the current session directory as the workspace',
  requests.map((entry) => entry.args?.workspaceRoot),
)
check(sessionView.text().includes('app'), 'the session directory renders as the workspace', sessionView.text().slice(0, 20))

requests.length = 0
const listedSessionView = await render(GitPanel, {
  useWorkspaces: () => [{ path: `${WORKSPACE}/other`, title: 'other' }, { path: `${WORKSPACE}/app`, title: 'app' }],
  useSessions: (selector) => selector({ ids: ['s9'], byId: { s9: { cwd: `${WORKSPACE}/app`, retainedBy: { mainView: 1 } } } }),
})
check(
  requests.some((entry) => entry.op === 'repos' && entry.args?.workspaceRoot === `${WORKSPACE}/app`),
  'the current session workspace outranks the first workspace in the list',
  requests.map((entry) => entry.args?.workspaceRoot),
)
const listedSelect = find(listedSessionView.tree, (element) => element.type === 'select' && collectText(element).some((entry) => entry.includes('other')))
check(listedSelect?.props?.value === `${WORKSPACE}/app`, 'the workspace field shows the session workspace', listedSelect?.props?.value)

console.log('\nworkspace follows the conversation')
requests.length = 0
const sessionState = { current: { ids: ['s1'], byId: { s1: { cwd: `${WORKSPACE}/alpha`, retainedBy: { mainView: 1 } } } } }
const workspaceList = { current: [{ path: `${WORKSPACE}/alpha`, title: 'alpha' }, { path: `${WORKSPACE}/beta`, title: 'beta' }] }
const followView = await render(GitPanel, {
  useWorkspaces: () => workspaceList.current,
  useSessions: (selector) => selector(sessionState.current),
})
const betaSelect = find(followView.tree, (element) => element.type === 'select' && collectText(element).some((entry) => entry.includes('beta')))
const selectDump = findAll(followView.tree, (element) => element.type === 'select').map((element) => `${String(element.props?.value)}=>${JSON.stringify(collectText(element))}`)
check(betaSelect !== undefined, 'both workspaces are offered in the toolbar', selectDump.join(' | '))
betaSelect?.props?.onChange?.({ target: { value: `${WORKSPACE}/beta` } })
const pickedView = await settle(followView)
const pickedSelect = find(pickedView.tree, (element) => element.type === 'select' && typeof element.props?.value === 'string')
check(pickedSelect?.props?.value === `${WORKSPACE}/beta`, 'a manual pick switches the workspace within the session', pickedSelect?.props?.value)
sessionState.current = { ids: ['s2'], byId: { s2: { cwd: `${WORKSPACE}/alpha`, retainedBy: { mainView: 1 } } } }
const followBack = await settle(pickedView)
check(
  requests.some((entry) => entry.op === 'repos' && entry.args?.workspaceRoot === `${WORKSPACE}/alpha`),
  'switching conversations reselects that conversation workspace',
  requests.map((entry) => entry.args?.workspaceRoot),
)
const restoredSelect = find(followBack.tree, (element) => element.type === 'select' && typeof element.props?.value === 'string')
check(restoredSelect?.props?.value === `${WORKSPACE}/alpha`, 'the workspace select follows the conversation', restoredSelect?.props?.value)
check(
  requests
    .filter((entry) => typeof entry.args?.path === 'string')
    .every((entry) => isInside(entry.args.workspaceRoot, entry.args.path)),
  'switching workspaces never asks for another workspace repository',
  requests.filter((entry) => typeof entry.args?.path === 'string').map((entry) => `${entry.op} ${entry.args.workspaceRoot} + ${entry.args.path}`),
)
check(
  !followBack.text().some((entry) => entry.includes('outside the workspace root')),
  'no refusal flashes while switching workspaces',
  followBack.text().filter((entry) => entry.includes('workspace')),
)

console.log('\nworkspace from a session subdirectory')
requests.length = 0
const nestedView = await render(GitPanel, {
  useWorkspaces: () => [{ path: `${WORKSPACE}/proj`, title: 'proj' }],
  useSessions: (selector) => selector({ ids: ['s7'], byId: { s7: { cwd: `${WORKSPACE}/proj/src/lib`, retainedBy: { mainView: 1 } } } }),
})
check(
  requests.some((entry) => entry.op === 'repos' && entry.args?.workspaceRoot === `${WORKSPACE}/proj`),
  'a session opened in a workspace subdirectory selects that workspace',
  requests.map((entry) => entry.args?.workspaceRoot),
)

console.log('\nworking-tree diff')
requests.length = 0
const changeFileRow = find(
  view.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onClick === 'function' && collectText(element).includes('fresh.txt'),
)
check(changeFileRow !== undefined, 'a changed path row is clickable')
changeFileRow?.props?.onDoubleClick?.()
view = await settle(view)
check(requests.some((entry) => entry.op === 'diff'), 'double-clicking a changed path reads its diff', requests.map((entry) => entry.op))
const diffModal = find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-modal'))
check(diffModal !== undefined, 'the diff modal opens over the panel')
const diffText = collectText(diffModal)
check(diffText.includes('new line') && diffText.includes('old line'), 'the diff modal shows both sides of the change', diffText.slice(-20))
check(diffText.includes('working tree'), 'the modal names the working tree as the source', diffText.slice(0, 8))
const sideBySide = find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs'))
check(sideBySide !== undefined, 'the diff renders as two aligned columns')
const removedCells = findAll(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-del'))
const addedCells = findAll(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-add'))
check(removedCells.some((cell) => collectText(cell).includes('old line')), 'the old line sits in the left column', removedCells.map((cell) => collectText(cell)))
check(addedCells.some((cell) => collectText(cell).includes('new line')), 'the new line sits in the right column', addedCells.map((cell) => collectText(cell)))
const lineNumbers = findAll(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-no')).map((cell) => collectText(cell).join(''))
check(lineNumbers.join(',') === '1,1,,2', 'both columns carry line numbers, and a replaced pair shares the row', lineNumbers)
const compactNavItems = findAll(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-nav-item'))
check(compactNavItems.length >= 1, 'the compact diff lists its changes for jumping', compactNavItems.map((element) => collectText(element)))
const navSteps = findAll(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-nav-step'))
check(navSteps.length === 2 && typeof navSteps[1]?.props?.onClick === 'function', 'the change rail offers previous and next', navSteps.map((element) => collectText(element)))
const overviewMarks = findAll(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-mark'))
check(overviewMarks.length >= 1 && typeof overviewMarks[0]?.props?.onClick === 'function', 'the scroll overview marks each change and jumps to it', overviewMarks.map((element) => element.props?.style))
overviewMarks[0]?.props?.onClick?.({ stopPropagation: () => {} })
const overviewView = find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-overview-view'))
check(overviewView !== undefined, 'the scroll overview shows the visible range')
// One file at a time: picking another row swaps the modal content in place.
const indexRow = find(
  view.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onClick === 'function' && collectText(element).includes('index.ts'),
)
indexRow?.props?.onClick?.()
view = await settle(view)
const swappedTitle = find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-modal-title'))
check(swappedTitle !== undefined && collectText(swappedTitle).includes('index.ts'), 'the open modal follows the new selection', collectText(swappedTitle))
const modalClose = find(view.tree, (element) => element.type === 'button' && element.props?.title === 'Close')
check(modalClose !== undefined, 'the diff modal offers a close control')
modalClose?.props?.onClick?.()
view = await settle(view)
check(find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-modal')) === undefined, 'closing the modal returns to the panel')


console.log('\nHost half older than this panel')
staleHost = true
requests.length = 0
const staleView = await render(GitPanel, {
  useWorkspaces: () => [{ path: WORKSPACE, title: 'project' }],
  useSessions: (selector) => selector(SESSIONS),
})
check(
  staleView.text().some((entry) => entry.includes('newer than the running Host half')),
  'a Host that reports no depth is named as an older build before anything fails',
  staleView.text().filter((entry) => entry.length > 60),
)
const staleCommitRow = find(
  staleView.tree,
  (element) => typeof element.props?.onClick === 'function' && collectText(element).includes('feat: greet the world'),
)
staleCommitRow?.props?.onClick?.()
const staleSettled = await settle(staleView)
const staleText = staleSettled.text()
check(staleText.some((entry) => entry.includes('newer than the running Host half')), 'a Host that lacks the new operations is named as such', staleText.filter((entry) => entry.length > 60))
check(staleText.some((entry) => entry.includes('src/index.ts')), 'the file list falls back to the history page of an older Host', staleText.filter((entry) => entry.includes('index.ts')))
check(!staleText.some((entry) => entry.includes('unknown operation')), 'the raw Host refusal is not shown verbatim', staleText.filter((entry) => entry.includes('unknown')))
const staleAfter = staleSettled
const staleFileRow = findAll(
  staleAfter.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onDoubleClick === 'function',
).find((row) => collectText(row).includes('src/index.ts'))
check(staleFileRow !== undefined, 'a commit file row is reachable on an older Host')
staleFileRow?.props?.onDoubleClick?.()
const staleModal = await settle(staleAfter)
const staleModalBody = find(staleModal.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-modal'))
check(
  collectText(staleModalBody).some((entry) => entry.includes('newer than the running Host half')),
  'an empty commit diff on an older Host explains itself instead of reading as no change',
  collectText(staleModalBody).slice(-6),
)
staleHost = false
const recovered = await render(GitPanel, {
  useWorkspaces: () => [{ path: WORKSPACE, title: 'project' }],
  useSessions: (selector) => selector(SESSIONS),
})
check(!recovered.text().some((entry) => entry.includes('newer than the running Host half')), 'a current Host shows no warning')

console.log('\nbranch filter')
const filterInput = find(view.tree, (element) => element.props?.placeholder === 'Filter branches')
check(filterInput !== undefined, 'the branch filter input renders')
filterInput?.props?.onChange?.({ target: { value: 'rename' } })
view = await settle(view)
const filtered = view.text()
check(filtered.includes('fix/rename-docs'), 'the filter keeps a matching branch', filtered.slice(-14))
check(!filtered.includes('topic'), 'the filter drops a non-matching branch', filtered.filter((entry) => entry === 'topic'))

console.log('\ncommit selection')
requests.length = 0
const commitRow = find(view.tree, (element) => typeof element.props?.onClick === 'function' && collectText(element).includes('feat: greet the world'))
check(commitRow !== undefined, 'a commit row is clickable')
commitRow?.props?.onClick?.()
view = await settle(view)
const details = view.text()
check(details.includes('Ada Lovelace'), 'the selected commit author renders', details.slice(-20))
check(details.some((entry) => entry.includes('ada@example.com')), 'the selected commit e-mail renders', details.slice(-16))
check(details.some((entry) => entry.includes('2023-11-1')), 'the selected commit date renders', details.slice(-20))
check(details.includes('aaaaaaaa'), 'the selected commit hash renders')
check(details.some((entry) => entry.includes('A longer explanation')), 'the commit body renders', details.slice(-14))
check(
  requests.some((entry) => entry.op === 'commitFiles' && entry.args?.commit === 'a'.repeat(40)),
  'selecting a commit reads only that commit file list',
  requests.map((entry) => entry.op),
)
check(details.includes('assets/logo.png'), 'the commit file list renders')
check(details.includes('Files'), 'the file-list heading renders')

console.log('\ncommit file diff')
requests.length = 0
const fileRow = findAll(
  view.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onClick === 'function',
).find((row) => collectText(row).includes('assets/logo.png'))
check(fileRow !== undefined, 'a commit file row is clickable')
fileRow?.props?.onDoubleClick?.()
view = await settle(view)
check(requests.some((entry) => entry.op === 'diff' && entry.args?.commit === 'a'.repeat(40)), 'a commit file is diffed against its own commit', requests.map((entry) => entry.args?.commit))
const commitDiffModal = find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-modal'))
check(commitDiffModal !== undefined, 'the commit diff modal opens over the panel')
check(collectText(commitDiffModal).includes('commit aaaaaaaa'), 'the modal names the commit the diff belongs to', collectText(commitDiffModal).slice(0, 10))
check(collectText(commitDiffModal).some((entry) => entry.includes('Binary file')), 'a binary file says so instead of showing an empty diff', collectText(commitDiffModal).slice(-8))
const commitClose = find(view.tree, (element) => element.type === 'button' && element.props?.title === 'Close')
check(commitClose !== undefined, 'the commit diff modal offers a close control')
commitClose?.props?.onClick?.()
view = await settle(view)
check(
  find(view.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-modal')) === undefined,
  'closing the commit diff modal returns to the panel',
)

console.log('\nworking-tree diff after a commit selection')
requests.length = 0
const treeFileRow = find(
  view.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onDoubleClick === 'function' && collectText(element).includes('fresh.txt'),
)
check(treeFileRow !== undefined, 'a working-tree row is still reachable while a commit is selected')
treeFileRow?.props?.onDoubleClick?.()
view = await settle(view)
const treeDiff = requests.filter((entry) => entry.op === 'diff').pop()
check(treeDiff !== undefined && treeDiff.args?.commit === undefined, 'a working-tree file is diffed against the tree, not the selected commit', treeDiff?.args)
const treeModalClose = find(view.tree, (element) => element.type === 'button' && element.props?.title === 'Close')
treeModalClose?.props?.onClick?.()
view = await settle(view)

console.log('\ncontext menus')
view = await settle(view)
const branchRow = find(
  view.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onContextMenu === 'function' && collectText(element).includes('fix/rename-docs'),
)
check(branchRow !== undefined, 'a branch row carries a context menu')
branchRow?.props?.onContextMenu?.({ preventDefault: () => {}, clientX: 40, clientY: 40 })
view = await settle(view)
check(view.text().includes('Checkout fix/rename-docs'), 'the branch menu offers a checkout', view.text().slice(-24))
check(view.text().includes('Delete branch'), 'the branch menu offers a delete')

const commitContextRow = find(
  view.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onContextMenu === 'function' && collectText(element).includes('chore: scaffold'),
)
check(commitContextRow !== undefined, 'a commit row carries a context menu')
commitContextRow?.props?.onContextMenu?.({ preventDefault: () => {}, clientX: 60, clientY: 60 })
view = await settle(view)
const menuText = view.text()
check(menuText.some((entry) => entry.includes('Cherry-pick')), 'the commit menu offers a cherry-pick', menuText.slice(-24))
check(menuText.includes('Reset (hard)'), 'the commit menu offers a hard reset')
check(menuText.includes('Revert commit'), 'the commit menu offers a revert')
check(menuText.includes('Amend message'), 'the commit menu offers an amend', menuText.slice(-24))

const changeRow = find(
  view.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onContextMenu === 'function' && collectText(element).includes('fresh.txt'),
)
check(changeRow !== undefined, 'a changed path carries a context menu')
changeRow?.props?.onContextMenu?.({ preventDefault: () => {}, clientX: 40, clientY: 40 })
view = await settle(view)
check(view.text().includes('Show the diff'), 'the changed-path menu offers the diff', view.text().slice(-24))

console.log('\nselect all and whole-file diff')
requests.length = 0
const bulkView = await render(GitPanel, {
  useWorkspaces: () => [{ path: WORKSPACE, title: 'project' }],
  useSessions: (selector) => selector(SESSIONS),
})
const selectAll = find(bulkView.tree, (element) => element.type === 'input' && element.props?.['aria-label'] === 'Select all')
check(selectAll !== undefined, 'the working-tree pane offers a select-all checkbox', collectText(bulkView.tree).slice(0, 8))
check(selectAll?.props?.checked === false, 'select-all starts unchecked', selectAll?.props)
const fileChecks = findAll(bulkView.tree, (element) => element.type === 'input' && element.props?.title === 'Select this file')
check(fileChecks.length === 3, 'each changed path carries a selection checkbox', fileChecks.length)
check(fileChecks.every((element) => element.props.checked === false), 'every changed path starts unselected', fileChecks.map((element) => element.props.checked))
check(collectText(bulkView.tree).includes('staged'), 'an already-staged path is marked as staged', collectText(bulkView.tree).filter((entry) => entry === 'staged'))
selectAll?.props?.onChange?.()
const bulkSelected = await settle(bulkView)
check(!requests.some((entry) => entry.op === 'stage'), 'select-all only selects; it stages nothing', requests.map((entry) => entry.op))
const selectedChecks = findAll(bulkSelected.tree, (element) => element.type === 'input' && element.props?.title === 'Select this file')
check(selectedChecks.length === 3 && selectedChecks.every((element) => element.props.checked === true), 'select-all selects every changed path', selectedChecks.map((element) => element.props.checked))
const stageSelection = find(bulkSelected.tree, (element) => element.type === 'button' && element.props?.title === 'Stage the selected files')
check(stageSelection !== undefined, 'the pane offers staging the selection', collectText(bulkSelected.tree).slice(0, 12))
stageSelection?.props?.onClick?.()
await settle(bulkSelected)
const stageSelectionRequest = requests.find((entry) => entry.op === 'stage')
check(
  stageSelectionRequest !== undefined && Array.isArray(stageSelectionRequest.args?.paths) && stageSelectionRequest.args.paths.length === 3,
  'staging the selection sends exactly the selected paths',
  stageSelectionRequest?.args,
)

serverWholeFile = true
requests.length = 0
const wholeView = await render(GitPanel, {
  useWorkspaces: () => [{ path: WORKSPACE, title: 'project' }],
  useSessions: (selector) => selector(SESSIONS),
})
const wholeRow = find(
  wholeView.tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-row') && typeof element.props?.onDoubleClick === 'function' && collectText(element).includes('index.ts'),
)
wholeRow?.props?.onDoubleClick?.()
const wholeSettled = await settle(wholeView)
const wholeRequest = requests.filter((entry) => entry.op === 'diff').pop()
check(wholeRequest?.args?.wholeFile === true, 'the whole-file setting rides the diff request', wholeRequest?.args)
const jumpButtons = findAll(wholeSettled.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-sbs-nav-item'))
check(jumpButtons.length >= 1, 'the whole-file diff lists its changes beside the line numbers', jumpButtons.map((element) => collectText(element)))
check(typeof jumpButtons[0]?.props?.onClick === 'function', 'a listed change is clickable')
jumpButtons[0]?.props?.onClick?.()
const wholeModal = find(wholeSettled.tree, (element) => typeof element.props?.className === 'string' && element.props.className.includes('git-panel-modal'))
check(collectText(wholeModal).includes('whole file'), 'the modal names the whole-file view', collectText(wholeModal).slice(0, 10))
serverWholeFile = false

console.log('\nright-Sidebar tab is a door, not a page')
requests.length = 0
closedTabs.length = 0
const tabProps = {
  sessionId: 's1',
  useWorkspaces: () => [{ path: WORKSPACE, title: 'project' }],
  useSessions: () => SESSIONS,
}
/**
 * The tab information the framework hands one body.
 *
 * @param {string|undefined} id - the tab record id.
 * @param {boolean} visible - whether the foreground session shows this tab.
 * @param {number} revision - navigation revision of the record.
 * @returns {object} the hook result.
 */
const tabInfo = (id, visible, revision) => ({
  tab: {
    id,
    visible,
    navigation: { revision },
    actions: {
      close: () => {
        if (failClose) throw new Error('the tab has no committed occurrence')
        closedTabs.push(id)
      },
    },
  },
})

// The card is what a deployment sees when the tab cannot close itself, so the
// close is made to fail here; the same card must never read Host data.
failClose = true
const idleTab = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-idle', false, 0) })
const idleText = idleTab.text()
check(idleText.includes('Git'), 'the fallback card names the tool', idleText.slice(0, 10))
check(idleText.some((entry) => entry.includes('full page')), 'the fallback card explains where the tool opens', idleText.filter((entry) => entry.length < 60))
check(idleText.includes('Open Git panel'), 'the fallback card offers the door', idleText.filter((entry) => entry.length < 40))
check(!idleText.includes('Commit & push'), 'the tab is not the whole tool')
check(requests.length === 0, 'the tab reads nothing from the Host', requests.map((entry) => entry.op))
check(selectedPanels.length === 0, 'a tab nobody navigated to never takes the main area', selectedPanels)
failClose = false

console.log('\nthe tab closes itself and opens the panel')
selectedPanels.length = 0
closedTabs.length = 0
const openedTab = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-git', true, 3) })
check(selectedPanels.includes('git'), 'arriving at the tab selects the main panel', selectedPanels)
check(closedTabs.includes('tab-git'), 'arriving at the tab closes it, so no Git tab is left behind', closedTabs)
check(openedTab.text().length === 0, 'a closed tab renders nothing at all', openedTab.text())
const beforeRestore = selectedPanels.length
const restoredTab = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-restored', true, 0) })
check(selectedPanels.length === beforeRestore, 'a tab restored from a previous session does not steal the main area', selectedPanels)
check(closedTabs.includes('tab-restored'), 'a restored tab is closed again instead of lingering', closedTabs)
const hiddenTab = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-hidden', false, 0) })
check(selectedPanels.length === beforeRestore, 'a hidden tab never takes the main area', selectedPanels)
check(closedTabs.includes('tab-hidden'), 'a mounted record is closed even while the column is collapsed', closedTabs)
void hiddenTab
void restoredTab

console.log('\na tab that cannot close never replays its navigation')
failClose = true
selectedPanels.length = 0
const stuckFirst = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-stuck', true, 5) })
check(selectedPanels.length === 1, 'the navigation opens the panel once', selectedPanels)
check(find(stuckFirst.tree, (element) => element.type === 'button' && collectText(element).includes('Open Git panel')) !== undefined, 'the door stays visible while the tab cannot close', collectText(stuckFirst.tree).filter((entry) => entry.length < 40))
const stuckAgain = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-stuck', true, 5) })
check(selectedPanels.length === 1, 'a remount with the same revision does not take the main area again', selectedPanels)
check(find(stuckAgain.tree, (element) => element.type === 'button' && collectText(element).includes('Open Git panel')) !== undefined, 'the door is still the fallback', collectText(stuckAgain.tree).filter((entry) => entry.length < 40))
const stuckAgainLater = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-stuck', true, 5) })
check(selectedPanels.length === 1, 'showing the same record again never steals the conversation back', selectedPanels)
void stuckAgainLater
failClose = false

console.log('\na refused transition keeps the door')
refusePanels = true
closedTabs.length = 0
const refusedTab = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-refused', true, 1) })
check(closedTabs.length === 0, 'a refused panel transition does not close the tab', closedTabs)
check(find(refusedTab.tree, (element) => element.type === 'button' && collectText(element).includes('Open Git panel')) !== undefined, 'the door stays visible when the panel refuses', collectText(refusedTab.tree).filter((entry) => entry.length < 40))
refusePanels = false
const recoveredTab = await render(Launcher, { ...tabProps, useTabInfo: () => tabInfo('tab-refused', true, 1) })
check(closedTabs.includes('tab-refused'), 'the same record closes once the transition is possible', closedTabs)
void recoveredTab

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exitCode = 1
