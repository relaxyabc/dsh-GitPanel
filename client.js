/**
 * Browser half of the Git manager bundle.
 *
 * Contributes an IntelliJ-style Git tool to the Web client: a sidebar entry in
 * the global panel rail selects a full-page main panel whose three columns are
 * branches (left), commit history (middle), and the selected commit's details
 * (right). The right Sidebar also gets a Git tab that summarises the repository
 * and points at that panel.
 *
 * Every Host interaction goes through the authenticated `/api/local-git` route
 * the bundle's Host half owns.
 *
 * @module GitPanel
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** This implementation's identity in the right-Sidebar tab system. */
    const PLUGIN_ID = 'GitPanel'

    /** The right-Sidebar tab kind this package owns. */
    const GIT_KIND = 'git'

    /** Sidebar panel id and the matching `main` slot key. */
    const PANEL_ID = 'git'

    /** The authenticated Host route every operation is posted to. */
    const ROUTE = '/api/local-git'

    /** Commit page size requested from the Host. */
    const COMMIT_PAGE = 200

    /** Most side-by-side diff rows one modal renders before it truncates. */
    const MAX_DIFF_ROWS = 3000

    /** Shared empty working-tree list, so an unchanged repository keeps a stable identity. */
    const NO_FILES = []

    /** The plugin entry whose configuration the Plugins page card edits. */
    const SETTINGS_NS = 'GitPanel'

    /** The discovery-depth configuration field the Plugins page card edits. */
    const DEPTH_FIELD = 'discoveryDepth'

    /** The whole-file diff configuration field the Plugins page card edits. */
    const WHOLE_FILE_FIELD = 'wholeFileDiff'

    /** The file-preview-fix configuration field the Plugins page card edits. */
    const FILE_PREVIEW_FIELD = 'filePreviewFix'

    /** Section id of the settings card's discovery group, tying its heading to the region. */
    const DISCOVERY_SECTION_ID = 'GitPanel-settings-discovery'

    /** Section id of the settings card's diff-display group. */
    const DISPLAY_SECTION_ID = 'GitPanel-settings-display'

    /** Section id of the settings card's file-preview group. */
    const FILE_PREVIEW_SECTION_ID = 'GitPanel-settings-preview'

    /** Element id of the discovery-depth input, so its label points at the control. */
    const DEPTH_INPUT_ID = 'GitPanel-discovery-depth'

    /** Element id of the whole-file diff's disclosure region, so its button points at it. */
    const WHOLE_FILE_HELP_ID = 'GitPanel-whole-file-help'

    /** Element id of the file-preview fix's disclosure region, so its button points at it. */
    const FILE_PREVIEW_HELP_ID = 'GitPanel-file-preview-help'

    /** The address scheme the client's resource model serves, `<type>` naming a provider. */
    const RESOURCE_SCHEME = 'dsh-resource:'

    /** The resource address prefix whose host is compared case-insensitively, as the parser does. */
    const RESOURCE_PREFIX = 'dsh-resource://'

    /**
     * The whole-file switch's conversion spec.
     *
     * The shared form model speaks draft text, so the boolean setting is staged
     * as `'true'` / `'false'` and parsed back to a real boolean on save; an
     * unexpected draft blocks the save instead of writing a wrong value.
     */
    const WHOLE_FILE_SPEC = {
      field: WHOLE_FILE_FIELD,
      format: (value) => (value === true ? 'true' : 'false'),
      parse: (text) => (text === '' ? { kind: 'clear' } : text === 'true' ? { kind: 'set', value: true } : text === 'false' ? { kind: 'set', value: false } : undefined),
    }

    /**
     * The file-preview switch's conversion spec, staged exactly like the
     * whole-file one: draft text in, a real boolean out on save.
     */
    const FILE_PREVIEW_SPEC = {
      field: FILE_PREVIEW_FIELD,
      format: (value) => (value === false ? 'false' : 'true'),
      parse: (text) => (text === '' ? { kind: 'clear' } : text === 'true' ? { kind: 'set', value: true } : text === 'false' ? { kind: 'set', value: false } : undefined),
    }

    /**
     * The shared settings primitives the Plugins page form is built from.
     *
     * Resolved during apply, so a deployment without the primitives module
     * loses only the settings card instead of the whole tool.
     */
    let primitives = null

    /** Glyphs spelled as escapes so no encoding can mangle them. */
    const CARET_OPEN = '\u25be'
    const CARET_CLOSED = '\u25b8'
    const BRANCH_GLYPH = '\u2387'
    const ENTER_GLYPH = '\u21b5'
    const CHECK_GLYPH = '\u2713'
    const WARN_GLYPH = '!'
    const DOT_GLYPH = '\u2022'
    const ARROW = '\u2192'
    const UP = '\u2191'
    const DOWN = '\u2193'
    const DASH = '\u2014'
    const CLOSE_GLYPH = '\u00d7'

    /**
     * Post one operation to the Host half.
     *
     * @param {string} op - operation name.
     * @param {object} args - operation arguments.
     * @returns {Promise<object>} the operation payload.
     * @throws {Error} when the transport or the Host refuses the operation.
     */
    async function callHost(op, args) {
      let response
      try {
        response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, args }),
        })
      } catch (error) {
        throw new Error(`the Host is unreachable: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (response.status === 401) throw new Error('this browser session is not authorized')
      if (response.status === 403) throw new Error('the Host refused this origin')
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`the Host answered ${response.status} without JSON`)
      }
      if (body === null || typeof body !== 'object') throw new Error('the Host answered an unexpected payload')
      if (body.ok !== true) throw new Error(typeof body.error === 'string' && body.error !== '' ? body.error : 'the operation failed')
      return body.data ?? {}
    }

    /**
     * The message of an unknown thrown value.
     *
     * @param {unknown} error - the failure.
     * @returns {string} its message.
     */
    function failureText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * Whether a Host failure means the running Host half predates this client build.
     *
     * The browser re-fetches `client.js` on every page load while the Host half
     * is imported once when the DSH process starts, so a refreshed page can
     * outrun the Host for as long as that process keeps running. Reporting that
     * state beats repeating the Host's raw `unknown operation` text, and the
     * few operations an older Host still answers let the panel stay usable.
     *
     * @param {unknown} error - the failure.
     * @returns {boolean} whether the Host reported the operation as unknown.
     */
    function isStaleHost(error) {
      return failureText(error).includes('unknown operation')
    }

    /**
     * The protocol key of one address, read without the URL parser.
     *
     * The client's resource model names a provider by the host of a
     * `dsh-resource://<type>/…` address and reads that host with `new
     * URL(address).hostname`. Chromium's URL parser never treats a non-special
     * scheme's authority as a host — `new URL('dsh-resource://file/x').hostname`
     * is `''` there, while Node and the specification say `'file'` — so on the
     * affected browsers every resource address resolves to no protocol at all,
     * the sidebar reports that the file resource service is unavailable, and no
     * provider ever opens. This reads the same host out of the string instead,
     * which is what the upstream fix does.
     *
     * @param {unknown} address - the address to read.
     * @returns {string|undefined} the lower-cased protocol key, or undefined when the string is not a resource address with a host.
     */
    function resourceProtocolOf(address) {
      if (typeof address !== 'string') return undefined
      if (address.slice(0, RESOURCE_PREFIX.length).toLowerCase() !== RESOURCE_PREFIX) return undefined
      const rest = address.slice(RESOURCE_PREFIX.length)
      const end = rest.search(/[/?#]/)
      const host = end === -1 ? rest : rest.slice(0, end)
      return host === '' ? undefined : host.toLowerCase()
    }

    /**
     * The file-preview fix's plugin state.
     *
     * `URL` is replaced with a wrapper so every later `new URL(...)` in the page
     * reads a resource address the way the specification says. `native` is the
     * parser that wrapper replaced — restored by identity, never by prototype,
     * because the wrapper is an ordinary function whose prototype is
     * `Function.prototype`. `value` is the setting's draft text, `undefined`
     * meaning the Host has not answered yet and the documented default (on)
     * applies.
     */
    const filePreview = { value: undefined, cached: null, native: null }

    /**
     * The configuration-service snapshot's answer for one field.
     *
     * `value` carries the Host's resolved section, so it arrives as a plain
     * value; a live reference is unwrapped anyway, because a volatile field is
     * exactly the kind whose stored shape can differ from its resolved one.
     *
     * @param {object} snapshot - the settings namespace snapshot.
     * @param {string} field - the field to read.
     * @returns {unknown} the resolved value, or undefined when the Host has said nothing.
     */
    function settingsValue(snapshot, field) {
      const section = snapshot?.value
      if (section === null || typeof section !== 'object') return undefined
      const value = section[field]
      if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
      return value
    }

    /**
     * Whether the file-preview fix is in force right now.
     *
     * Only an explicit `false` turns it off: the default is on, and a
     * deployment that never served the field, a client that has not read the
     * settings document yet, or a stored value of the wrong shape all keep the
     * breakage compensated instead of leaving the preview dead.
     *
     * @returns {boolean} whether the browser half should repair resource addresses.
     */
    function filePreviewFixEnabled() {
      return filePreview.value !== 'false'
    }

    /**
     * Install the URL wrapper that reports resource addresses correctly.
     *
     * The wrapper is deliberately narrow: only `dsh-resource://` addresses
     * return the view, and every other address — including the ones a page
     * parses while this is installed — goes to the URL implementation itself,
     * unchanged. A browser whose parser already reports the host (Node, jsdom)
     * is unaffected for the same reason, which is what makes this
     * engine-independent, and no substitute for the upstream fix.
     *
     * A resource address cannot simply be a `URL` subclass that assigns
     * `hostname`: Chromium's URL is an exotic object whose parts are
     * unforgeable, and there the assignment is silently dropped for a
     * non-special scheme while every native method invoked through the subclass
     * still works. The view is therefore a wrapper that answers the parts the
     * repair is about and forwards everything else, which costs one thing
     * worth naming: such an address is not `instanceof URL`, and mutating one
     * of its parts does not rewrite it. Resource addresses are read, never
     * rewritten, so neither is exercised.
     *
     * One consequence of replacing a global rather than a call site: the
     * wrapper also stands in for the URL *constructor*, so its statics have to
     * stay reachable — the client mints blob URLs for attachments and document
     * renderers through this very global.
     *
     * @returns {boolean} whether the wrapper is in force after the call.
     */
    function installFilePreviewFix() {
      if (filePreview.cached !== null) return true
      try {
        const NativeUrl = globalThis.URL
        if (typeof NativeUrl !== 'function') return false
        /**
         * A `URL` that also knows the host of a resource address.
         *
         * Declared inside `installFilePreviewFix` so the parser it forwards to
         * stays the constructor captured when the wrapper was installed, never
         * a constructor this file introduced.
         *
         * @param {unknown} address - the address to parse.
         * @param {unknown} base - an optional base address.
         * @returns {object} the parsed address.
         */
        function ResourceAwareUrl(address, base) {
          const host = resourceProtocolOf(address)
          const parsed = base === undefined ? new NativeUrl(address) : new NativeUrl(address, base)
          if (host === undefined) return parsed
          const view = { hostname: host, host }
          Object.setPrototypeOf(view, NativeUrl.prototype)
          return new Proxy(view, {
            /**
             * Answer the resource host, then forward everything else.
             *
             * @param {object} target - the view.
             * @param {string|symbol} property - the property read.
             * @param {unknown} receiver - the proxy that received the read.
             * @returns {unknown} the property value.
             */
            get(target, property, receiver) {
              if (property === 'hostname' || property === 'host') return Reflect.get(target, property, receiver)
              const value = Reflect.get(parsed, property, parsed)
              // A native URL method is bound to the URL it came from: calling
              // it with this proxy as `this` is an illegal invocation.
              return typeof value === 'function' ? value.bind(parsed) : value
            },
            /**
             * @param {object} target - the view.
             * @param {string|symbol} property - the property asked about.
             * @returns {boolean} whether the parsed address carries it.
             */
            has(target, property) {
              return Reflect.has(target, property) || property in parsed
            },
          })
        }
        filePreview.native = NativeUrl
        filePreview.cached = ResourceAwareUrl
        // Inheriting from the URL constructor keeps every static the rest of
        // the client reaches through this global — `createObjectURL`,
        // `revokeObjectURL`, `parse` — without listing them, and keeps any
        // static a future engine adds.
        Object.setPrototypeOf(ResourceAwareUrl, NativeUrl)
        globalThis.URL = ResourceAwareUrl
        return true
      } catch {
        // An environment this cannot wrap keeps the parser it shipped with,
        // which is exactly the state the setting's default already assumes.
        filePreview.cached = null
        filePreview.native = null
        return false
      }
    }

    /**
     * Remove the URL wrapper again, restoring the parser the page shipped with.
     *
     * The parser is restored by identity rather than by walking the wrapper's
     * prototype chain: the wrapper is an ordinary function, so its prototype is
     * `Function.prototype` and that chain leads nowhere near a URL.
     *
     * @returns {void} nothing.
     */
    function uninstallFilePreviewFix() {
      const patched = filePreview.cached
      const original = filePreview.native
      filePreview.cached = null
      filePreview.native = null
      if (patched === null || original === null) return
      try {
        if (globalThis.URL === patched) globalThis.URL = original
      } catch {
        // A page that froze `URL` keeps the wrapper; the setting is still
        // honoured on the next load, where nothing is installed at all.
      }
    }

    /**
     * Follow the plugin's file-preview setting for the life of the plugin.
     *
     * The patch is installed unconditionally first and only removed once the
     * Host says the setting is off. Gating the installation on a settings read
     * would break the preview on every load that restores a document tab before
     * the settings document arrives — the one ordering where the fix is needed
     * and not yet known — so "unknown" resolves to the documented default while
     * an explicit "off" still takes effect as soon as it is known.
     *
     * @param {object} ctx - the apply-scope client context.
     * @returns {Function} the disposer ending the watch.
     */
    function watchFilePreviewFix(ctx) {
      const form = ctx.configForms.get(SETTINGS_NS)
      installFilePreviewFix()
      /**
       * Apply the latest answer; only a known setting ever changes the patch.
       *
       * @returns {void} nothing.
       */
      const sync = () => {
        const value = settingsValue(form.getSnapshot(), FILE_PREVIEW_FIELD)
        if (typeof value !== 'boolean') return
        filePreview.value = String(value)
        if (filePreviewFixEnabled()) installFilePreviewFix()
        else uninstallFilePreviewFix()
      }
      const unsubscribe = form.subscribe(sync)
      sync()
      return () => {
        unsubscribe()
        uninstallFilePreviewFix()
      }
    }

    /**
     * I18n namespace. Every user-facing string lives in the `client.i18n.js`
     * chunk and is read through `t()` at render time, so a language switch needs
     * no re-registration; `locale/*.json` stays manifest metadata only.
     */
    const LOCALE_NS = 'gitPanel'

    /** Submodule state → dictionary key; an unknown state renders raw. */
    const SUBMODULE_STATE_KEYS = {
      initialized: 'submodule.initialized',
      uninitialized: 'submodule.uninitialized',
      'out-of-date': 'submodule.out-of-date',
      conflicted: 'submodule.conflicted',
    }

    /**
     * Fill `{name}` placeholders in a translated template.
     *
     * @param {string} template - translated template.
     * @param {Record<string, string>} vars - placeholder values.
     * @returns {string} the filled string.
     */
    function fill(template, vars) {
      return template.replace(/\{(\w+)\}/g, (match, key) => (vars && vars[key] !== undefined ? String(vars[key]) : match))
    }

    /**
     * The translated label for one submodule state.
     *
     * @param {string} state - the raw host state.
     * @param {(key: string) => string} t - translate function.
     * @returns {string} the label; an unknown state renders raw.
     */
    function submoduleStateText(state, t) {
      const key = SUBMODULE_STATE_KEYS[state]
      return key === undefined ? state : t(key)
    }

    /**
     * Translate bound at apply time, used by copy read outside the framework's
     * `t` prop reach (guide entries, panel-list labels) and as the components'
     * fallback before the framework prop arrives.
     */
    let boundTranslate = (key) => dictionaries.en[key] ?? key

    /**
     * The loaded dictionaries, so the fallback above has English copy to read
     * even before `apply` hands them to the locale service.
     */
    let dictionaries = { en: {}, zh: {} }

    /**
     * The apply-scope client context, kept so slot components can drive the
     * main-panel selection (slot occupants receive no `ctx`).
     */
    let hostContext = null

    /**
     * Select the full-page Git panel and reveal it.
     *
     * The layout service throws while the main key is not committed yet; the
     * launcher's explicit button retries, so the failed transition stays quiet.
     * A fullscreen right Sidebar covers the frame, so when the transition comes
     * from a tab in that presentation the column is collapsed to reveal the
     * panel.
     *
     * @param {object} [info] - the launcher's tab info, when forwarded from a tab.
     * @returns {boolean} whether the panel was selected.
     */
    function openGitPanel(info) {
      const layout = hostContext?.layout
      if (layout === null || typeof layout?.selectPanel !== 'function') return false
      try {
        layout.selectPanel(PANEL_ID)
      } catch {
        return false
      }
      if (info?.sidebar?.fullscreen === true) {
        const sidebar = hostContext?.sidebarRight
        if (typeof sidebar?.isExpanded === 'function' && sidebar.isExpanded() && typeof sidebar?.toggleExpanded === 'function') {
          try {
            sidebar.toggleExpanded()
          } catch {
            // The sidebar's own chrome still collapses it.
          }
        }
      }
      return true
    }

    /**
     * Pick the main-view Session's id from a sessions snapshot.
     *
     * The main view retains exactly one Session under the `mainView` source and
     * the list rows carry those retention counts — the same rule the shipped
     * workspace browser uses to find the current Session.
     *
     * @param {object|undefined} sessions - the `useSessions` snapshot.
     * @returns {string|undefined} the main-view Session id.
     */
    function mainSessionIdOf(sessions) {
      if (sessions === null || typeof sessions !== 'object') return undefined
      const rows = sessions.byId ?? {}
      const ids = Array.isArray(sessions.ids) && sessions.ids.length > 0 ? sessions.ids : Object.keys(rows)
      for (const id of ids) {
        const row = rows[id]
        if (row === null || typeof row !== 'object') continue
        if ((row.retainedBy?.mainView ?? 0) > 0) return id
      }
      return undefined
    }

    /**
     * Join class names.
     *
     * @param {...(string|false|null|undefined)} parts - names.
     * @returns {string} the class attribute.
     */
    function cx(...parts) {
      return parts.filter((part) => typeof part === 'string' && part !== '').join(' ')
    }

    /**
     * Format a UNIX timestamp in seconds as a short relative age.
     *
     * @param {number} seconds - commit timestamp.
     * @returns {string} the age.
     */
    function relativeAge(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return ''
      const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds)
      if (delta < 60) return `${delta}s`
      if (delta < 3600) return `${Math.floor(delta / 60)}m`
      if (delta < 86400) return `${Math.floor(delta / 3600)}h`
      if (delta < 2592000) return `${Math.floor(delta / 86400)}d`
      if (delta < 31536000) return `${Math.floor(delta / 2592000)}mo`
      return `${Math.floor(delta / 31536000)}y`
    }

    /**
     * Format a commit timestamp as a readable local date.
     *
     * @param {number} seconds - commit timestamp.
     * @returns {string} the date, or an empty string.
     */
    function absoluteDate(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return ''
      const date = new Date(seconds * 1000)
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * The display letter for a porcelain status.
     *
     * @param {string} status - the status letter.
     * @returns {string} the display letter.
     */
    function statusText(status) {
      if (status === '?') return 'U'
      return typeof status === 'string' && status !== '' ? status : 'M'
    }

    /**
     * The last path segment.
     *
     * @param {string} path - a path.
     * @returns {string} the basename.
     */
    function basename(path) {
      const parts = String(path).split(/[\\/]/)
      return parts[parts.length - 1] ?? path
    }

    /** The token-only stylesheet: no Harness Client package is imported. */
    const STYLES = [
      '.git-panel{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-base,transparent)}',
      '.git-panel *{box-sizing:border-box}',
      '.git-panel-bar{display:flex;flex-direction:column;gap:6px;flex:none;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}',
      '.git-panel-bar-row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      // The bar pads by 12px, so the field is the 320px column minus that inset
      // to keep the workspace dropdown's right edge on the branch column's edge.
      '.git-panel-field{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 180px;max-width:calc(320px - 12px)}',
      '.git-panel-field-label{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-field .git-panel-select{width:100%;max-width:none;padding:3px 8px}',
      '.git-panel-branch-chip{flex:none;display:inline-flex;align-items:center;gap:5px;max-width:220px;padding:2px 8px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#1f2328)}',
      '.git-panel-branch-chip-glyph{display:inline-flex;color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-branch-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.git-panel-spacer{flex:1;min-width:4px}',
      '.git-panel-select{max-width:260px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:2px 6px;font:inherit;cursor:pointer}',
      '.git-panel-input{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:2px 7px;font:inherit;min-width:0}',
      '.git-panel-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:2px 8px;font:inherit;cursor:pointer;white-space:nowrap}',
      '.git-panel-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}',
      '.git-panel-btn:disabled{opacity:.45;cursor:default}',
      '.git-panel-btn-primary{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 16%,transparent);color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 26%,transparent)}',
      '.git-panel-cols{flex:1;min-height:0;display:flex}',
      '.git-panel-col{display:flex;flex-direction:column;min-height:0;min-width:0}',
      '.git-panel-col-left{width:320px;flex:none;border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-col-mid{flex:1;min-width:220px}',
      '.git-panel-col-right{width:400px;flex:none;border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-pane{display:flex;flex-direction:column;min-height:0;overflow:hidden}',
      '.git-panel-pane-top{flex:1 1 46%;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-pane-grow{flex:1}',
      '.git-panel-pane-head{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;padding:5px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-pane-title{font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#57606a);white-space:nowrap}',
      '.git-panel-count{flex:none;font-size:10.5px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-list{flex:1;min-height:0;overflow:auto;padding:3px 0 8px}',
      '.git-panel-empty{padding:8px 10px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-row{display:flex;align-items:center;gap:7px;padding:3px 10px;cursor:default}',
      '.git-panel-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1))}',
      '.git-panel-row-sel,.git-panel-row-sel:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 18%,transparent)}',
      '.git-panel-branch{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git-panel-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#57606a);font-size:11px}',
      '.git-panel-group{display:flex;align-items:center;gap:6px;width:100%;padding:5px 9px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.git-panel-group:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}',
      '.git-panel-caret{flex:none;width:10px;font-size:9px;opacity:.75}',
      '.git-panel-tag{flex:none;padding:0 5px;border-radius:3px;font-size:10px;font-weight:600;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 14%,transparent);color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-chip{flex:none;padding:0 5px;border-radius:3px;font-size:10px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-status{flex:none;width:14px;text-align:center;font-weight:700;font-size:11px;font-family:ui-monospace,monospace}',
      '.git-panel-status-M{color:var(--dsw-alias-state-warn-primary,#9a6700)}',
      '.git-panel-status-A{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-status-D{color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-status-R{color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-status-C{color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-status-U{color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-status-\\?{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-check{flex:none;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary,#0969da);cursor:pointer}',
      '.git-panel-numstat{flex:none;display:flex;gap:4px;font-family:ui-monospace,monospace;font-size:10px}',
      '.git-panel-plus{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-minus{color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-commit{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
      '.git-panel-commit-top{display:flex;align-items:center;gap:6px;min-width:0}',
      '.git-panel-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git-panel-meta{display:flex;gap:7px;overflow:hidden;color:var(--dsw-alias-label-secondary,#57606a);font-size:11px;white-space:nowrap}',
      '.git-panel-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}',
      '.git-panel-detail{flex:1 1 46%;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-detail-head{flex:none;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-detail-subject{font-weight:600;font-size:13px;margin-bottom:5px;word-break:break-word}',
      '.git-panel-detail-body{margin-top:6px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11.5px}',
      '.git-panel-kv-key{color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-kv-value{overflow:hidden;text-overflow:ellipsis;word-break:break-all}',
      '.git-panel-msg{display:flex;flex-direction:column;gap:6px;flex:none;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-textarea{width:100%;min-height:56px;resize:vertical;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:5px 7px;font:inherit}',
      '.git-panel-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.git-panel-banner{margin:6px 10px;padding:6px 8px;border-radius:5px;word-break:break-word}',
      '.git-panel-banner-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#cf222e) 12%,transparent);color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-banner-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 12%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-banner-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#9a6700) 14%,transparent);color:var(--dsw-alias-state-warn-primary,#9a6700)}',
      '.git-panel-sbs-layout{flex:1;min-height:0;display:flex;align-items:stretch}',
      '.git-panel-sbs-scroll{flex:1;min-width:0;min-height:0;overflow:auto}',
      '.git-panel-sbs-wrap{display:flex;align-items:flex-start;min-height:100%}',
      '.git-panel-sbs{flex:1;min-width:0;display:flex;flex-direction:column;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.55;tab-size:4}',
      '.git-panel-sbs-nav{position:sticky;top:0;align-self:flex-start;flex:none;display:flex;flex-direction:column;width:54px;max-height:80vh;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}',
      '.git-panel-sbs-nav-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:center;gap:2px;padding:2px 1px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}',
      '.git-panel-sbs-nav-step{flex:none;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;padding:0;border:0;border-radius:3px;background:none;color:inherit;font:inherit;font-size:10px;cursor:pointer}',
      '.git-panel-sbs-nav-step:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.24))}',
      '.git-panel-sbs-nav-step:disabled{opacity:.35;cursor:default}',
      '.git-panel-sbs-nav-count{flex:none;font-family:ui-monospace,monospace;font-size:9px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-sbs-nav-item{display:flex;align-items:center;justify-content:flex-end;gap:3px;border:0;background:none;color:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:1.5;padding:1px 7px;cursor:pointer;white-space:nowrap}',
      '.git-panel-sbs-nav-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16))}',
      '.git-panel-sbs-nav-current,.git-panel-sbs-nav-current:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 24%,transparent)}',
      '.git-panel-sbs-nav-add{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-sbs-nav-del{color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-sbs-nav-change{color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-sbs-overview{position:relative;flex:none;width:14px;overflow:hidden;cursor:pointer;border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}',
      '.git-panel-sbs-overview-view{position:absolute;left:0;right:0;border-radius:2px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.22));pointer-events:none}',
      '.git-panel-sbs-mark{position:absolute;left:2px;right:2px;min-height:3px;padding:0;border:0;border-radius:2px;background:var(--dsw-alias-brand-primary,#0969da);cursor:pointer}',
      '.git-panel-sbs-mark-add{background:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-sbs-mark-del{background:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-sbs-mark-change{background:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-sbs-mark-current{outline:1px solid var(--dsw-alias-label-primary,#1f2328)}',
      '.git-panel-sbs-row{scroll-margin-top:26px}',
      '.git-panel-sbs-columns{display:grid;grid-template-columns:1fr 1fr;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24))}',
      '.git-panel-sbs-column{padding:3px 9px;font-family:inherit;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-sbs-hunk{padding:3px 9px;color:var(--dsw-alias-brand-primary,#0969da);background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}',
      '.git-panel-sbs-row{display:grid;grid-template-columns:44px minmax(0,1fr) 44px minmax(0,1fr)}',
      '.git-panel-sbs-no{padding:0 6px;text-align:right;color:var(--dsw-alias-label-secondary,#57606a);opacity:.7;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));user-select:none}',
      '.git-panel-sbs-cell{padding:0 9px;white-space:pre-wrap;word-break:break-word;min-width:0}',
      '.git-panel-sbs-del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#cf222e) 14%,transparent);color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-sbs-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 14%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-sbs-blank{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.09))}',
      '.git-panel-ctx{position:fixed;z-index:90;min-width:230px;padding:4px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 8px 28px rgba(0,0,0,.24);display:flex;flex-direction:column;gap:1px}',
      '.git-panel-ctx-head{padding:4px 8px 5px;font-size:11px;color:var(--dsw-alias-label-secondary,#57606a);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));margin-bottom:3px;word-break:break-all}',
      '.git-panel-ctx-item{display:flex;align-items:center;gap:6px;width:100%;padding:4px 8px;border:0;border-radius:4px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.git-panel-ctx-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16))}',
      '.git-panel-ctx-item:disabled{opacity:.5;cursor:default}',
      '.git-panel-ctx-sep{height:1px;margin:3px 0;background:var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-scrim{position:fixed;inset:0;z-index:89}',
      '.git-panel-dialog{position:fixed;z-index:91;top:50%;left:50%;transform:translate(-50%,-50%);width:min(360px,90vw);display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 12px 44px rgba(0,0,0,.3)}',
      '.git-panel-dialog-title{font-weight:600}',
      '.git-panel-dialog-actions{display:flex;justify-content:flex-end;gap:7px}',
      '.git-panel-modal{position:fixed;z-index:91;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1180px,94vw);height:min(760px,88vh);display:flex;flex-direction:column;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 12px 44px rgba(0,0,0,.3);overflow:hidden}',
      '.git-panel-modal-head{flex:none;display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-modal-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git-panel-modal-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.git-panel-launch{display:flex;flex-direction:column;gap:10px;padding:14px}',
      '.git-panel-launch-title{font-weight:600;font-size:13px}',
      '.git-panel-launch-text{color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-launch-icon{color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-launch-actions{display:flex;margin-top:2px}',
      // The configuration card mirrors the built-in settings pages: each group is
      // a section with its own heading, and the controls are the shared field and
      // switch primitives, whose own stylesheet the framework supplies.
      '.git-panel-config-section{min-width:0;padding:16px 0}',
      '.git-panel-config-heading{margin:0;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.git-panel-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:16px}',
      '.git-panel-config-toggle{display:grid;gap:6px;padding:12px 0}',
      '.git-panel-config-toggle-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.git-panel-config-toggle-label{display:flex;align-items:center;gap:4px;flex:1;min-width:0}',
      '.git-panel-config-badges{display:inline-flex;flex:none;align-items:center;gap:8px}',
      '.git-panel-config-reset{padding:0;border:0;background:none;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#57606a);cursor:pointer}',
      '.git-panel-config-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary,#1f2328)}',
      '.git-panel-config-reset:disabled{cursor:default}',
      // The switch's info button and its disclosure copy the shared field's own
      // rules, so both settings show the same control with the same type.
      '.git-panel-config-help-button{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-tertiary,#8b949e);cursor:pointer}',
      '.git-panel-config-help-button:hover,.git-panel-config-help-button[aria-expanded="true"]{background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.1));color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-config-help-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0969da);outline-offset:1px}',
      '.git-panel-config-help{padding:10px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-config-help>p{margin:0}',
      '.git-panel-config-help>p+p{margin-top:8px}',
    ].join('\n')

    /**
     * The inline stylesheet.
     *
     * @returns {object} the style element.
     */
    function StyleTag() {
      return h('style', null, STYLES)
    }

    /** The Git glyph path, shared by the rail, the guide capsule and the launcher. */
    const GIT_PATH =
      'M5.5 1a2.5 2.5 0 0 0-1 4.79V10.2a2.5 2.5 0 1 0 1 0V5.79A2.5 2.5 0 0 0 5.5 1Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm0 9.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm5.75-8.5a2.5 2.5 0 0 0-1 4.79v.46a3.25 3.25 0 0 1-3.25 3.25h-.4a2.5 2.5 0 1 0 0 1.5h.4a4.75 4.75 0 0 0 4.75-4.75v-.46a2.5 2.5 0 0 0-1-4.79Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z'

    /**
     * The Git glyph.
     *
     * @param {object} props - icon props.
     * @returns {object} the svg element.
     */
    function GitGlyph({ size = 16 }) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, fill: 'currentColor' },
        h('path', { d: GIT_PATH }),
      )
    }

    /**
     * One pointer context menu.
     *
     * @param {object} props - menu inputs.
     * @returns {object} the menu element.
     */
    function ContextMenu({ menu, onClose }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const width = 230
      const height = 34 + menu.items.length * 26
      const left = Math.max(6, Math.min(menu.x, window.innerWidth - width - 8))
      const top = Math.max(6, Math.min(menu.y, Math.max(6, window.innerHeight - height - 8)))

      return h(
        React.Fragment,
        null,
        h('div', { className: 'git-panel-scrim', onClick: onClose, onContextMenu: (event) => { event.preventDefault(); onClose() } }),
        h(
          'div',
          { className: 'git-panel-ctx', style: { left, top } },
          h('div', { className: 'git-panel-ctx-head' }, menu.title),
          menu.items.map((item, index) =>
            item.separator === true
              ? h('div', { key: `sep-${index}`, className: 'git-panel-ctx-sep' })
              : h(
                  'button',
                  {
                    key: `${item.label}-${index}`,
                    type: 'button',
                    className: 'git-panel-ctx-item',
                    disabled: item.disabled === true,
                    title: item.title,
                    onClick: () => {
                      onClose()
                      item.run()
                    },
                  },
                  item.label,
                ),
          ),
        ),
      )
    }

    /**
     * A confirmation or single-field dialog.
     *
     * @param {object} props - dialog inputs.
     * @returns {object} the dialog element.
     */
    function Dialog({ dialog, onClose, t = boundTranslate }) {
      const [value, setValue] = React.useState(dialog.input ?? '')
      return h(
        React.Fragment,
        null,
        h('div', { className: 'git-panel-scrim', onClick: onClose }),
        h(
          'div',
          { className: 'git-panel-dialog' },
          h('div', { className: 'git-panel-dialog-title' }, dialog.title),
          dialog.text === undefined ? null : h('div', { className: cx('git-panel-mono', 'git-panel-detail-body') }, dialog.text),
          dialog.warning === undefined ? null : h('div', { className: cx('git-panel-banner', 'git-panel-banner-error'), style: { margin: 0 } }, dialog.warning),
          dialog.input === undefined
            ? null
            : h('textarea', { className: 'git-panel-textarea', value, autoFocus: true, onChange: (event) => setValue(event.target.value) }),
          h(
            'div',
            { className: 'git-panel-dialog-actions' },
            h('button', { type: 'button', className: 'git-panel-btn', onClick: onClose }, t('cancel')),
            h('button', { type: 'button', className: cx('git-panel-btn', 'git-panel-btn-primary'), onClick: () => { onClose(); dialog.run(value) } }, dialog.confirm ?? t('ok')),
          ),
        ),
      )
    }

    /**
     * Parse one unified diff into the rows a side-by-side view renders.
     *
     * A hunk's deletions and additions are buffered and paired in order, so the
     * old line sits beside the line that replaced it; a context line occupies
     * both sides. Anything past `MAX_DIFF_ROWS` is dropped and reported, so one
     * enormous generated file cannot freeze the tab.
     *
     * @param {string} text - the unified diff.
     * @returns {{ head: Array<string>, hunks: Array<object>, added: number, removed: number, binary: boolean, truncated: boolean }} the parsed diff.
     */
    function parseUnifiedDiff(text) {
      const head = []
      const hunks = []
      let pendingRemoved = []
      let pendingAdded = []
      let hunk = null
      let left = 0
      let right = 0
      let rows = 0
      let added = 0
      let removed = 0
      let binary = false
      let truncated = false

      /**
       * Append one row while the cap allows it.
       *
       * @param {object|null} old - `{ no, text }` for the old side.
       * @param {object|null} current - `{ no, text }` for the new side.
       * @param {string} kind - `context`, `change`, `del`, or `add`.
       * @returns {boolean} whether the row was kept.
       */
      const push = (old, current, kind) => {
        if (hunk === null) return false
        if (rows >= MAX_DIFF_ROWS) {
          truncated = true
          return false
        }
        hunk.rows.push({
          kind,
          leftNo: old === null ? null : old.no,
          left: old === null ? null : old.text,
          rightNo: current === null ? null : current.no,
          right: current === null ? null : current.text,
        })
        rows += 1
        return true
      }

      /** Pair the buffered deletions with the additions that replaced them. */
      const flush = () => {
        const count = Math.max(pendingRemoved.length, pendingAdded.length)
        for (let index = 0; index < count && !truncated; index += 1) {
          const old = pendingRemoved[index] ?? null
          const current = pendingAdded[index] ?? null
          const kind = old === null ? 'add' : current === null ? 'del' : 'change'
          push(old, current, kind)
        }
        pendingRemoved = []
        pendingAdded = []
      }

      for (const line of String(text ?? '').split('\n')) {
        if (binary || truncated) break
        const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        if (hunkHeader !== null) {
          flush()
          left = Number(hunkHeader[1])
          right = Number(hunkHeader[2])
          hunk = { header: line, rows: [] }
          hunks.push(hunk)
          continue
        }
        if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
          binary = true
          continue
        }
        if (hunk === null) {
          if (line.trim() === '' || line.startsWith('\u0000')) continue
          head.push(line)
          continue
        }
        if (line.startsWith('\\')) continue
        if (line.startsWith('-')) {
          removed += 1
          pendingRemoved.push({ no: left, text: line.slice(1) })
          left += 1
          continue
        }
        if (line.startsWith('+')) {
          added += 1
          pendingAdded.push({ no: right, text: line.slice(1) })
          right += 1
          continue
        }
        if (line.startsWith(' ')) {
          flush()
          push({ no: left, text: line.slice(1) }, { no: right, text: line.slice(1) }, 'context')
          left += 1
          right += 1
        }
      }
      flush()
      return { head, hunks, added, removed, binary, truncated }
    }

    /**
     * The contiguous changed regions of a parsed diff, in reading order.
     *
     * A run is one or more adjacent non-context rows. Each run records where it
     * starts among the rendered rows, so the overview ruler can place it in
     * proportion to the whole diff, and the key of the row a click should reveal.
     *
     * @param {Array<object>} hunks - the parsed hunks.
     * @returns {{ runs: Array<object>, total: number }} the runs and the rendered row count.
     */
    function changeRunsOf(hunks) {
      const runs = []
      let open = false
      let row = 1 // The sticky column header is the first rendered row.
      hunks.forEach((hunk, hunkIndex) => {
        open = false
        row += 1 // The hunk header.
        hunk.rows.forEach((entry, rowIndex) => {
          if (entry.kind === 'context') {
            open = false
            row += 1
            return
          }
          if (open) {
            runs[runs.length - 1].count += 1
            row += 1
            return
          }
          open = true
          const line = entry.rightNo ?? entry.leftNo
          runs.push({
            key: `${hunkIndex}-${rowIndex}`,
            kind: entry.kind === 'add' ? 'add' : entry.kind === 'del' ? 'del' : 'change',
            line,
            label: line === null ? '+' : String(line),
            count: 1,
            start: row,
          })
          row += 1
        })
      })
      return { runs, total: row }
    }

    /**
     * Render one unified diff as two aligned columns with line numbers.
     *
     * Three navigation aids mirror an IDE diff: a sticky rail beside the line
     * numbers with previous/next controls, a proportional overview ruler that
     * places every change where it sits in the diff and shows the visible range,
     * and click-to-jump on both. In whole-file mode the diff also carries the
     * entire file on both sides; the compact default keeps the context short.
     *
     * @param {object} props - the diff text and the translate function.
     * @returns {object} the side-by-side element.
     */
    function SideBySideDiff({ text, t = boundTranslate }) {
      const parsed = React.useMemo(() => parseUnifiedDiff(text), [text])
      const geometry = React.useMemo(() => changeRunsOf(parsed.hunks), [parsed])
      const runs = geometry.runs
      const anchors = React.useRef({})
      const scrollRef = React.useRef(null)
      const [current, setCurrent] = React.useState(-1)
      const [viewport, setViewport] = React.useState({ top: 0, height: 1 })

      /**
       * Measure the scroll viewport so the ruler shows the visible range.
       *
       * @returns {undefined} nothing.
       */
      const measure = () => {
        const element = scrollRef.current
        if (element === null || element === undefined) return
        const span = element.scrollHeight
        if (!Number.isFinite(span) || span <= 0) return
        setViewport({ top: element.scrollTop / span, height: Math.min(1, element.clientHeight / span) })
      }

      React.useEffect(() => {
        measure()
      }, [text])

      /**
       * Scroll to the fraction of the diff the pointer landed on.
       *
       * @param {object} event - the ruler click.
       * @returns {undefined} nothing.
       */
      const scrollToFraction = (event) => {
        const element = scrollRef.current
        const rect = typeof event?.currentTarget?.getBoundingClientRect === 'function' ? event.currentTarget.getBoundingClientRect() : undefined
        if (element === null || element === undefined || rect === undefined || rect.height === 0) return
        const fraction = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
        const scrollable = element.scrollHeight - element.clientHeight
        if (scrollable > 0) element.scrollTop = fraction * scrollable
      }

      /**
       * Build the ref callback that records one row's element under its key.
       *
       * @param {string} key - the row's hunk-row key.
       * @returns {Function} the ref callback.
       */
      const anchorFor = (key) => (element) => {
        if (element === null || element === undefined) delete anchors.current[key]
        else anchors.current[key] = element
      }

      /**
       * Reveal one change run and remember it as the current one.
       *
       * @param {number} index - the run's position.
       * @returns {undefined} nothing.
       */
      const jumpTo = (index) => {
        const run = runs[index]
        if (run === undefined) return
        setCurrent(index)
        const element = anchors.current[run.key]
        if (element !== undefined && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }

      if (parsed.binary) return h('div', { className: 'git-panel-empty' }, t('diff.binary'))
      if (parsed.hunks.length === 0) return h('div', { className: 'git-panel-empty' }, t('diff.empty'))
      const rail =
        runs.length === 0
          ? null
          : h(
              'div',
              { className: 'git-panel-sbs-nav', 'aria-label': t('diff.changes') },
              h(
                'div',
                { className: 'git-panel-sbs-nav-head' },
                h('button', { type: 'button', className: 'git-panel-sbs-nav-step', disabled: current <= 0, title: t('diff.prev'), onClick: () => jumpTo(current > 0 ? current - 1 : 0) }, UP),
                h('span', { className: 'git-panel-sbs-nav-count' }, `${current < 0 ? DASH : current + 1}/${runs.length}`),
                h('button', { type: 'button', className: 'git-panel-sbs-nav-step', disabled: current >= runs.length - 1, title: t('diff.next'), onClick: () => jumpTo(current < 0 ? 0 : current + 1) }, DOWN),
              ),
              runs.map((run, index) =>
                h(
                  'button',
                  {
                    key: `nav-${index}`,
                    type: 'button',
                    className: cx('git-panel-sbs-nav-item', index === current ? 'git-panel-sbs-nav-current' : false, `git-panel-sbs-nav-${run.kind}`),
                    title: fill(t('diff.jump'), { line: run.label }),
                    onClick: () => jumpTo(index),
                  },
                  run.label,
                ),
              ),
            )
      const overview =
        runs.length === 0
          ? null
          : h(
              'div',
              { className: 'git-panel-sbs-overview', 'aria-label': t('diff.changes'), title: t('diff.changes'), onClick: scrollToFraction },
              h('div', { className: 'git-panel-sbs-overview-view', style: { top: `${viewport.top * 100}%`, height: `${viewport.height * 100}%` } }),
              runs.map((run, index) =>
                h('button', {
                  key: `mark-${index}`,
                  type: 'button',
                  className: cx('git-panel-sbs-mark', `git-panel-sbs-mark-${run.kind}`, index === current ? 'git-panel-sbs-mark-current' : false),
                  style: { top: `${((run.start - 1) / geometry.total) * 100}%`, height: `${(run.count / geometry.total) * 100}%` },
                  title: fill(t('diff.jump'), { line: run.label }),
                  onClick: (event) => {
                    event.stopPropagation()
                    jumpTo(index)
                  },
                }),
              ),
            )
      return h(
        'div',
        { className: 'git-panel-sbs-layout' },
        h(
          'div',
          { className: 'git-panel-sbs-scroll', ref: scrollRef, onScroll: measure },
          h(
            'div',
            { className: 'git-panel-sbs-wrap' },
            rail,
            h(
              'div',
              { className: 'git-panel-sbs' },
              h(
                'div',
                { className: 'git-panel-sbs-columns' },
                h('span', { className: 'git-panel-sbs-column' }, t('diff.before')),
                h('span', { className: 'git-panel-sbs-column' }, t('diff.after')),
              ),
              parsed.hunks.map((hunk, hunkIndex) =>
                h(
                  'div',
                  { key: `hunk-${hunkIndex}` },
                  h('div', { className: 'git-panel-sbs-hunk' }, hunk.header),
                  hunk.rows.map((row, rowIndex) =>
                    h(
                      'div',
                      { key: `row-${hunkIndex}-${rowIndex}`, className: 'git-panel-sbs-row', ref: anchorFor(`${hunkIndex}-${rowIndex}`) },
                      h('span', { className: 'git-panel-sbs-no' }, row.leftNo === null ? '' : String(row.leftNo)),
                      h(
                        'span',
                        { className: cx('git-panel-sbs-cell', row.left === null ? 'git-panel-sbs-blank' : row.kind === 'change' || row.kind === 'del' ? 'git-panel-sbs-del' : false) },
                        row.left === null ? '' : row.left,
                      ),
                      h('span', { className: 'git-panel-sbs-no' }, row.rightNo === null ? '' : String(row.rightNo)),
                      h(
                        'span',
                        { className: cx('git-panel-sbs-cell', row.right === null ? 'git-panel-sbs-blank' : row.kind === 'change' || row.kind === 'add' ? 'git-panel-sbs-add' : false) },
                        row.right === null ? '' : row.right,
                      ),
                    ),
                  ),
                ),
              ),
              parsed.truncated ? h('div', { className: 'git-panel-empty' }, fill(t('diff.truncated'), { count: MAX_DIFF_ROWS })) : null,
            ),
          ),
        ),
        overview,
      )
    }

    /**
     * One changed-path row.
     *
     * @param {object} props - row inputs.
     * @returns {object} the row element.
     */
    function ChangeRow({ file, busy, selected, picked, onToggle, onSelect, onOpen, onContextMenu, t = boundTranslate }) {
      return h(
        'div',
        {
          className: cx('git-panel-row', selected ? 'git-panel-row-sel' : false),
          title: file.path,
          onClick: () => onSelect(file),
          onDoubleClick: () => {
            if (typeof onOpen === 'function') onOpen(file)
          },
          onContextMenu: (event) => {
            event.preventDefault()
            onContextMenu(event, file)
          },
        },
        h('input', {
          type: 'checkbox',
          className: 'git-panel-check',
          checked: picked === true,
          disabled: busy,
          title: t('selectFile'),
          onClick: (event) => event.stopPropagation(),
          onChange: () => onToggle(file),
        }),
        h('span', { className: cx('git-panel-status', `git-panel-status-${statusText(file.status)}`) }, statusText(file.status)),
        h('span', { className: 'git-panel-branch' }, basename(file.path)),
        file.staged === true ? h('span', { className: 'git-panel-chip', title: t('staged') }, t('staged')) : null,
        h(
          'span',
          { className: 'git-panel-numstat' },
          file.added > 0 ? h('span', { className: 'git-panel-plus' }, `+${file.added}`) : null,
          file.removed > 0 ? h('span', { className: 'git-panel-minus' }, `-${file.removed}`) : null,
        ),
      )
    }

    /**
     * One branch row.
     *
     * @param {object} props - row inputs.
     * @returns {object} the row element.
     */
    function BranchRow({ branch, remote, busy, onCheckout, onContextMenu }) {
      const remoteName = remote ? branch.name.split('/')[0] : null
      return h(
        'div',
        {
          className: cx('git-panel-row', branch.current ? 'git-panel-row-sel' : false),
          title: branch.upstream === null ? branch.name : `${branch.name} ${ARROW} ${branch.upstream}`,
          onDoubleClick: () => {
            if (branch.current) return
            onCheckout(remote ? { name: branch.name.replace(/^[^/]+\//, ''), create: true, startPoint: branch.name } : { name: branch.name })
          },
          onContextMenu: (event) => {
            event.preventDefault()
            onContextMenu(event, branch, remote)
          },
        },
        branch.current ? h('span', { className: 'git-panel-tag' }, 'HEAD') : h('span', { className: 'git-panel-status', style: { opacity: 0.45 } }, BRANCH_GLYPH),
        h('span', { className: 'git-panel-branch' }, remote ? branch.name.replace(/^[^/]+\//, '') : branch.name),
        remoteName === null ? null : h('span', { className: 'git-panel-chip' }, remoteName),
        branch.current || busy ? null : h('span', { className: 'git-panel-count' }, ENTER_GLYPH),
      )
    }

    /**
     * One commit row.
     *
     * @param {object} props - row inputs.
     * @returns {object} the row element.
     */
    function CommitRow({ commit, selected, onSelect, onContextMenu, t = boundTranslate }) {
      return h(
        'div',
        {
          className: cx('git-panel-row', selected ? 'git-panel-row-sel' : false),
          onClick: () => onSelect(commit),
          onContextMenu: (event) => {
            event.preventDefault()
            onSelect(commit)
            onContextMenu(event, commit)
          },
        },
        h('span', { className: cx('git-panel-status', 'git-panel-mono'), style: { width: 'auto', opacity: 0.7, fontSize: 10.5 } }, commit.short),
        h(
          'div',
          { className: 'git-panel-commit' },
          h('div', { className: 'git-panel-commit-top' }, h('span', { className: 'git-panel-subject' }, commit.subject || t('noMessage'))),
          h(
            'div',
            { className: 'git-panel-meta' },
            h('span', null, commit.author || 'unknown'),
            h('span', null, relativeAge(commit.timestamp) === '' ? '' : `${relativeAge(commit.timestamp)} ago`),
          ),
        ),
        commit.refs.length === 0 ? null : h('span', { className: 'git-panel-chip' }, commit.refs[0].replace('HEAD -> ', '').replace('tag: ', '')),
      )
    }

    /**
     * A collapsible group header.
     *
     * @param {object} props - group inputs.
     * @returns {object} the header element.
     */
    function GroupHead({ label, count, open, onToggle, actions }) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center' } },
        h(
          'button',
          { type: 'button', className: 'git-panel-group', onClick: onToggle, 'aria-expanded': open },
          h('span', { className: 'git-panel-caret' }, open ? CARET_OPEN : CARET_CLOSED),
          h('span', { className: 'git-panel-pane-title', style: { textTransform: 'none' } }, label),
          typeof count === 'number' ? h('span', { className: 'git-panel-count' }, String(count)) : null,
        ),
        actions === undefined ? null : h('div', { style: { display: 'flex', gap: 4, paddingRight: 9 } }, actions),
      )
    }

    /**
     * The modal diff viewer: one file at a time, side by side.
     *
     * The content follows the current selection, so picking another row while
     * the modal is open swaps the diff; Escape, the scrim, or the close control
     * dismisses it. An empty diff for a commit says which part is out of date: a
     * Host that predates commit-aware diffs answers every commit file with an
     * empty worktree diff, which must not read as "this commit changed nothing".
     *
     * @param {object} props - the selected file, its diff, the owning commit, whether the Host is older, whether the whole file is shown, and close.
     * @returns {object} the modal element.
     */
    function DiffModal({ file, commit, text, stale, whole, onClose, t = boundTranslate }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      const empty = text !== null && String(text).trim() === ''
      const body =
        text === null
          ? h('div', { className: 'git-panel-empty' }, t('loading'))
          : empty && stale === true && commit !== null
            ? h('div', { className: cx('git-panel-banner', 'git-panel-banner-warn'), style: { margin: 10 } }, t('notice.staleHost'))
            : h(SideBySideDiff, { text, t })
      return h(
        React.Fragment,
        null,
        h('div', { className: 'git-panel-scrim', onClick: onClose }),
        h(
          'div',
          { className: 'git-panel-modal' },
          h(
            'div',
            { className: 'git-panel-modal-head' },
            h('span', { className: 'git-panel-modal-title', title: file.path }, basename(file.path)),
            h('span', { className: 'git-panel-sub', title: file.path }, file.path),
            h('span', { className: 'git-panel-chip' }, commit === null ? t('diff.working') : fill(t('diff.committed'), { short: commit.short })),
            whole === true ? h('span', { className: 'git-panel-chip' }, t('diff.whole')) : null,
            h('span', { className: 'git-panel-spacer' }),
            h('button', { type: 'button', className: 'git-panel-btn', onClick: onClose, title: t('close') }, CLOSE_GLYPH),
          ),
          h('div', { className: 'git-panel-modal-body' }, body),
        ),
      )
    }

    /**
     * The two paragraphs every settings explanation is made of.
     *
     * The first says what the setting does; the second states its bounds and
     * what turning it on costs. Both fields use it, so their disclosures read
     * the same whether the primitive draws them or the card does.
     *
     * @param {string} body - what the setting does.
     * @param {string} note - its bounds and its cost.
     * @returns {object} the disclosure's content.
     */
    function helpParagraphs(body, note) {
      return h(React.Fragment, null, h('p', null, body), h('p', null, note))
    }

    /**
     * The Git plugin's configuration card.
     *
     * The Plugins page renders a bundle's own configuration on that bundle's
     * page, keyed by the package name, between its description and its rows — so
     * this is what opening `GitPanel` in the installed group shows. The body
     * is the shared settings form: it stages what the user types and writes it
     * only on save, which is the page's own contract — the plugin never commits
     * a value the user did not confirm.
     *
     * The controls are the shared ones the built-in settings pages use — the
     * value field for the depth and the switch in a label row for the boolean —
     * so this card reads as one more page of the same settings surface rather
     * than a hand-drawn form.
     *
     * @param {object} props - the form snapshot and the form actions.
     * @returns {object} the form.
     */
    function GitSettingsCard(props) {
      const { t } = props
      const state = props.useGitSettings((snapshot) => snapshot)
      const [wholeFileHelp, setWholeFileHelp] = React.useState(false)
      const [filePreviewHelp, setFilePreviewHelp] = React.useState(false)
      // A cleared draft inherits the composition default (off), so the switch
      // previews the value a save would leave rather than the raw draft text.
      const wholeFile = state[WHOLE_FILE_FIELD].text === 'true'
      // This field's composition default is the reverse: a cleared draft means
      // the repair is on, so only the literal `false` reads as off.
      const filePreview = state[FILE_PREVIEW_FIELD].text !== 'false'
      return h(
        primitives.SettingsForm,
        {
          labels: {
            unavailable: t('settings.unavailable'),
            readOnly: t('settings.readOnly'),
            saveFailed: t('settings.saveFailed'),
            save: t('settings.save'),
            saving: t('settings.saving'),
          },
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        // This card is a separate mount from the panel and the tab door, so it
        // carries its own copy of the token-only stylesheet: without it none of
        // the `git-panel-config-*` rules apply here and the card falls back to
        // the surrounding page's type, which is exactly what made the two
        // explanations disagree.
        h(StyleTag, null),
        h(
          'section',
          { className: 'git-panel-config-section', 'aria-labelledby': DISCOVERY_SECTION_ID },
          h('h3', { className: 'git-panel-config-heading', id: DISCOVERY_SECTION_ID }, t('config.discovery')),
          h(
            'div',
            { className: 'git-panel-config-grid' },
            h(primitives.SettingsValueField, {
              id: DEPTH_INPUT_ID,
              label: t('depth'),
              // The explanation lives behind the info button beside the label,
              // the way the built-in settings pages disclose a field's rules.
              help: { label: t('depth.help'), content: helpParagraphs(t('depth.help.body'), t('depth.help.note')) },
              overriddenLabel: t('settings.overridden'),
              resetLabel: t('settings.reset'),
              invalidLabel: t('settings.invalidNumber'),
              numeric: true,
              disabled: state.writable !== true,
              text: state[DEPTH_FIELD].text,
              overridden: state[DEPTH_FIELD].overridden,
              invalid: state[DEPTH_FIELD].invalid,
              onEdit: (text) => props.edit(DEPTH_FIELD, text),
              onReset: () => props.resetField(DEPTH_FIELD),
            }),
          ),
        ),
        h(
          'section',
          { className: 'git-panel-config-section', 'aria-labelledby': DISPLAY_SECTION_ID },
          h('h3', { className: 'git-panel-config-heading', id: DISPLAY_SECTION_ID }, t('config.display')),
          h(
            'div',
            { className: 'git-panel-config-toggle' },
            h(
              'div',
              { className: 'git-panel-config-toggle-row' },
              h(
                'div',
                { className: 'git-panel-config-toggle-label' },
                h('span', null, t('wholeFileDiff')),
                // A switch has no field primitive to draw its info button, so
                // it is mirrored here: both settings disclose their rules the
                // same way, in the same place, with the same type.
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'git-panel-config-help-button',
                    'aria-label': t('wholeFileDiff.help'),
                    'aria-expanded': wholeFileHelp,
                    'aria-controls': WHOLE_FILE_HELP_ID,
                    onClick: () => setWholeFileHelp(wholeFileHelp !== true),
                  },
                  h(primitives.IconInfoOutlineRegular, { size: 12 }),
                ),
              ),
              state[WHOLE_FILE_FIELD].overridden
                ? h(
                    'span',
                    { className: 'git-panel-config-badges' },
                    h(primitives.Tag, { tone: 'neutral' }, t('settings.overridden')),
                    h('button', { type: 'button', className: 'git-panel-config-reset', disabled: state.writable !== true, onClick: () => props.resetField(WHOLE_FILE_FIELD) }, t('settings.reset')),
                  )
                : null,
              h(primitives.Switch, {
                checked: wholeFile,
                label: t('wholeFileDiff'),
                disabled: state.writable !== true,
                onChange: (next) => props.edit(WHOLE_FILE_FIELD, next === true ? 'true' : 'false'),
              }),
            ),
            wholeFileHelp === true
              ? h(
                  'div',
                  { id: WHOLE_FILE_HELP_ID, className: 'git-panel-config-help', role: 'region', 'aria-label': t('wholeFileDiff.help') },
                  helpParagraphs(t('wholeFileDiff.help.body'), t('wholeFileDiff.help.note')),
                )
              : null,
          ),
        ),
        h(
          'section',
          { className: 'git-panel-config-section', 'aria-labelledby': FILE_PREVIEW_SECTION_ID },
          h('h3', { className: 'git-panel-config-heading', id: FILE_PREVIEW_SECTION_ID }, t('config.preview')),
          h(
            'div',
            { className: 'git-panel-config-toggle' },
            h(
              'div',
              { className: 'git-panel-config-toggle-row' },
              h(
                'div',
                { className: 'git-panel-config-toggle-label' },
                h('span', null, t('filePreviewFix')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'git-panel-config-help-button',
                    'aria-label': t('filePreviewFix.help'),
                    'aria-expanded': filePreviewHelp,
                    'aria-controls': FILE_PREVIEW_HELP_ID,
                    onClick: () => setFilePreviewHelp(filePreviewHelp !== true),
                  },
                  h(primitives.IconInfoOutlineRegular, { size: 12 }),
                ),
              ),
              state[FILE_PREVIEW_FIELD].overridden
                ? h(
                    'span',
                    { className: 'git-panel-config-badges' },
                    h(primitives.Tag, { tone: 'neutral' }, t('settings.overridden')),
                    h('button', { type: 'button', className: 'git-panel-config-reset', disabled: state.writable !== true, onClick: () => props.resetField(FILE_PREVIEW_FIELD) }, t('settings.reset')),
                  )
                : null,
              h(primitives.Switch, {
                checked: filePreview,
                label: t('filePreviewFix'),
                disabled: state.writable !== true,
                onChange: (next) => props.edit(FILE_PREVIEW_FIELD, next === true ? 'true' : 'false'),
              }),
            ),
            filePreviewHelp === true
              ? h(
                  'div',
                  { id: FILE_PREVIEW_HELP_ID, className: 'git-panel-config-help', role: 'region', 'aria-label': t('filePreviewFix.help') },
                  helpParagraphs(t('filePreviewFix.help.body'), t('filePreviewFix.help.note')),
                )
              : null,
          ),
        ),
      )
    }

    /**
     * Build the Plugins page card's staged form over this plugin's settings.
     *
     * @param {object} configForms - the client configuration-form service.
     * @returns {{ inject: Function, dispose: Function }} the card's slot face and its disposer.
     */
    function createSettingsCard(configForms) {
      const form = new primitives.SettingsFormModel(configForms.get(SETTINGS_NS), [primitives.settingsNumberField(DEPTH_FIELD), WHOLE_FILE_SPEC, FILE_PREVIEW_SPEC])
      const store = form.bind(() => ({
        ...form.shell(),
        [DEPTH_FIELD]: form.field(DEPTH_FIELD),
        [WHOLE_FILE_FIELD]: form.field(WHOLE_FILE_FIELD),
        [FILE_PREVIEW_FIELD]: form.field(FILE_PREVIEW_FIELD),
      }))
      return {
        /**
         * The face the card's slot registration injects.
         *
         * @returns {object} the snapshot hook the card reads and the form actions.
         */
        inject() {
          return { hooks: { gitSettings: store }, ...form.actions() }
        },
        /** Release the form's subscription to the settings document. */
        dispose() {
          form.dispose()
        },
      }
    }

    /**
     * The Git tool: the full-page main panel.
     *
     * @param {object} props - framework standard props.
     * @returns {object} the tool element.
     */
    function GitPanel({ useWorkspaces, useSessions, t = boundTranslate }) {
      const workspaces = useWorkspaces((snapshot) => snapshot.items)
      const sessions = useSessions((snapshot) => snapshot)
      const mainSessionId = React.useMemo(() => mainSessionIdOf(sessions), [sessions])
      // The current Session's workspace: its owning workspace wins (workspace
      // sessions carry no cwd); the raw session cwd is the fallback.
      const cwd = React.useMemo(() => {
        if (mainSessionId === undefined) return undefined
        const owner = (workspaces ?? []).find((entry) => Array.isArray(entry.sessionIds) && entry.sessionIds.includes(mainSessionId))
        if (owner !== undefined && typeof owner.path === 'string' && owner.path !== '') return owner.path
        const row = sessions?.byId?.[mainSessionId]
        const sessionCwd = typeof row?.cwd === 'string' && row.cwd !== '' ? row.cwd : undefined
        if (sessionCwd === undefined) return undefined
        // A session opened in a workspace subdirectory still belongs to that
        // workspace: match the cwd exactly, then by path containment.
        const exact = (workspaces ?? []).find((entry) => entry.path === sessionCwd)
        if (exact !== undefined) return exact.path
        const base = sessionCwd.toLowerCase()
        const contained = (workspaces ?? []).find((entry) => {
          if (typeof entry.path !== 'string' || entry.path === '') return false
          const root = entry.path.toLowerCase().replace(/[\\/]+$/, '')
          return base === root || base.startsWith(`${root}\\`) || base.startsWith(`${root}/`)
        })
        // No workspace owns the session directory: offer the directory itself.
        return contained !== undefined ? contained.path : sessionCwd
      }, [mainSessionId, workspaces, sessions])

      const [followedSession, setFollowedSession] = React.useState(undefined)
      const [workspaceOverride, setWorkspaceOverride] = React.useState(null)
      const [repositories, setRepositories] = React.useState([])
      const [repositoriesRoot, setRepositoriesRoot] = React.useState(null)
      const [repoOverride, setRepoOverride] = React.useState(null)
      const [state, setState] = React.useState(null)
      const [commits, setCommits] = React.useState([])
      const [selectedCommit, setSelectedCommit] = React.useState(null)
      const [commitFiles, setCommitFiles] = React.useState([])
      const [filesLoading, setFilesLoading] = React.useState(false)
      const [filesError, setFilesError] = React.useState(null)
      const [selectedFile, setSelectedFile] = React.useState(null)
      const [diff, setDiff] = React.useState(null)
      const [diffOpen, setDiffOpen] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [reposLoading, setReposLoading] = React.useState(false)
      const [stateLoading, setStateLoading] = React.useState(false)
      const [logLoading, setLogLoading] = React.useState(false)
      const [reposToken, setReposToken] = React.useState(0)
      const [stateToken, setStateToken] = React.useState(0)
      const [logToken, setLogToken] = React.useState(0)
      const [wholeFileDiff, setWholeFileDiff] = React.useState(false)
      const [selectedPaths, setSelectedPaths] = React.useState(() => new Set())
      const [error, setError] = React.useState(null)
      const [staleHost, setStaleHost] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [menu, setMenu] = React.useState(null)
      const [dialog, setDialog] = React.useState(null)
      const [branchFilter, setBranchFilter] = React.useState('')
      const [groups, setGroups] = React.useState({ local: true, remote: false, submodules: true })

      /**
       * Whether a load the user should see is in flight.
       *
       * Only discovery and the first read of a repository report here. A later
       * state-only reload — what staging a path triggers — stays quiet, so
       * toggling a checkbox never flashes a toolbar spinner.
       */
      const loading = reposLoading || (state === null && (stateLoading || logLoading))

      // The panel follows the conversation: when the main-view Session changes,
      // a stale manual workspace pick must not survive into the new Session.
      React.useEffect(() => {
        if (mainSessionId === followedSession) return undefined
        setFollowedSession(mainSessionId)
        setWorkspaceOverride(null)
        setRepoOverride(null)
        return undefined
      }, [mainSessionId, followedSession])

      // Every workspace is browsable; the session directory is offered too.
      const roots = React.useMemo(() => {
        const list = []
        for (const item of workspaces ?? []) {
          if (typeof item.path === 'string' && item.path !== '') list.push({ path: item.path, title: item.title ?? basename(item.path) })
        }
        if (typeof cwd === 'string' && cwd !== '' && !list.some((entry) => entry.path === cwd)) list.unshift({ path: cwd, title: basename(cwd) })
        return list
      }, [workspaces, cwd])

      // The effective root and repository are derived, so nothing needs an
      // effect to seed them and a stale choice simply falls back. The session's
      // own workspace outranks the first entry the workspace list happens to
      // hold, which is what a click on Git in that workspace expects to see.
      const workspaceRoot = React.useMemo(() => {
        if (typeof workspaceOverride === 'string' && roots.some((entry) => entry.path === workspaceOverride)) return workspaceOverride
        if (typeof cwd === 'string' && cwd !== '' && roots.some((entry) => entry.path === cwd)) return cwd
        return roots.length === 0 ? null : roots[0].path
      }, [roots, workspaceOverride, cwd])

      const repository = React.useMemo(() => {
        // A list fetched for another workspace must never be read through this
        // one: a repository path means something only inside the root it was
        // found under, and pairing it with a different root is exactly what the
        // Host refuses as "outside the workspace root".
        if (repositoriesRoot !== workspaceRoot) return null
        return repositories.find((entry) => entry.path === repoOverride) ?? repositories[0] ?? null      }, [repositories, repositoriesRoot, repoOverride, workspaceRoot])

      /** Whether the repository list in hand was discovered for the workspace in force. */
      const repositoriesLoaded = repositories && repositoriesRoot === workspaceRoot

      /** The repositories of the workspace in force: another root's list is not this one's. */
      const currentRepositories = repositoriesLoaded ? repositories : []

      const workspaceReady = typeof workspaceRoot === 'string' && workspaceRoot !== '' && repository !== null

      /** Reload the selected workspace's repositories, its state, and its history. */
      const refresh = React.useCallback(() => {
        setReposToken((value) => value + 1)
        setStateToken((value) => value + 1)
        setLogToken((value) => value + 1)
      }, [])

      /** Reload only the working tree and branch picture, leaving discovery and history alone. */
      const refreshState = React.useCallback(() => setStateToken((value) => value + 1), [])

      /** Reload only the commit history. */
      const refreshLog = React.useCallback(() => setLogToken((value) => value + 1), [])

      // Discovery is keyed by the workspace alone, so switching repository
      // inside a workspace never walks that workspace again.
      React.useEffect(() => {
        let cancelled = false
        if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
          setRepositories([])
          setRepositoriesRoot(null)
          setReposLoading(false)
          return undefined
        }
        setReposLoading(true)
        setError(null)
        setStaleHost(false)
        callHost('repos', { workspaceRoot })
          .then((payload) => {
            if (cancelled) return
            setRepositories(Array.isArray(payload.repositories) ? payload.repositories : [])
            setRepositoriesRoot(workspaceRoot)
            // The whole-file switch rides the same discovery answer as the
            // depth, so the panel reads the setting the Host has in force.
            setWholeFileDiff(payload.wholeFileDiff === true)
            // `discoveryDepth` and `wholeFileDiff` are part of the current
            // contract: a Host that reports neither serves an older build, and
            // naming that beats letting the user discover it through a failed
            // fetch or an ignored whole-file switch.
            setStaleHost(!Number.isFinite(payload.discoveryDepth) || typeof payload.wholeFileDiff !== 'boolean')
          })
          .catch((failure) => {
            if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
          })
          .finally(() => {
            if (!cancelled) setReposLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [workspaceRoot, reposToken])

      // The selected repository's working-tree picture. A state-scoped mutation
      // reloads only this, so staging a path costs one cheap status read instead
      // of the whole discovery walk and a fresh history page.
      React.useEffect(() => {
        let cancelled = false
        if (repository === null) {
          setState(null)
          setStateLoading(false)
          return undefined
        }
        setStateLoading(true)
        setError(null)
        callHost('state', { workspaceRoot, path: repository.path })
          .then((payload) => {
            if (!cancelled) setState(payload)
          })
          .catch((failure) => {
            if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
          })
          .finally(() => {
            if (!cancelled) setStateLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [repository, workspaceRoot, stateToken])

      // The selected repository's history, read apart from the state so a
      // working-tree toggle never re-reads a page of commits.
      React.useEffect(() => {
        let cancelled = false
        if (repository === null) {
          setCommits([])
          setLogLoading(false)
          return undefined
        }
        setLogLoading(true)
        setError(null)
        callHost('log', { workspaceRoot, path: repository.path, limit: COMMIT_PAGE })
          .then((payload) => {
            if (!cancelled) setCommits(Array.isArray(payload.commits) ? payload.commits : [])
          })
          .catch((failure) => {
            if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
          })
          .finally(() => {
            if (!cancelled) setLogLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [repository, workspaceRoot, logToken])

      // A selection belongs to the repository it was made in.
      React.useEffect(() => {
        setSelectedCommit(null)
        setSelectedFile(null)
        setCommitFiles([])
        setFilesError(null)
        setSelectedPaths(new Set())
      }, [repository?.path, workspaceRoot])

      // A commit's changed paths are read only once that commit is selected.
      React.useEffect(() => {
        let cancelled = false
        if (selectedCommit === null || repository === null) {
          setCommitFiles([])
          setFilesError(null)
          setFilesLoading(false)
          return undefined
        }
        setFilesLoading(true)
        setFilesError(null)
        callHost('commitFiles', { workspaceRoot, path: repository.path, commit: selectedCommit.hash })
          .then((payload) => {
            if (!cancelled) setCommitFiles(Array.isArray(payload.files) ? payload.files : [])
          })
          .catch((failure) => {
            if (cancelled) return
            // A Host that predates this operation still reports each commit's
            // files inside its history page, so the list stays usable.
            const legacy = isStaleHost(failure) && Array.isArray(selectedCommit.files) ? selectedCommit.files : []
            if (isStaleHost(failure)) setStaleHost(true)
            setCommitFiles(legacy)
            setFilesError(legacy.length === 0 ? t('files.failed') : null)
          })
          .finally(() => {
            if (!cancelled) setFilesLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [selectedCommit, repository, workspaceRoot])

      React.useEffect(() => {
        if (notice === null) return undefined
        const timer = window.setTimeout(() => setNotice(null), 4000)
        return () => window.clearTimeout(timer)
      }, [notice])

      // A selected file's diff is read on demand; a commit file reads that
      // commit's own version of the file. A working-tree selection resolves
      // against the current state, so a path staged after it was picked still
      // diffs against the side it now belongs to; a commit selection is left
      // alone because a same-named working-tree row is a different entry.
      const activeFile = React.useMemo(() => {
        if (selectedFile === null) return null
        if (selectedCommit !== null) return selectedFile
        const fresh = (state?.files ?? []).find((entry) => entry.path === selectedFile.path)
        return fresh ?? selectedFile
      }, [selectedFile, selectedCommit, state])
      const activeCommit = selectedCommit
      React.useEffect(() => {
        let cancelled = false
        if (activeFile === null || repository === null) {
          setDiff(null)
          return undefined
        }
        callHost('diff', { workspaceRoot, path: repository.path, file: activeFile.path, staged: activeFile.staged === true, commit: activeCommit?.hash, wholeFile: wholeFileDiff === true })
          .then((payload) => {
            if (!cancelled) setDiff(payload.diff ?? '')
          })
          .catch((failure) => {
            if (!cancelled) setDiff(`(diff unavailable: ${failureText(failure)})`)
          })
        return () => {
          cancelled = true
        }
      }, [activeFile, activeCommit, repository, workspaceRoot, wholeFileDiff])

      /**
       * Run one mutating operation, then reload only what it could have changed.
       *
       * The scope keeps the reload proportional to the operation: staging a path
       * re-reads the working tree alone, while a commit also re-reads history. A
       * workspace rediscovery never follows an ordinary mutation, which is what
       * used to make a checkbox click walk every repository again.
       *
       * @param {string} op - operation name.
       * @param {object} args - operation arguments.
       * @param {string|undefined} success - notice shown on success.
       * @param {'state'|'log'|'full'} [scope] - what to re-read; `full` re-reads working tree and history.
       * @returns {Promise<object|null>} the payload, or null on failure.
       */
      const mutate = React.useCallback(
        async (op, args, success, scope = 'full') => {
          if (repository === null) return null
          setBusy(true)
          setError(null)
          try {
            const payload = await callHost(op, { workspaceRoot, path: repository.path, ...args })
            if (scope === 'state') refreshState()
            else if (scope === 'log') refreshLog()
            else {
              refreshState()
              refreshLog()
            }
            if (success !== undefined) setNotice(success)
            return payload
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
            // An optimistic working-tree patch must not survive a refused
            // operation, so a state-scoped mutation re-reads even on failure.
            if (scope === 'state') refreshState()
            return null
          } finally {
            setBusy(false)
          }
        },
        [repository, workspaceRoot, refreshState, refreshLog],
      )

      const closeMenu = React.useCallback(() => setMenu(null), [])

      /** The working-tree files as the Host last reported them. */
      const files = state?.files ?? NO_FILES

      /**
       * The selected paths that still exist in the working tree.
       *
       * A path can outlive the row that selected it — a commit empties the list
       * while the selection record remains — so the effective selection is
       * intersected with the current rows instead of read off the raw set.
       */
      const pickedPaths = React.useMemo(() => files.filter((file) => selectedPaths.has(file.path)).map((file) => file.path), [files, selectedPaths])

      /**
       * Add or remove one working-tree path from the selection.
       *
       * Selecting is local: the stage and unstage controls are what talk to the
       * Host, so ticking a file costs no round trip at all.
       *
       * @param {object} file - the row that was toggled.
       * @returns {undefined} nothing.
       */
      function togglePicked(file) {
        setSelectedPaths((value) => {
          const next = new Set(value)
          if (next.has(file.path)) next.delete(file.path)
          else next.add(file.path)
          return next
        })
      }

      /**
       * Select every working-tree path, or clear the selection.
       *
       * @param {boolean} next - whether every path should be selected.
       * @returns {undefined} nothing.
       */
      function selectEverything(next) {
        setSelectedPaths(next ? new Set(files.map((file) => file.path)) : new Set())
      }

      /**
       * Stage or unstage the selected paths, then drop the selection.
       *
       * @param {boolean} staged - whether to stage rather than unstage.
       * @returns {undefined} nothing.
       */
      function setSelectedStaged(staged) {
        if (pickedPaths.length === 0) return
        const paths = [...pickedPaths]
        mutate(staged ? 'stage' : 'unstage', { paths }, staged ? t('notice.stagedSelected') : t('notice.unstagedSelected'), 'state').then(
          () => setSelectedPaths(new Set()),
        )
      }

      const branches = state?.branches ?? []
      const remotes = state?.remotes ?? []
      const currentBranch = state?.branch ?? null

      /**
       * Copy text, reporting the outcome.
       *
       * @param {string} text - value to copy.
       * @returns {Promise<void>} nothing.
       */
      async function copyText(text) {
        try {
          await navigator.clipboard.writeText(text)
          setNotice(t('copied'))
        } catch {
          setNotice(text)
        }
      }

      /**
       * Commit the staged changes, optionally staging everything first.
       *
       * @param {boolean} all - whether to stage every change first.
       * @param {boolean} push - whether to publish afterwards.
       * @returns {Promise<void>} nothing.
       */
      async function commit(all, push) {
        const text = message.trim()
        if (text === '') return
        const payload = await mutate('commit', { message: text, all }, undefined)
        if (payload === null) return
        setMessage('')
        const short = String(payload.hash ?? '').slice(0, 8)
        if (!push) {
          setNotice(fill(t('notice.committed'), { short }))
          return
        }
        const pushed = await mutate('push', { remote: state?.remoteNames?.[0] }, undefined, 'state')
        setNotice(pushed === null ? fill(t('notice.committedPushFailed'), { short }) : fill(t('notice.committedPushed'), { short }))
      }

      /**
       * Build the commit context-menu rows.
       *
       * @param {object} commit - the commit under the pointer.
       * @returns {Array<object>} the rows.
       */
      /**
       * Open the diff modal for one file; the modal content follows the
       * selection, so picking another row while it is open swaps the diff.
       *
       * @param {object} entry - the selected file row.
       * @returns {undefined} nothing.
       */
      const openDiff = React.useCallback((entry) => {
        setSelectedFile(entry)
        setDiffOpen(true)
      }, [])

      /**
       * Build the context menu for the selected commit's message block.
       *
       * @param {object} commit - the selected commit.
       * @returns {Array<object>} the rows.
       */
      function commitMessageMenu(commit) {
        const newest = commits[0]?.hash === commit.hash
        const fullMessage = commit.body === '' ? commit.subject : `${commit.subject}\n\n${commit.body}`
        return [
          {
            label: t('menu.editMessage'),
            disabled: !newest,
            title: newest ? undefined : t('amend.newestOnly'),
            run: () => setDialog({ title: t('amend'), input: fullMessage, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
          },
          { label: t('copyHash'), run: () => copyText(commit.hash) },
        ]
      }

      function commitMenu(commit) {
        const newest = commits[0]?.hash === commit.hash
        return [
          { label: t('copyHash'), run: () => copyText(commit.hash) },
          { separator: true },
          {
            label: t('amend'),
            disabled: !newest,
            title: newest ? undefined : t('amend.newestOnly'),
            run: () => setDialog({ title: t('amend'), input: commit.body === '' ? commit.subject : `${commit.subject}\n\n${commit.body}`, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
          },
          { label: `${t('checkout')} ${commit.short}`, run: () => mutate('checkout', { name: commit.hash }, fill(t('notice.checkedOut'), { name: commit.short })) },
          { label: `${t('cherryPick')} ${commit.short}`, run: () => mutate('cherryPick', { commit: commit.hash }, fill(t('notice.cherryPicked'), { name: commit.short })) },
          { label: t('newBranch'), run: () => setDialog({ title: t('newBranch'), input: `branch-${commit.short}`, confirm: t('dialog.createBranch.confirm'), run: (value) => mutate('checkout', { name: value, create: true, startPoint: commit.hash }, fill(t('notice.created'), { name: value })) }) },
          { separator: true },
          { label: t('resetSoft'), run: () => mutate('reset', { commit: commit.hash, mode: 'soft' }, fill(t('notice.reset'), { mode: 'soft', short: commit.short })) },
          { label: t('resetMixed'), run: () => mutate('reset', { commit: commit.hash, mode: 'mixed' }, fill(t('notice.reset'), { mode: 'mixed', short: commit.short })) },
          {
            label: t('resetHard'),
            run: () =>
              setDialog({
                title: t('resetHard'),
                text: `${commit.short} ${commit.subject}`,
                warning: t('dialog.resetHard.warning'),
                confirm: t('resetHard'),
                run: () => mutate('reset', { commit: commit.hash, mode: 'hard' }, fill(t('notice.reset'), { mode: 'hard', short: commit.short })),
              }),
          },
          { separator: true },
          { label: t('revert'), run: () => mutate('revert', { commit: commit.hash }, fill(t('notice.reverted'), { name: commit.short })) },
        ]
      }

      /**
       * Build the branch context-menu rows.
       *
       * @param {object} branch - the branch under the pointer.
       * @param {boolean} remote - whether it tracks a remote.
       * @returns {Array<object>} the rows.
       */
      function branchMenu(branch, remote) {
        if (remote) {
          const local = branch.name.replace(/^[^/]+\//, '')
          return [
            { label: `${t('checkout')} "${local}"`, run: () => mutate('checkout', { name: local, create: true, startPoint: branch.name }, fill(t('notice.checkedOut'), { name: local })) },
            { label: `${t('cherryPick')} into ${currentBranch ?? 'HEAD'}`, run: () => mutate('cherryPick', { commit: branch.name }, fill(t('notice.cherryPicked'), { name: branch.name })) },
            { separator: true },
            { label: t('copyHash'), run: () => copyText(branch.name) },
          ]
        }
        return [
          { label: `${t('checkout')} ${branch.name}`, disabled: branch.current === true, run: () => mutate('checkout', { name: branch.name }, fill(t('notice.switched'), { name: branch.name })) },
          { separator: true },
          {
            label: t('deleteBranch'),
            disabled: branch.current === true,
            run: () =>
              setDialog({
                title: t('deleteBranch'),
                text: branch.name,
                warning: t('dialog.deleteBranch.warning'),
                confirm: t('deleteBranch'),
                run: () => mutate('deleteBranch', { name: branch.name }, fill(t('notice.deleted'), { name: branch.name })),
              }),
          },
        ]
      }

      const filter = branchFilter.trim().toLowerCase()
      const filteredBranches = branches.filter((entry) => filter === '' || entry.name.toLowerCase().includes(filter))
      const filteredRemotes = remotes.filter((entry) => filter === '' || entry.name.toLowerCase().includes(filter))

      return h(
        'div',
        { className: 'git-panel' },
        h(StyleTag, null),
        h(
          'div',
          { className: 'git-panel-bar' },
          h(
            'div',
            { className: 'git-panel-bar-row' },
            h(
              'div',
              { className: 'git-panel-field' },
              h('span', { className: 'git-panel-field-label' }, t('workspace')),
              h(
                'select',
                { className: 'git-panel-select', value: workspaceRoot ?? '', title: workspaceRoot ?? '', onChange: (event) => setWorkspaceOverride(event.target.value) },
                roots.map((entry) => h('option', { key: entry.path, value: entry.path, title: entry.path }, entry.title)),
              ),
            ),
            currentRepositories.length === 0
              ? null
              : h(
                  'div',
                  { className: 'git-panel-field' },
                  h('span', { className: 'git-panel-field-label' }, t('repository')),
                  h(
                    'select',
                    { className: 'git-panel-select', value: repository?.path ?? '', title: repository?.path ?? '', onChange: (event) => setRepoOverride(event.target.value) },
                    currentRepositories.map((entry) =>
                      h('option', { key: entry.path, value: entry.path }, `${entry.relative === '' ? basename(entry.path) : entry.relative}${entry.isSubmodule ? ' (submodule)' : ''}`),
                    ),
                  ),
                ),
            h('span', { className: 'git-panel-spacer' }),
            loading ? h('span', { className: 'git-panel-count' }, t('loading')) : null,
            h(
              'span',
              { className: 'git-panel-branch-chip', title: state?.root ?? '' },
              h('span', { className: 'git-panel-branch-chip-glyph', 'aria-hidden': true }, h(GitGlyph, { size: 12 })),
              h('span', { className: 'git-panel-branch-chip-name' }, currentBranch ?? (state?.detached === true ? t('detached') : DASH)),
            ),
            state === null || (state.ahead === 0 && state.behind === 0)
              ? null
              : h('span', { className: 'git-panel-chip', title: t('aheadBehind.title') }, `${UP}${state.ahead} ${DOWN}${state.behind}`),
            h('button', { type: 'button', className: 'git-panel-btn', disabled: busy, onClick: refresh, title: t('refresh') }, busy ? t('working') : t('refresh')),
            h(
              'button',
              {
                type: 'button',
                className: 'git-panel-btn',
                disabled: busy || repository === null || (state?.remoteNames?.length ?? 0) === 0,
                onClick: () => mutate('fetch', {}, t('notice.fetched'), 'state'),
                title: t('fetch'),
              },
              t('fetch'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'git-panel-btn',
                disabled: busy || repository === null || state === null || state.upstream === null,
                onClick: () => mutate('pull', {}, t('notice.pulled')),
                title: t('pull'),
              },
              t('pull'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: cx('git-panel-btn', 'git-panel-btn-primary'),
                disabled: busy || repository === null || currentBranch === null,
                onClick: () => mutate('push', { remote: state?.remoteNames?.[0] }, t('notice.pushed')),
                title: t('push'),
              },
              t('push'),
            ),
          ),
        ),
        error === null ? null : h('div', { className: cx('git-panel-banner', 'git-panel-banner-error') }, error),
        staleHost ? h('div', { className: cx('git-panel-banner', 'git-panel-banner-warn') }, t('notice.staleHost')) : null,
        notice === null ? null : h('div', { className: cx('git-panel-banner', 'git-panel-banner-ok') }, notice),
        roots.length === 0
          ? h('div', { className: 'git-panel-empty' }, t('noWorkspace'))
          : !workspaceReady
            ? h('div', { className: 'git-panel-empty' }, repositoriesLoaded && loading !== true ? t('noRepository') : t('loading'))
            : h(
                'div',
                { className: 'git-panel-cols' },
                // ---- left: branches, submodules, working tree ------------------
                h(
                  'div',
                  { className: cx('git-panel-col', 'git-panel-col-left') },
                  h(
                    'div',
                    { className: cx('git-panel-pane', 'git-panel-pane-top') },
                    h('div', { className: 'git-panel-pane-head' }, h('span', { className: 'git-panel-pane-title' }, t('branches')), h('span', { className: 'git-panel-count' }, String(branches.length + remotes.length))),
                    h('div', { style: { padding: '5px 9px 3px' } }, h('input', { className: 'git-panel-input', style: { width: '100%' }, value: branchFilter, placeholder: t('branchesFilter'), onChange: (event) => setBranchFilter(event.target.value) })),
                    h(
                      'div',
                      { className: 'git-panel-list' },
                      h(GroupHead, { label: t('local'), count: branches.length, open: groups.local, onToggle: () => setGroups((value) => ({ ...value, local: !value.local })) }),
                      groups.local && filteredBranches.length === 0 ? h('div', { className: 'git-panel-empty' }, t('noBranches')) : null,
                      groups.local
                        ? filteredBranches.map((branch) =>
                            h(BranchRow, {
                              key: `l-${branch.name}`,
                              branch,
                              remote: false,
                              busy,
                              onCheckout: (request) => mutate('checkout', request, `switched to ${request.name}`),
                              onContextMenu: (event, entry, isRemote) => setMenu({ x: event.clientX, y: event.clientY, title: entry.name, items: branchMenu(entry, isRemote) }),
                            }),
                          )
                        : null,
                      h(GroupHead, { label: t('remote'), count: remotes.length, open: groups.remote, onToggle: () => setGroups((value) => ({ ...value, remote: !value.remote })) }),
                      groups.remote
                        ? filteredRemotes.map((branch) =>
                            h(BranchRow, {
                              key: `r-${branch.name}`,
                              branch,
                              remote: true,
                              busy,
                              onCheckout: (request) => mutate('checkout', request, `checked out ${request.name}`),
                              onContextMenu: (event, entry, isRemote) => setMenu({ x: event.clientX, y: event.clientY, title: entry.name, items: branchMenu(entry, isRemote) }),
                            }),
                          )
                        : null,
                      (state?.submodules?.length ?? 0) === 0
                        ? null
                        : h(GroupHead, { label: t('submodules'), count: state.submodules.length, open: groups.submodules, onToggle: () => setGroups((value) => ({ ...value, submodules: !value.submodules })) }),
                      (groups.submodules ? state?.submodules ?? [] : []).map((submodule) =>
                        h(
                          'div',
                          { key: submodule.path, className: 'git-panel-row', title: `${submodule.path} · ${submoduleStateText(submodule.state, t)}` },
                          h('span', { className: cx('git-panel-status', submodule.state === 'initialized' ? 'git-panel-status-A' : 'git-panel-status-M') }, submodule.state === 'initialized' ? CHECK_GLYPH : WARN_GLYPH),
                          h('span', { className: 'git-panel-branch' }, submodule.path),
                          h('span', { className: 'git-panel-count' }, submoduleStateText(submodule.state, t)),
                        ),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: cx('git-panel-pane', 'git-panel-pane-grow') },
                    h(
                      'div',
                      { className: 'git-panel-pane-head' },
                      h('input', {
                        type: 'checkbox',
                        className: 'git-panel-check',
                        checked: files.length > 0 && pickedPaths.length === files.length,
                        disabled: busy || files.length === 0,
                        title: t('selectAll'),
                        'aria-label': t('selectAll'),
                        // A DOM property, not an attribute: React cannot set it
                        // from props, and a partial selection must render the
                        // dash rather than a checked box.
                        ref: (element) => {
                          if (element === null || element === undefined) return
                          element.indeterminate = pickedPaths.length > 0 && pickedPaths.length < files.length
                        },
                        onChange: () => selectEverything(pickedPaths.length !== files.length),
                      }),
                      h('span', { className: 'git-panel-pane-title' }, t('changes')),
                      h('span', { className: 'git-panel-count' }, String(files.length)),
                      h('span', { className: 'git-panel-spacer' }),
                      h('button', { type: 'button', className: 'git-panel-btn', disabled: busy || pickedPaths.length === 0, title: t('stageSelected.hint'), onClick: () => setSelectedStaged(true) }, t('stageSelected')),
                      h('button', { type: 'button', className: 'git-panel-btn', disabled: busy || pickedPaths.length === 0, title: t('unstageSelected.hint'), onClick: () => setSelectedStaged(false) }, t('unstageSelected')),
                    ),
                    h(
                      'div',
                      { className: 'git-panel-list' },
                      files.length === 0 ? h('div', { className: 'git-panel-empty' }, t('noChanges')) : null,
                      files.map((file) =>
                        h(ChangeRow, {
                          t,
                          key: file.path,
                          file,
                          busy,
                          selected: selectedCommit === null && selectedFile?.path === file.path,
                          picked: selectedPaths.has(file.path),
                          onToggle: (entry) => togglePicked(entry),
                          onSelect: (entry) => {
                            setSelectedCommit(null)
                            setSelectedFile(entry)
                          },
                          onOpen: (entry) => {
                            // A working-tree file is never read through a commit,
                            // so a commit left selected must not supply the diff base.
                            setSelectedCommit(null)
                            openDiff(entry)
                          },
                          onContextMenu: (event, entry) =>
                            setMenu({
                              x: event.clientX,
                              y: event.clientY,
                              title: entry.path,
                              items: [
                                entry.staged === true ? { label: t('menu.unstage'), run: () => mutate('unstage', { paths: [entry.path] }, undefined, 'state') } : { label: t('menu.stage'), run: () => mutate('stage', { paths: [entry.path] }, undefined, 'state') },
                                { separator: true },
                                { label: t('menu.showDiff'), run: () => { setSelectedCommit(null); openDiff(entry) } },
                                { label: t('copyHash'), run: () => copyText(entry.path) },
                              ],
                            }),
                        }),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'git-panel-msg' },
                      h('textarea', {
                        className: 'git-panel-textarea',
                        value: message,
                        placeholder: t('messagePlaceholder'),
                        'aria-label': t('message'),
                        onChange: (event) => setMessage(event.target.value),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                            event.preventDefault()
                            if (message.trim() !== '') commit(false, false)
                          }
                        },
                      }),
                      h(
                        'div',
                        { className: 'git-panel-actions' },
                        h('button', { type: 'button', className: cx('git-panel-btn', 'git-panel-btn-primary'), disabled: busy || message.trim() === '', onClick: () => commit(false, false) }, t('commit')),
                        h('button', { type: 'button', className: 'git-panel-btn', disabled: busy || message.trim() === '', onClick: () => commit(true, false) }, t('commitAll')),
                        h('button', { type: 'button', className: 'git-panel-btn', disabled: busy || message.trim() === '', onClick: () => commit(false, true) }, t('commitPush')),
                      ),
                    ),
                  ),
                ),
                // ---- middle: history ------------------------------------------
                h(
                  'div',
                  { className: cx('git-panel-col', 'git-panel-col-mid') },
                  h('div', { className: 'git-panel-pane-head' }, h('span', { className: 'git-panel-pane-title' }, t('commits')), h('span', { className: 'git-panel-count' }, String(commits.length))),
                  h(
                    'div',
                    { className: 'git-panel-list' },
                    commits.length === 0 ? h('div', { className: 'git-panel-empty' }, t('noCommits')) : null,
                    commits.map((commit) =>
                      h(CommitRow, {
                        t,
                        key: commit.hash,
                        commit,
                        selected: selectedCommit?.hash === commit.hash,
                        onSelect: (entry) => {
                          setSelectedCommit(entry)
                          setSelectedFile(null)
                        },
                        onContextMenu: (event, entry) => setMenu({ x: event.clientX, y: event.clientY, title: `${entry.short} ${entry.subject}`, items: commitMenu(entry) }),
                      }),
                    ),
                  ),
                ),
                // ---- right: the commit message above, its files below ---------
                h(
                  'div',
                  { className: cx('git-panel-col', 'git-panel-col-right') },
                  selectedCommit === null
                    ? h(
                        React.Fragment,
                        null,
                        h('div', { className: 'git-panel-pane-head' }, h('span', { className: 'git-panel-pane-title' }, t('details'))),
                        h('div', { className: 'git-panel-empty' }, t('selectCommit')),
                      )
                    : h(
                        React.Fragment,
                        null,
                        h(
                          'div',
                          { className: 'git-panel-detail' },
                          h(
                            'div',
                            {
                              className: 'git-panel-detail-head',
                              title: t('menu.editMessage'),
                              onContextMenu: (event) => {
                                event.preventDefault()
                                setMenu({ x: event.clientX, y: event.clientY, title: `${selectedCommit.short} ${selectedCommit.subject}`, items: commitMessageMenu(selectedCommit) })
                              },
                            },
                            h('div', { className: 'git-panel-detail-subject' }, selectedCommit.subject || t('noMessage')),
                            h(
                              'div',
                              { className: 'git-panel-kv' },
                              h('div', { className: 'git-panel-kv-key' }, t('hash')),
                              h('div', { className: cx('git-panel-kv-value', 'git-panel-mono') }, selectedCommit.hash),
                              h('div', { className: 'git-panel-kv-key' }, t('author')),
                              h('div', { className: 'git-panel-kv-value' }, `${selectedCommit.author} <${selectedCommit.email}>`),
                              h('div', { className: 'git-panel-kv-key' }, t('date')),
                              h('div', { className: 'git-panel-kv-value' }, absoluteDate(selectedCommit.timestamp)),
                              h('div', { className: 'git-panel-kv-key' }, t('parents')),
                              h('div', { className: cx('git-panel-kv-value', 'git-panel-mono') }, selectedCommit.parents.map((parent) => parent.slice(0, 8)).join(' ') || DASH),
                            ),
                            selectedCommit.body === '' ? null : h('div', { className: 'git-panel-detail-body' }, selectedCommit.body),
                          ),
                          h(
                            'div',
                            { className: 'git-panel-pane-head' },
                            h('span', { className: 'git-panel-pane-title' }, t('files')),
                            h('span', { className: 'git-panel-count' }, filesLoading ? t('loading') : String(commitFiles.length)),
                          ),
                          h(
                            'div',
                            { className: 'git-panel-list' },
                            filesError === null ? null : h('div', { className: 'git-panel-empty' }, filesError),
                            filesError !== null || commitFiles.length > 0 ? null : h('div', { className: 'git-panel-empty' }, filesLoading ? t('files.loading') : t('files.none')),
                            commitFiles.map((file) =>
                              h(
                                'div',
                                {
                                  key: file.path,
                                  className: cx('git-panel-row', selectedFile?.path === file.path ? 'git-panel-row-sel' : false),
                                  title: `${file.path} — ${t('openDiff')}`,
                                  onClick: () => setSelectedFile({ path: file.path, staged: false }),
                                  onDoubleClick: () => openDiff({ path: file.path, staged: false }),
                                },
                                h('span', { className: 'git-panel-status', style: { opacity: 0.5 } }, DOT_GLYPH),
                                h('span', { className: 'git-panel-branch' }, file.path),
                                h(
                                  'span',
                                  { className: 'git-panel-numstat' },
                                  file.added === null ? h('span', { className: 'git-panel-sub' }, t('file.binary')) : file.added > 0 ? h('span', { className: 'git-panel-plus' }, `+${file.added}`) : null,
                                  file.removed === null || file.removed === 0 ? null : h('span', { className: 'git-panel-minus' }, `-${file.removed}`),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                ),
              ),
        menu === null ? null : h(ContextMenu, { menu, onClose: closeMenu }),
        dialog === null ? null : h(Dialog, { dialog, onClose: () => setDialog(null), t }),
        diffOpen && activeFile !== null && repository !== null ? h(DiffModal, { file: activeFile, commit: selectedCommit, text: diff, stale: staleHost, whole: wholeFileDiff, onClose: () => setDiffOpen(false), t }) : null,
      )
    }

    /**
     * Per-tab navigation revisions this plugin has already acted on.
     *
     * The revision survives a body remount while the tab record does, and a
     * remount happens for reasons that are not a navigation at all — a session
     * switch, a sidebar expand, a pane change. Remembering what was handled is
     * what keeps those from re-selecting the panel the user just left, which is
     * why the memory lives outside the component.
     */
    const handledRevisions = new Map()

    /**
     * Close the tab one tab body belongs to.
     *
     * The framework hands every tab body its own close action, which acts on
     * that tab in its own session. The controller's `close(tabId)` is not a
     * substitute: it needs a mounted seat binding, and a body's first effect
     * runs before that binding is published.
     *
     * @param {object|null} info - the tab information the framework handed the body.
     * @returns {boolean} whether the tab accepted the close.
     */
    function closeOwnTab(info) {
      const actions = info?.tab?.actions
      if (typeof actions?.close !== 'function') return false
      try {
        actions.close()
        return true
      } catch {
        return false
      }
    }

    /**
     * The right Sidebar's Git tab body: a door, not a page.
     *
     * A *navigation* to this tab — the guide capsule, the tab chip — opens the
     * full-page panel and drops the tab again, which is what leaves no Git tab
     * in the column once the user returns to the conversation. Everything else
     * — a record restored from a previous session, a body remounted because the
     * user switched session or expanded the column — only closes itself: every
     * session keeps its own layout, so forwarding there would re-select the very
     * panel the user just left.
     *
     * The card below is the fallback for a deployment that refuses the close: it
     * names the tool and offers the same door, and deliberately reads nothing
     * from the Host, so a lingering tab cannot sit on stale repository data.
     *
     * @param {object} props - tab body props, including the framework's `useTabInfo`.
     * @returns {object|null} the fallback card, or nothing once the tab is gone.
     */
    function GitTabDoor({ useTabInfo, t = boundTranslate }) {
      const info = typeof useTabInfo === 'function' ? useTabInfo() : null
      const revision = info?.tab?.navigation?.revision ?? 0
      const visible = info?.tab?.visible === true
      const tabId = info?.tab?.id
      const key = String(tabId)
      const [closed, setClosed] = React.useState(false)
      React.useEffect(() => {
        const handled = handledRevisions.get(key) ?? 0
        if (revision > handled) handledRevisions.set(key, revision)
        // The panel is opened once per navigation, and only from the foreground:
        // a background session showing its own layout must not take the seat.
        if (visible === true && revision > handled && openGitPanel(info) !== true) return
        const done = closeOwnTab(info)
        if (done) handledRevisions.delete(key)
        setClosed(done)
      }, [visible, revision, key])
      if (closed) return null
      return h(
        'div',
        { className: 'git-panel' },
        h(StyleTag, null),
        h(
          'div',
          { className: 'git-panel-launch' },
          h('div', { className: 'git-panel-launch-icon' }, h(GitGlyph, { size: 28 })),
          h('div', { className: 'git-panel-launch-title' }, t('title')),
          h('div', { className: 'git-panel-launch-text' }, t('launcherHint')),
          h('div', { className: 'git-panel-launch-text' }, t('launcherWhere')),
          h(
            'div',
            { className: 'git-panel-launch-actions' },
            h(
              'button',
              {
                type: 'button',
                className: cx('git-panel-btn', 'git-panel-btn-primary'),
                onClick: () => {
                  if (openGitPanel(info) === true) setClosed(closeOwnTab(info))
                },
              },
              t('openPanel'),
            ),
          ),
        ),
      )
    }

    /**
     * The right Sidebar's chip title.
     *
     * @returns {object} the chip content.
     */
    function GitTitle({ t = boundTranslate }) {
      return h(
        React.Fragment,
        null,
        h('span', { 'aria-hidden': true, style: { marginRight: 4, display: 'inline-flex', verticalAlign: '-2px' } }, h(GitGlyph, { size: 13 })),
        t('title'),
      )
    }

    /** Required browser services: slots for every seat, the tab registry, the right-Sidebar controller, layout, locale, and the shared configuration forms. */
    const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'layout', 'locale', 'configForms']

    /**
     * Register the sidebar entry, the main panel, the right-Sidebar tab, its
     * title, and the plugin's configuration card on the Plugins page.
     *
     * Asynchronous because the browser half is split into package-local chunks:
     * the module system can only hand a sibling bundle over asynchronously, and
     * everything the split registers has to exist before the first render.
     *
     * @param {object} ctx - client root context.
     * @returns {Promise<void>} nothing once every seat is registered.
     */
    async function apply(ctx) {
      hostContext = ctx
      const t = ctx.locale.bind(LOCALE_NS)
      boundTranslate = t
      try {
        primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      } catch {
        primitives = null
      }
      // The dictionaries are the one chunk `apply` reads itself, so they are
      // requested first; the chunk has to arrive before the locale service can
      // serve a single label.
      dictionaries = await require.async('./client.i18n.js')
      ctx.effect(() => ctx.locale.register(LOCALE_NS, dictionaries), 'ui-GitPanel: dictionaries')
      // The file-preview repair is installed before anything can resolve a
      // resource address — the right Sidebar may already hold a document tab
      // when this plugin applies — and it needs only the configuration form
      // service, so it does not share the settings card's primitives guard.
      if (typeof ctx.configForms?.get === 'function') {
        ctx.effect(() => watchFilePreviewFix(ctx), 'ui-GitPanel: file-preview addresses')
      }
      ctx.effect(
        () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: LOCALE_NS }, GitPanel)),
        'ui-GitPanel: git main panel',
      )

      ctx.effect(
        () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => t('title') }, GitGlyph)),
        'ui-GitPanel: git panel entry',
      )

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: PLUGIN_ID,
            kind: GIT_KIND,
            priority: 'extension',
            keepMounted: true,
            title: () => t('title'),
            guide: [{ id: 'git', order: 20, title: () => t('title'), description: () => t('launcherHint'), icon: GitGlyph }],
          }),
        'ui-GitPanel: git type',
      )

      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PLUGIN_ID, locale: LOCALE_NS }, GitTabDoor)),
        'ui-GitPanel: git tab door',
      )

      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: PLUGIN_ID, locale: LOCALE_NS }, GitTitle)),
        'ui-GitPanel: git tab title',
      )

      // The Plugins page renders a bundle's own configuration on that bundle's
      // page, keyed by the package name, and only once the Host serves the
      // namespace — so an older Host or a read-only document shows no dead form,
      // and a third-party bundle never claims a cell in the official group.
      if (primitives !== null && typeof ctx.configForms?.whileServed === 'function') {
        const card = createSettingsCard(ctx.configForms)
        ctx.effect(() => () => card.dispose(), 'ui-GitPanel: settings form subscription')
        ctx.effect(
          () =>
            ctx.configForms.whileServed([SETTINGS_NS], () =>
              ctx.slots.inject('plugins.bundle.config', () =>
                ctx.slots.register(
                  {
                    name: 'plugins.bundle.config',
                    key: PLUGIN_ID,
                    locale: LOCALE_NS,
                    inject: () => card.inject(),
                  },
                  GitSettingsCard,
                ),
              ),
            ),
          'ui-GitPanel: settings card',
        )
      }
    }

    /**
     * Read the host of one resource address, as the repair reads it.
     *
     * The repair's whole substance is this one derivation, and a headless
     * module test cannot observe a global the page patched, so the seam is
     * exported for the smoke test rather than left to be re-implemented there.
     *
     * @param {unknown} address - the address to read.
     * @returns {string|undefined} the protocol key the repair resolves, or undefined for any other address.
     */
    function auditResourceAddress(address) {
      return resourceProtocolOf(address)
    }

    return { inject, apply, auditResourceAddress }
  },
})
