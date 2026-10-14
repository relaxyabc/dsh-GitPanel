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

    // The package revision that every chunk URL carries is derived from THIS
    // file (its mtime, ctime, and size), not from the chunks themselves, and the
    // Host's chunk route serves that revision as `immutable`. Editing only a
    // `client.*.js` chunk therefore leaves every URL unchanged, the browser
    // keeps serving the cached chunk, and the HMR watcher — which polls this one
    // file — never sees the change either. The page then runs a mix of new and
    // cached pieces, and a cached chunk that reads a shared name this file no
    // longer defines throws on its first render: the white panel. Touching this
    // file changes the revision, retires every cached chunk, and makes HMR
    // reload the page; keeping shared names stable — add, never rename or
    // remove — degrades an unavoidably cached chunk to a no-op instead.

    /** Commit page size requested from the Host. */
    const COMMIT_PAGE = 200

    /**
     * Distance from the end of the history list that reads the next page.
     *
     * A scroll fires in bursts and the list re-renders late, so the margin is
     * what keeps scrolling to the end from looking like a dead stop.
     */
    const HISTORY_LOAD_AHEAD_PX = 240

    /**
     * How many commits the panel keeps loaded before it asks to continue.
     *
     * A loaded history lives in the tab's memory, so it has a ceiling the way a
     * desktop index does not. The ceiling is a step rather than a wall: reaching
     * it offers to raise it, and `HISTORY_LOAD_STEP` is how much one raise buys.
     */
    const HISTORY_LOAD_CAP = 20000

    /** Commits one "keep loading" adds to the ceiling. */
    const HISTORY_LOAD_STEP = 20000

    /**
     * The height of one history row, in pixels.
     *
     * The list renders a window of rows instead of all of them, which needs the
     * height of the rows it is not rendering. The stylesheet pins the same
     * number on the row, so both sides read it from here.
     */
    const HISTORY_ROW_HEIGHT = 26

    /** Rows rendered beyond the viewport on each side, to cover a fast scroll. */
    const HISTORY_WINDOW_OVERSCAN = 8

    /** Viewport height assumed for the first paint, before any scroll arrives. */
    const HISTORY_VIEWPORT_PX = 640

    /**
     * Quiet time before a filter draft becomes the query the Host is asked.
     *
     * Every applied filter costs the Host a history walk, so typing must not
     * spend one per keystroke; the draft is also narrowed locally meanwhile, so
     * the list still reacts immediately.
     */
    const HISTORY_FILTER_DEBOUNCE_MS = 300

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

    /**
     * The repair's address reader, bound when the repair's chunk is wired during
     * apply. Until then the page has no repair, so no address names a protocol.
     */
    let resourceProtocolOf = () => undefined

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
     * Format a commit timestamp the way a history row reads it: today and
     * yesterday carry their name plus the clock time, everything older falls
     * back to the absolute local date.
     *
     * @param {number} seconds - commit timestamp.
     * @param {(key: string) => string} t - the translator for the day names.
     * @returns {string} the formatted date, or an empty string.
     */
    /**
     * The date a commit is shown and filtered by.
     *
     * Git's `--since`/`--until` limit on the commit date, so the panel shows
     * that date too: filtering a list by one date while printing another would
     * make a correct filter look wrong. A Host that predates the field reports
     * only the author date, which is what this falls back to.
     *
     * @param {object|null} commit - the commit record.
     * @returns {number} seconds since the epoch, or 0 when neither date is usable.
     */
    function commitTime(commit) {
      const committed = Number(commit?.committedAt)
      if (Number.isFinite(committed) && committed > 0) return committed
      const authored = Number(commit?.timestamp)
      return Number.isFinite(authored) ? authored : 0
    }

    /**
     * Format a commit timestamp the way a history row reads it: today and
     * yesterday carry their name plus the clock time, everything older falls
     * back to the absolute local date.
     *
     * @param {number} seconds - commit timestamp.
     * @param {(key: string) => string} t - the translator for the day names.
     * @returns {string} the formatted date, or an empty string.
     */
    function relativeDate(seconds, t) {
      if (!Number.isFinite(seconds) || seconds <= 0) return ''
      const date = new Date(seconds * 1000)
      const now = new Date()
      // A plain ymd number compares without the timezone traps a date string
      // would carry; yesterday is built through the Date constructor so it
      // stays correct across month and year boundaries.
      const dayOf = (value) => value.getFullYear() * 10000 + (value.getMonth() + 1) * 100 + value.getDate()
      const day = dayOf(date)
      const today = dayOf(now)
      if (day !== today && day !== dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
        return absoluteDate(seconds)
      }
      const pad = (value) => String(value).padStart(2, '0')
      return `${t(day === today ? 'date.today' : 'date.yesterday')} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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
     * Split a commit's message into its parts, keeping every newline.
     *
     * Git folds a subject paragraph's own line breaks into spaces for `%s`, so
     * a commit whose first paragraph runs over several lines would lose its
     * newlines if the panel rebuilt the message from subject and body. The raw
     * message field is the only one that keeps them, and every display and
     * edit surface reads through here so a Host that predates the field still
     * answers with the older subject-plus-body shape.
     *
     * @param {object|null} commit - the commit record.
     * @returns {{ subject: string, body: string, full: string }} the first line, the remainder below it, and the whole message.
     */
    function commitMessageParts(commit) {
      const raw = commit !== null && typeof commit === 'object' && typeof commit.message === 'string' && commit.message.trim() !== ''
        ? commit.message.replace(/\s+$/, '')
        : null
      if (raw === null) {
        const subject = typeof commit?.subject === 'string' ? commit.subject : ''
        const body = typeof commit?.body === 'string' ? commit.body : ''
        return { subject, body, full: body === '' ? subject : `${subject}\n\n${body}` }
      }
      const split = raw.indexOf('\n')
      const subject = split === -1 ? raw : raw.slice(0, split)
      const body = split === -1 ? '' : raw.slice(split + 1).replace(/^\n+/, '').replace(/\s+$/, '')
      return { subject, body, full: raw }
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

    /**
     * The token-only stylesheet, delivered by the `client.style.js` chunk during
     * apply and rendered by every mount that uses a `git-panel-*` class name.
     */
    let STYLES = ''

    /** The Git folder glyph's path data, delivered with the stylesheet. */
    let GIT_PATH = ''

    /**
     * The inline stylesheet.
     *
     * @returns {object} the style element.
     */
    function StyleTag() {
      return h('style', null, STYLES)
    }

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
      // The one scope every chunk closes over. Handing it over in a single object
      // keeps the direction of the dependency visible: the entry owns the module
      // vocabulary, a chunk destructures exactly what it uses, and no chunk can
      // reach back into the entry for something that was never given to it.
      const shared = {
        // Runtime and language. The components take their `t` as a prop — the
        // framework injects it into a slot occupant — so the chunks need the
        // pre-bound fallback rather than the namespace binding itself.
        h,
        React,
        boundTranslate,
        primitives,
        // Render surfaces the entry owns: the stylesheet tag and the Git glyph.
        StyleTag,
        GitGlyph,
        // Text and value helpers the chunks render with.
        cx,
        basename,
        fill,
        statusText,
        relativeDate,
        absoluteDate,
        commitMessageParts,
        commitTime,
        submoduleStateText,
        mainSessionIdOf,
        // Host transport and its failure vocabulary.
        callHost,
        failureText,
        isStaleHost,
        // The apply-scope context, for the door that selects the main panel.
        hostContext,
        // Glyphs.
        ARROW,
        BRANCH_GLYPH,
        CARET_OPEN,
        CARET_CLOSED,
        CLOSE_GLYPH,
        DASH,
        ENTER_GLYPH,
        UP,
        DOWN,
        // Limits and identities.
        COMMIT_PAGE,
        HISTORY_LOAD_AHEAD_PX,
        HISTORY_LOAD_CAP,
        HISTORY_LOAD_STEP,
        HISTORY_ROW_HEIGHT,
        HISTORY_WINDOW_OVERSCAN,
        HISTORY_VIEWPORT_PX,
        HISTORY_FILTER_DEBOUNCE_MS,
        NO_FILES,
        PANEL_ID,
        RESOURCE_PREFIX,
        // The settings vocabulary the card and the repair share.
        SETTINGS_NS,
        DEPTH_FIELD,
        DEPTH_INPUT_ID,
        DISCOVERY_SECTION_ID,
        DISPLAY_SECTION_ID,
        WHOLE_FILE_FIELD,
        WHOLE_FILE_SPEC,
        WHOLE_FILE_HELP_ID,
        FILE_PREVIEW_FIELD,
        FILE_PREVIEW_SPEC,
        FILE_PREVIEW_HELP_ID,
        FILE_PREVIEW_SECTION_ID,
      }
      // The repair is bound and installed before anything else is, because it has
      // to be in force before the page resolves a resource address — the right
      // Sidebar may already hold a document tab when this plugin applies — and it
      // needs only the configuration form service, so it does not share the
      // settings card's primitives guard.
      const repair = (await require.async('./client.preview-fix.js')).create(shared)
      resourceProtocolOf = repair.resourceProtocolOf
      if (typeof ctx.configForms?.get === 'function') {
        ctx.effect(() => repair.watchFilePreviewFix(ctx), 'ui-GitPanel: file-preview addresses')
      }
      // Every other chunk is requested here, before a single seat is registered:
      // the panel, the settings card, and the tab door are all handed to the
      // framework in this call, so nothing they render may still be waiting.
      const [i18n, style, settingsFace, sidebarFace, rowsFace, diffFace, branchesFace, historyFace, panelFace] = await Promise.all([
        require.async('./client.i18n.js'),
        require.async('./client.style.js'),
        require.async('./client.settings.js'),
        require.async('./client.sidebar.js'),
        require.async('./client.rows.js'),
        require.async('./client.diff.js'),
        require.async('./client.branches.js'),
        require.async('./client.history.js'),
        require.async('./client.panel.js'),
      ])
      dictionaries = i18n
      STYLES = style.STYLES
      GIT_PATH = style.GIT_PATH
      const { createSettingsCard, GitSettingsCard } = settingsFace.create(shared)
      const { GitTabDoor, GitTitle } = sidebarFace.create(shared)
      const rows = rowsFace.create(shared)
      const diff = diffFace.create(shared)
      // The columns and the panel render the rows, so they are wired with them;
      // everything else keeps the narrower scope it was created from.
      const wired = { ...shared, rows, diff }
      const panes = { ...branchesFace.create(wired), ...historyFace.create(wired) }
      const { GitPanel } = panelFace.create({ ...wired, panes })
      ctx.effect(() => ctx.locale.register(LOCALE_NS, dictionaries), 'ui-GitPanel: dictionaries')
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
        const form = createSettingsCard(ctx.configForms)
        ctx.effect(() => () => form.dispose(), 'ui-GitPanel: settings form subscription')
        ctx.effect(
          () =>
            ctx.configForms.whileServed([SETTINGS_NS], () =>
              ctx.slots.inject('plugins.bundle.config', () =>
                ctx.slots.register(
                  {
                    name: 'plugins.bundle.config',
                    key: PLUGIN_ID,
                    locale: LOCALE_NS,
                    inject: () => form.inject(),
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
     * The repair's whole substance is this one derivation, and a headless module
     * test cannot observe a global the page patched, so the seam is exported for
     * the smoke test rather than left to be re-implemented there. It answers only
     * once the repair's chunk has been wired, which is what the reader belongs to.
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
