/**
 * The DSH package-local client chunk contract, as the Node harnesses need it.
 *
 * `client.js` is one classic script that registers a factory; every further file
 * has to arrive as a package-local chunk the module system keys by owner and
 * file name. A harness that merely read the files it felt like would pass
 * bundles the app rejects, so this stand-in enforces the three rules the browser
 * module system enforces — the chunk-name pattern, the `{ id, chunk }`
 * registration, and one materialization per key — and the harnesses supply only
 * their own globals through `evaluate`.
 *
 * Rules are taken from `@deepseek-ai/dsh-client-modules/lib/client.js`
 * (`CLIENT_CHUNK`, `register`, `require.async`, `importChunk`).
 *
 * @module test/module-loader
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Package-local chunk names the module system accepts, minus the leading `./`. */
export const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

/** The entry file every package registers first, and the key it is cached under. */
const ENTRY_FILE = 'client.js'

/**
 * Create the module-system stand-in for one package.
 *
 * @param {object} options - harness wiring.
 * @param {string} options.packageDir - directory holding `client.js` and its chunks.
 * @param {string} options.packageId - package name every registration must carry.
 * @param {Function} options.require - the harness's own require for platform seeds and injected services.
 * @param {Function} options.evaluate - `(source) => void`, runs one script in the harness's globals.
 * @returns {object} the loader face: `require`, `loadEntry`, `registered`.
 */
export function createModuleLoader({ packageDir, packageId, require: baseRequire, evaluate }) {
  /** Registration per module key, exactly as the module system keys its factories. */
  const registrations = new Map()

  /** Materialized exports per module key, mirroring the module system's load cache. */
  const exports = new Map()

  /**
   * Register one bundle factory.
   *
   * @param {object} entry - the `__ModuleLoader__.load` argument.
   * @returns {void} nothing.
   */
  function load(entry) {
    if (entry?.id !== packageId) throw new Error(`client-modules: registration id ${JSON.stringify(entry?.id)} is not ${JSON.stringify(packageId)}`)
    if (entry.chunk !== undefined && !CLIENT_CHUNK.test(entry.chunk)) throw new Error(`client-modules: invalid package-local chunk ${JSON.stringify(entry.chunk)}`)
    const key = entry.chunk ?? ENTRY_FILE
    if (registrations.has(key)) throw new Error(`client-modules: duplicate factory registration for "${key}" (bundle executed twice without invalidate?)`)
    registrations.set(key, entry)
  }

  /**
   * Run one registered factory once, as the module system materializes it.
   *
   * @param {string} key - module key.
   * @returns {unknown} the factory's exports.
   */
  function materialize(key) {
    if (exports.has(key)) return exports.get(key)
    const entry = registrations.get(key)
    if (entry === undefined) throw new Error(`client-modules: no registered factory for "${key}"`)
    const value = entry.factory(loaderRequire)
    exports.set(key, value)
    return value
  }

  /**
   * Read, execute, and register one chunk file, then return its exports.
   *
   * @param {string} fileName - chunk file name, without the leading `./`.
   * @returns {unknown} the chunk's exports.
   */
  function importChunk(fileName) {
    if (!registrations.has(fileName)) {
      let chunkSource
      try {
        chunkSource = readFileSync(join(packageDir, fileName), 'utf8')
      } catch (error) {
        throw new Error(`client-modules: could not load "${fileName}": ${error.message}`)
      }
      evaluate(chunkSource)
      if (!registrations.has(fileName)) throw new Error(`client-modules: bundle ${fileName} loaded without registering "${fileName}" via __ModuleLoader__.load`)
    }
    return materialize(fileName)
  }

  /**
   * The require every factory in this package receives.
   *
   * @param {string} spec - platform seed or injected package.
   * @returns {unknown} the resolved module.
   */
  function loaderRequire(spec) {
    return baseRequire(spec)
  }

  /**
   * Request one package-local chunk, as `require.async` does in the browser.
   *
   * @param {string} spec - `./client.<name>.js`.
   * @returns {Promise<unknown>} the chunk's exports.
   */
  loaderRequire.async = async (spec) => {
    if (typeof spec !== 'string' || !spec.startsWith('./')) throw new Error(`client-modules: require.async(${JSON.stringify(spec)}) is not a package-local chunk request`)
    const fileName = spec.slice(2)
    if (!CLIENT_CHUNK.test(fileName)) throw new Error(`client-modules: invalid relative chunk request ${JSON.stringify(spec)}`)
    return importChunk(fileName)
  }

  /**
   * Load the package's entry bundle and return its module face.
   *
   * @returns {unknown} the entry's exports.
   */
  function loadEntry() {
    if (!registrations.has(ENTRY_FILE)) {
      evaluate(readFileSync(join(packageDir, ENTRY_FILE), 'utf8'))
      if (!registrations.has(ENTRY_FILE)) throw new Error(`client-modules: ${ENTRY_FILE} loaded without registering via __ModuleLoader__.load`)
    }
    return materialize(ENTRY_FILE)
  }

  return {
    require: loaderRequire,
    /** The `window.__ModuleLoader__` face this loader installs. */
    moduleLoader: { load },
    loadEntry,
    /** Every module key registered so far, for assertions. */
    registered: () => [...registrations.keys()],
  }
}
