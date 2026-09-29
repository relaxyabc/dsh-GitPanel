/**
 * Regression test for the file-preview repair.
 *
 * The right Sidebar's file preview reports "the file resource service is
 * unavailable" on Chromium because the client resource model names a provider
 * by the host of a `dsh-resource://<type>/…` address and reads that host with
 * the URL parser — and Chromium's parser never treats a non-special scheme's
 * authority as a host:
 *
 *   new URL('dsh-resource://file/x').hostname   // Node, the specification: 'file'
 *                                               // Chromium:                   ''
 *
 * so every resource address resolves to no protocol at all and no provider is
 * ever asked for content. The browser half of this bundle repairs that by
 * replacing `URL` with a subclass that reports the host of a resource address,
 * leaving every other address to the browser.
 *
 * The harness has two halves:
 *
 * 1. It loads the shipped `client.js` in Node and checks the repair's shape —
 *    the address reader, and that applying the plugin installs a parser that
 *    fixes resource addresses without disturbing ordinary ones.
 * 2. It drives the same patch inside a real headless Chromium, where the defect
 *    actually reproduces, and asserts the bare URL first fails and the patched
 *    URL then succeeds — the one claim a Node-only test cannot make.
 *
 * The Chromium half is skipped, not failed, when no browser is installed; the
 * Node half always runs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

/** The scheme the client's resource model serves. */
const RESOURCE_SCHEME = 'dsh-resource:'

/**
 * The protocol key one address resolves to, derived exactly as the client
 * resource model derives it (`packages/client/resources/src/client/protocol.ts`).
 *
 * Spelled out here, not imported, because this is the code under test: the
 * bundle cannot reach another package's module, so the harness has to state the
 * contract the repair is written against.
 *
 * @param {string} address - the address to resolve.
 * @returns {string|undefined} the provider key, or undefined when nothing can match.
 */
function protocolOf(address) {
  let parsed
  try {
    parsed = new globalThis.URL(address)
  } catch {
    return undefined
  }
  if (parsed.protocol !== RESOURCE_SCHEME) return undefined
  return parsed.hostname === '' ? undefined : parsed.hostname.toLowerCase()
}

// ---- the shipped client half -------------------------------------------------
console.log('\nthe browser half in Node')
globalThis.window = {}
globalThis.require = (name) => {
  if (name === 'react') {
    return {
      Fragment: Symbol('Fragment'),
      createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.flat() }, children: children.flat() }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useMemo: (factory) => factory(),
      useCallback: (callback) => callback,
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
    }
  }
  // The settings card's primitives are absent, which is also a deployment the
  // repair has to survive: it needs the configuration service alone.
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return null
  throw new Error(`unexpected require(${name})`)
}

/** The parser the page shipped with, and the thing every assertion compares against. */
const nativeUrl = globalThis.URL
/** The settings namespace snapshot the fake configuration service serves. */
const settingsDocument = { status: 'ready', value: { filePreviewFix: true }, base: {}, user: {}, writable: true, revision: 1 }
/** Namespace subscribers the fake configuration service notified. */
const listeners = new Set()

/**
 * Apply the plugin to a fake client context.
 *
 * @param {object} section - the namespace section the fake Host serves.
 * @returns {Promise<{ disposers: Function[], labels: string[] }>} the effect disposers and their labels.
 */
async function applyClient(section) {
  settingsDocument.value = section
  const disposers = []
  const labels = []
  const ctx = {
    effect: (callback, label) => {
      labels.push(label)
      const disposer = callback()
      disposers.push(disposer)
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    configForms: {
      get: () => ({
        getSnapshot: () => settingsDocument,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        mutate: async () => true,
      }),
      whileServed: () => () => {},
    },
    slots: { inject: (name, callback) => { callback(); return () => {} }, register: () => () => {} },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: {},
    layout: {},
  }
  await moduleLoader.loadEntry().apply(ctx)
  return { disposers, labels }
}

// The page installs its module loader before any bundle runs, so the harness does
// the same, and every chunk the bundle asks for goes through the same contract.
const moduleLoader = createModuleLoader({
  packageDir: join(here, '..'),
  packageId: 'GitPanel',
  require: globalThis.require,
  evaluate: (source) => new Function('window', 'require', 'fetch', source)(globalThis.window, moduleLoader.require, () => Promise.reject(new Error('no Host in this harness'))),
})
globalThis.window.__ModuleLoader__ = moduleLoader.moduleLoader

const clientModule = moduleLoader.loadEntry()
check(moduleLoader.registered().includes('client.js'), 'the browser half registers through the module-loader contract', moduleLoader.registered())
const audit = clientModule.auditResourceAddress
check(typeof audit === 'function', 'the module exposes the address reader', Object.keys(clientModule ?? {}))
// The reader belongs to the repair's chunk, so it answers once apply has wired
// that chunk; the address cases are asserted below, right after the first apply.
check(audit('dsh-resource://file/x') === undefined, 'the exported reader is silent until the repair is wired', audit('dsh-resource://file/x'))

const first = await applyClient({ filePreviewFix: true })
check(audit('dsh-resource://file/x') === 'file', 'a file address names the file protocol', audit('dsh-resource://file/x'))
check(audit('dsh-resource://file/session/s1/home/me/a.md') === 'file', 'a session-scoped address names the file protocol')
check(audit('DSH-RESOURCE://FILE/x') === 'file', 'the scheme and host are compared case-insensitively', audit('DSH-RESOURCE://FILE/x'))
check(audit('dsh-resource://file?q=1') === 'file' && audit('dsh-resource://file#f') === 'file', 'a query or fragment ends the host', [audit('dsh-resource://file?q=1'), audit('dsh-resource://file#f')])
check(audit('dsh-resource://') === undefined && audit('dsh-resource:///x') === undefined, 'an address with no host names no protocol', [audit('dsh-resource://'), audit('dsh-resource:///x')])
check(audit('sidebar://guide') === undefined && audit(undefined) === undefined && audit(7) === undefined, 'anything else names no protocol')

check(first.labels.some((label) => label.includes('file-preview')), 'applying the plugin watches the repair setting', first.labels)
check(globalThis.URL !== nativeUrl, 'applying the plugin replaces the parser', globalThis.URL?.name)
check(protocolOf('dsh-resource://file/x') === 'file', 'the unmodified reader now resolves the resource protocol')
check(new globalThis.URL('dsh-resource://file/x').hostname === 'file', 'the patched parser reports the resource host', new globalThis.URL('dsh-resource://file/x').hostname)
check(new globalThis.URL('DSH-RESOURCE://FILE/x').hostname === 'file', 'the patched parser lower-cases the host', new globalThis.URL('DSH-RESOURCE://FILE/x').hostname)
check(String(new globalThis.URL('dsh-resource://file/x')) === 'dsh-resource://file/x', 'the parsed address still stringifies to what came in')
check(Object.prototype.toString.call(new globalThis.URL('dsh-resource://file/x')) === '[object URL]', 'the parsed address still reports itself as a URL')
const ordinary = new globalThis.URL('https://example.com/a?b=1#c')
check(
  ordinary.hostname === 'example.com' && ordinary.protocol === 'https:' && ordinary.pathname === '/a' && ordinary.search === '?b=1' && ordinary.hash === '#c',
  'an ordinary address is parsed by the browser itself',
  { host: ordinary.hostname, path: ordinary.pathname, search: ordinary.search, hash: ordinary.hash },
)
check(ordinary instanceof nativeUrl, 'an ordinary address is still a native URL')
check(new globalThis.URL('/x', 'https://example.com/a/b').href === 'https://example.com/x', 'a relative address still resolves against a base')
let rejected = false
try {
  new globalThis.URL('not a url')
} catch {
  rejected = true
}
check(rejected, 'an address the browser rejects still throws')

console.log('\nthe setting drives the repair')
settingsDocument.value = { filePreviewFix: false }
for (const listener of listeners) listener()
check(globalThis.URL === nativeUrl, 'turning the setting off removes the repair without a reload')
settingsDocument.value = { filePreviewFix: true }
for (const listener of listeners) listener()
check(globalThis.URL !== nativeUrl && protocolOf('dsh-resource://file/x') === 'file', 'turning it back on restores the repair without a reload')
for (const disposer of first.disposers) if (typeof disposer === 'function') disposer()
check(globalThis.URL === nativeUrl, 'disposing the plugin leaves the page parser as it found it')

globalThis.URL = nativeUrl
const off = await applyClient({ filePreviewFix: false })
check(globalThis.URL === nativeUrl, 'a deployment whose setting is off applies with no parser installed')
for (const disposer of off.disposers) if (typeof disposer === 'function') disposer()
globalThis.URL = nativeUrl

// ---- the same patch inside Chromium ------------------------------------------
/**
 * Find an installed Chromium, checking the usual Windows and POSIX locations.
 *
 * @returns {string|undefined} the executable path.
 */
function findChromium() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return undefined
}

/**
 * Build the page the browser half is driven from.
 *
 * The page fetches the plugin exactly as the Web client does, asserts the
 * defect before the plugin applies and the repair after, walks the address
 * cases, and then reports one machine-readable verdict in the document body.
 *
 * @param {string} clientUrl - the `file:` URL of the shipped `client.js`.
 * @returns {string} the page source.
 */
function probePage(clientUrl) {
  return `<!doctype html>
<html><body><pre id="out">pending</pre>
<script>
const lines = [];
const record = (condition, label) => lines.push((condition ? 'ok ' : 'FAIL ') + label);
const fail = (label) => { lines.push('FAIL ' + label); };
const report = () => { document.getElementById('out').textContent = 'DSH-PROBE-BEGIN\\n' + lines.join('\\n') + '\\nVERDICT ' + (lines.some((line) => line.startsWith('FAIL')) ? 'fail' : 'pass') + '\\nDSH-PROBE-END'; };
try {
  // Chromium's own answer for the address the preview uses: no host at all.
  record(new URL('dsh-resource://file/x').hostname === '', 'chromium reports no host for a dsh-resource address');
  record(new URL('dsh-resource://file/x').protocol === 'dsh-resource:', 'chromium still reports the scheme');
  record(new URL('https://example.com/x').hostname === 'example.com', 'chromium parses an ordinary address normally');

  // The page's own module loader, reduced to the three rules that matter here:
  // package-local chunk names, one registration per key, and a sibling bundle
  // fetched over the network — the probe must exercise the real transport, so a
  // chunk that only works when pre-registered would pass here and fail in the app.
  const registrations = new Map();
  const materialized = new Map();
  const CLIENT_CHUNK = /^client\\.[A-Za-z0-9][A-Za-z0-9._-]*\\.js$/;
  window.__ModuleLoader__ = { load: (entry) => {
    const key = entry.chunk === undefined ? 'client.js' : entry.chunk;
    if (registrations.has(key)) throw new Error('duplicate factory registration for ' + key);
    registrations.set(key, entry);
  } };
  const loadScript = (source) => new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = source;
    element.onload = () => resolve();
    element.onerror = () => reject(new Error('the page could not fetch ' + source));
    document.head.appendChild(element);
  });
  const requireModule = (name) => {
    if (name === 'react') {
      return {
        Fragment: Symbol('Fragment'),
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useMemo: (factory) => factory(),
        useCallback: (callback) => callback,
        useEffect: () => {},
        useRef: (initial) => ({ current: initial }),
      };
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return null;
    throw new Error('unexpected require(' + name + ')');
  };
  requireModule.async = async (spec) => {
    if (typeof spec !== 'string' || spec.indexOf('./') !== 0) throw new Error('require.async(' + spec + ') is not a package-local chunk request');
    const fileName = spec.slice(2);
    if (!CLIENT_CHUNK.test(fileName)) throw new Error('invalid relative chunk request ' + JSON.stringify(spec));
    if (!materialized.has(fileName)) {
      if (!registrations.has(fileName)) await loadScript(new URL(fileName, ${JSON.stringify(clientUrl)}).href);
      const chunkEntry = registrations.get(fileName);
      if (chunkEntry === undefined) throw new Error('bundle ' + fileName + ' loaded without registering via __ModuleLoader__.load');
      materialized.set(fileName, chunkEntry.factory(requireModule));
    }
    return materialized.get(fileName);
  };
  window.require = requireModule;
  const settingsDocument = { status: 'ready', value: { filePreviewFix: true }, base: {}, user: {}, writable: true, revision: 1 };
  window.__PROBE_LISTENERS__ = new Set();
  window.__PROBE_SETTINGS__ = settingsDocument;

  document.getElementById('out').textContent = 'loading';
  const script = document.createElement('script');
  script.src = ${JSON.stringify(clientUrl)};
  script.onerror = () => { fail('the page could not fetch the shipped client.js'); report(); };
  script.onload = () => {
    try {
      const entry = registrations.get('client.js');
      const factory = entry?.factory;
      if (typeof factory !== 'function') { fail('client.js did not register a module factory'); report(); return; }
      const module = factory(requireModule);
      const ctx = {
        effect: (callback) => { const disposer = callback(); return typeof disposer === 'function' ? disposer : () => {}; },
        locale: { register: () => () => {}, bind: () => (key) => key },
        configForms: {
          get: () => ({
            getSnapshot: () => settingsDocument,
            subscribe: (listener) => { window.__PROBE_LISTENERS__.add(listener); return () => window.__PROBE_LISTENERS__.delete(listener); },
            mutate: async () => true,
          }),
          whileServed: () => () => {},
        },
        slots: { inject: (name, callback) => { callback(); return () => {} }, register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sidebarRight: {},
        layout: {},
      };
      // Applying is asynchronous now — the chunks arrive over the network — so
      // every claim about the repair waits for it, and one report() ends the page.
      module.apply(ctx).then(() => {
        record(new URL('dsh-resource://file/x').hostname === 'file', 'the repaired parser reports the resource host in chromium');
        record(new URL('dsh-resource://file/session/s1/home/me/a.md').hostname === 'file', 'a session-scoped address resolves too');
        record(new URL('DSH-RESOURCE://FILE/x').hostname === 'file', 'the host is lower-cased as the model expects');
        record(new URL('dsh-resource://plan/session/s1/call').hostname === 'plan', 'another protocol resolves the same way');
        record(new URL('https://example.com/a?b=1#c').hostname === 'example.com' && new URL('https://example.com/a?b=1#c').search === '?b=1', 'an ordinary address is still parsed by chromium');
        record(new URL('/x', 'https://example.com/a/b').href === 'https://example.com/x', 'a relative address still resolves');
        let threw = false;
        try { new URL('not a url'); } catch { threw = true; }
        record(threw, 'an address chromium rejects still throws');
        settingsDocument.value = { filePreviewFix: false };
        for (const listener of window.__PROBE_LISTENERS__) listener();
        record(new URL('dsh-resource://file/x').hostname === '', 'turning the setting off restores chromium parsing');
        settingsDocument.value = { filePreviewFix: true };
        for (const listener of window.__PROBE_LISTENERS__) listener();
        record(new URL('dsh-resource://file/x').hostname === 'file', 'turning the setting on repairs it again');
        report();
      }, (error) => {
        fail('applying the plugin failed: ' + (error && error.message ? error.message : String(error)));
        report();
      });
    } catch (error) {
      fail('the repair threw: ' + (error && error.message ? error.message : String(error)));
      report();
    }
  };
  document.head.appendChild(script);
} catch (error) {
  fail('the probe threw: ' + (error && error.message ? error.message : String(error)));
  report();
}
</script></body></html>`
}

console.log('\nthe same repair inside Chromium')
const chromium = findChromium()
if (chromium === undefined) {
  console.log('  skip no Chromium found; the engine-specific defect could not be reproduced here')
} else {
  const workspace = mkdtempSync(join(tmpdir(), 'git-panel-preview-'))
  try {
    const page = join(workspace, 'probe.html')
    writeFileSync(page, probePage(`file:///${join(here, '..', 'client.js').replace(/\\/g, '/')}`))
    const output = execFileSync(
      chromium,
      ['--headless', '--disable-gpu', '--no-sandbox', '--user-data-dir=' + join(workspace, 'profile'), '--dump-dom', '--virtual-time-budget=5000', `file:///${page.replace(/\\/g, '/')}`],
      { encoding: 'utf8', timeout: 60_000 },
    )
    const block = /DSH-PROBE-BEGIN([\s\S]*?)DSH-PROBE-END/.exec(output)
    if (block === null) {
      check(false, 'the Chromium probe reported a verdict', output.slice(0, 300))
    } else {
      const reported = block[1].split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('VERDICT'))
      for (const line of reported) {
        const ok = line.startsWith('ok ')
        check(ok, `chromium: ${line.replace(/^(ok|FAIL) /, '')}`, line)
      }
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

globalThis.URL = nativeUrl
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exitCode = 1
