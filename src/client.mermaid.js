/**
 * The Mermaid-aware Markdown document preview.
 *
 * Split out of `client.js` as a package-local chunk: it is a whole second
 * document renderer — registered into the document preview's own registry with
 * extension priority, so `.md` files open through it by default — plus the DOM
 * pass that turns the renderer's mermaid code blocks into diagrams. Diagram
 * versus source is not a switch here: the document toolbar's viewer menu is,
 * with the built-in Markdown renderer (whose mermaid blocks stay source) as the
 * other choice. The body and the configuration watch share one small hub.
 *
 * The renderer itself is DSH's `MarkdownText` primitive, exactly what the
 * built-in Markdown body draws with; only the mermaid blocks are replaced, and
 * every DOM write is diff-shaped so a pass that finds nothing to change writes
 * nothing. The Mermaid library ships inside the package as a sibling chunk
 * (`client.mermaid-lib.js`), so rendering needs no network at all.
 *
 * @module GitPanel/client.mermaid
 */
/**
 * This renderer's identity in the document preview registry and the key its
 * body slot is registered under. Namespaced like the built-in ids are, and
 * readable before the face is created, because the entry registers the slot
 * and the harness reads the id without building the whole feature.
 */
const MERMAID_BODY_ID = 'GitPanel/markdown-mermaid'

/**
 * The shared state of the whole feature.
 *
 * `enabled` mirrors the plugin configuration (the documented default is
 * on, and only an explicit `false` turns it off, exactly like the
 * address repair); `library` says whether the vendored Mermaid build has
 * been read and initialized (`pending`), arrived (`ready`), or is unusable
 * this session (`unavailable`); `themeEpoch` bumps whenever the page's
 * palette flips, so drawn diagrams redraw in the new colors. There is no
 * diagram/source switch here: the document toolbar's viewer menu is the
 * switch, with the built-in Markdown renderer as the source view.
 *
 * This lives at the chunk's own scope, not inside `create`: the config watch
 * the entry registers and every face a harness builds must agree on one hub.
 */
const hub = {
  state: { enabled: true, library: 'pending', themeEpoch: 0 },
  listeners: new Set(),
  /**
   * Read the current state.
   *
   * @returns {{ enabled: boolean, library: string, themeEpoch: number }} a fresh snapshot object.
   */
  snapshot() {
    return { ...hub.state }
  },
  /**
   * Merge one patch and notify when something changed.
   *
   * @param {Partial<{ enabled: boolean, library: string, themeEpoch: number }>} patch - the next values.
   * @returns {void} nothing.
   */
  patch(patch) {
    let changed = false
    for (const [key, value] of Object.entries(patch)) {
      if (hub.state[key] === value) continue
      hub.state[key] = value
      changed = true
    }
    if (changed === true) hub.publish()
  },
  /** Notify every subscriber. */
  publish() {
    for (const listener of [...hub.listeners]) listener()
  },
  /**
   * Follow future changes.
   *
   * @param {() => void} listener - notified after each change.
   * @returns {() => void} its disposer.
   */
  subscribe(listener) {
    hub.listeners.add(listener)
    return () => hub.listeners.delete(listener)
  },
}

/** The per-block record the DOM pass keeps, shared by every face. */
const tracked = new Map()

/** The in-flight module import, shared by every caller. */
let mermaidPromise = null

/** The theme the Mermaid library was last initialized with. */
let initializedTheme = null

/** Whether the palette watcher is on the body already. */
let themeWatcherInstalled = false

/** The last palette the watcher saw, so a bounce does not bump the epoch twice. */
let watchedTheme = null

window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.mermaid.js',
  factory: () => ({ bodyId: MERMAID_BODY_ID, create: (shared) => {
    const {
      h, React, primitives, StyleTag, fill, failureText, boundTranslate,
      SETTINGS_NS, MERMAID_FIELD, mermaidLibrary,
    } = shared

    /**
     * The suffixes this renderer claims, copied from the built-in Markdown
     * registration rather than extended: `.mdx` is still the plain-text
     * fallback there, and this renderer should not quietly change that.
     */
    const MARKDOWN_EXTENSIONS = ['md', 'markdown']

    /**
     * Fence-scan line ceiling.
     *
     * The scan is a prefilter over the document text; a file whose first lines
     * already hold this many (a whole book pasted into one page) disables the
     * enhancement rather than risking a scan that never matches the DOM.
     */
    const SCAN_LINE_CAP = 20000

    /** Quiet time after a DOM mutation before the pass re-runs. */
    const MERMAID_SYNC_DEBOUNCE_MS = 120

    /** Theme value fed to Mermaid while the page renders its dark palette. */
    const THEME_DARK = 'dark'

    /** Theme value fed to Mermaid while the page renders its light palette. */
    const THEME_LIGHT = 'default'

    /**
     * Read one field out of the configuration snapshot, unwrapping the live
     * reference a volatile field arrives as.
     *
     * A local copy of the address repair's reader, because chunks must not
     * depend on each other and this one is three lines.
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
     * The page palette Mermaid should draw for.
     *
     * The theme plugin marks the dark palette with a `data-ds-dark-theme`
     * attribute on the body, which is the one signal every DSH surface shares.
     *
     * @returns {string} `dark` or Mermaid's `default`.
     */
    function currentTheme() {
      if (typeof document === 'undefined') return THEME_LIGHT
      return document.body?.hasAttribute('data-ds-dark-theme') === true ? THEME_DARK : THEME_LIGHT
    }

    /**
     * Install the one-page palette watcher.
     *
     * A flip redraws every drawn diagram through `themeEpoch`; the observer
     * covers the theme plugin's own attribute writes and the media-query
     * listener covers a system-preference flip the attribute may follow late.
     * Both no-op outside a document (the Node harness), and the watcher is
     * installed once, not per preview.
     *
     * @returns {void} nothing.
     */
    function installThemeWatcher() {
      if (themeWatcherInstalled === true) return
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return
      const target = document.body
      if (target === null) return
      themeWatcherInstalled = true
      watchedTheme = currentTheme()
      /**
       * Bump the epoch when the palette actually changed.
       *
       * @returns {void} nothing.
       */
      const flip = () => {
        const theme = currentTheme()
        if (theme === watchedTheme) return
        watchedTheme = theme
        hub.patch({ themeEpoch: hub.state.themeEpoch + 1 })
      }
      new MutationObserver(flip).observe(target, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      try {
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', flip)
      } catch {
        // A listener-less engine still has the attribute observer above.
      }
    }

    /**
     * Take the vendored Mermaid build into use, or remember that it is unusable.
     *
     * The library ships as a package-local chunk (`client.mermaid-lib.js`) that
     * the entry materializes with the rest, so there is no network anywhere in
     * this path and an air-gapped machine renders like any other. The outcome —
     * library or failure — is remembered for the session, so a broken build
     * costs one check, not one per diagram.
     *
     * @returns {Promise<object|null>} the library, or null when the vendored build did not provide one.
     */
    function loadMermaid() {
      if (mermaidPromise !== null) return mermaidPromise
      mermaidPromise = (async () => {
        const lib = typeof mermaidLibrary === 'function' ? mermaidLibrary() : null
        if (lib === null || typeof lib.initialize !== 'function' || typeof lib.render !== 'function') {
          hub.patch({ library: 'unavailable' })
          return null
        }
        lib.initialize({ startOnLoad: false, securityLevel: 'strict', theme: currentTheme() })
        initializedTheme = currentTheme()
        hub.patch({ library: 'ready' })
        return lib
      })()
      return mermaidPromise
    }

    /**
     * Point Mermaid at the current palette if it moved since the last render.
     *
     * Re-initializing with only the theme changed is supported by the library,
     * and diagrams read their colors at render time, so this runs per render.
     *
     * @param {object} lib - the Mermaid module.
     * @returns {void} nothing.
     */
    function ensureMermaidTheme(lib) {
      const theme = currentTheme()
      if (theme === initializedTheme) return
      lib.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
      initializedTheme = theme
    }

    /**
     * Scan Markdown source for fenced mermaid blocks.
     *
     * The result is a prefilter: the DOM pass matches rendered code blocks
     * against these sources, so a fence the parser would not render as a
     * mermaid block must not appear here. Fence tracking follows the CommonMark
     * rules this needs — an opener of three or more backticks or tildes, up to
     * three spaces of indent, closed by a run of the same character at least as
     * long — and a fence that runs to the end of the file is kept, because the
     * parser renders it the same way. Informational strings like `` ```text `` open
     * ordinary fences so a mermaid fence nested inside them is not matched.
     *
     * @param {string} text - the Markdown document text.
     * @returns {string[]} the mermaid sources, in document order, each right-trimmed; empty when the scan gave up.
     */
    function scanMermaidBlocks(text) {
      if (typeof text !== 'string' || text === '') return []
      const lines = text.split('\n')
      if (lines.length > SCAN_LINE_CAP) return []
      const sources = []
      let fence = null
      let collecting = false
      let collected = null
      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        const opener = fence === null ? /^( {0,3})(`{3,}|~{3,})[^\S\n]*(.*)$/.exec(line) : null
        if (opener !== null) {
          const marker = opener[2][0]
          const length = opener[2].length
          const language = /^\S+/.exec(opener[3].trim())?.[0] ?? ''
          // A backtick fence's info string cannot contain a backtick; that
          // makes ``` ``` ``` an ordinary paragraph, not a fence at all.
          if (marker === '`' && opener[3].includes('`')) continue
          fence = { marker, length }
          collecting = language.toLowerCase() === 'mermaid'
          collected = collecting === true ? [] : null
          continue
        }
        if (fence !== null) {
          const closer = new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}\\s*$`).exec(line)
          if (closer !== null) {
            if (collecting === true) sources.push(collected.join('\n').replace(/\s+$/, ''))
            fence = null
            collecting = false
            collected = null
          } else if (collecting === true) {
            collected.push(line)
          }
        }
      }
      // An unterminated fence still renders, so an open mermaid one is kept.
      if (collecting === true) sources.push(collected.join('\n').replace(/\s+$/, ''))
      return sources
    }

    /**
     * Whether a path uses a Windows drive or UNC prefix.
     *
     * @param {string} path - the path to classify.
     * @returns {boolean} whether the path is Windows-styled.
     */
    function isWindowsStylePath(path) {
      return /^[A-Za-z]:[/\\]/.test(path) === true || path.startsWith('\\\\')
    }

    /**
     * Whether a path is absolute in either spelling the Host accepts.
     *
     * @param {string} path - the path to classify.
     * @returns {boolean} whether the path is absolute.
     */
    function isAbsoluteWorkspacePath(path) {
      return path.startsWith('/') || isWindowsStylePath(path)
    }

    /**
     * Split a path into its directory prefix and final segment.
     *
     * @param {string} path - a path using either separator.
     * @returns {{ directory: string, name: string }} the prefix (possibly empty) and the last segment.
     */
    function pathPartsOf(path) {
      const trimmed = path.replace(/[/\\]+$/, '')
      if (trimmed === '') return { directory: '', name: path }
      const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1
      return { directory: trimmed.slice(0, cut), name: trimmed.slice(cut) }
    }

    /**
     * Address one absolute file path through the authenticated file route.
     *
     * @param {string} base - the application base, HTTP(S) or `dsh-app://app/`.
     * @param {string} path - the native file path.
     * @returns {string|undefined} the file URL, or undefined for other transports.
     */
    function fileMediaUrl(base, path) {
      if ((/^https?:/u.test(base) === false && base.startsWith('dsh-app://app/') === false)
        || isAbsoluteWorkspacePath(path) === false
        || /^[/\\]{2}/u.test(path) === true
        || /[\u0000-\u001f\u007f]/u.test(path) === true) return undefined
      return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href
    }

    /**
     * Resolve one Markdown image destination beside the previewed file.
     *
     * The built-in Markdown body resolves exactly this way, so this renderer's
     * previews keep the images theirs did: an absolute workspace path goes
     * through the file route as-is, and a relative destination hangs off the
     * document's directory when the Host reported one.
     *
     * @param {string} base - the document base URI.
     * @param {string|undefined} documentPath - the source path the Host reported, when known.
     * @param {string} destination - the authored image URL.
     * @returns {string|undefined} the file URL, or undefined when it cannot be served.
     */
    function markdownImageUrl(base, documentPath, destination) {
      const suffix = destination.search(/[?#]/u)
      let path
      try {
        path = decodeURIComponent(suffix === -1 ? destination : destination.slice(0, suffix))
      } catch {
        return undefined
      }
      if (path.length === 0) return undefined
      // A scheme that is not a Windows drive letter is a remote image the file
      // route cannot serve; the primitive falls back to the address itself.
      if (/^[a-z]:[/\\]/iu.test(path) === false && /^[a-z][a-z\d+.-]*:/iu.test(path) === true) return undefined
      if (isAbsoluteWorkspacePath(path) === false) {
        if (documentPath === undefined) return undefined
        path = pathPartsOf(documentPath).directory + path
      }
      return fileMediaUrl(base, path)
    }

    /**
     * The element holding one rendered code block's text.
     *
     * The primitive renders unknown languages (mermaid among them) as a plain
     * `pre`; known ones may arrive as a highlighted `div`, which is the block's
     * last element child in both shapes.
     *
     * @param {Element} block - one `md-code-block` element.
     * @returns {Element|null} the text holder.
     */
    function codeHolderOf(block) {
      const pre = block.querySelector('pre')
      if (pre !== null) return pre
      return block.lastElementChild
    }

    /**
     * Read one rendered code block's source text.
     *
     * @param {Element} block - one `md-code-block` element.
     * @returns {string} the text, with any trailing blank runs trimmed.
     */
    function codeTextOf(block) {
      const holder = codeHolderOf(block)
      return holder === null ? '' : (holder.textContent ?? '').replace(/\s+$/, '')
    }

    /**
     * Draw the figure's current `shown` state into its element.
     *
     * Content writes are guarded by markers, not repeated: the observer sees
     * every write this pass makes, and only a pass that changes something may
     * produce the mutation that schedules the next one.
     *
     * @param {object} record - the tracked block.
     * @param {(key: string, params?: Record<string, string>) => string} t - the namespace translate.
     * @returns {void} nothing.
     */
    function writeShown(record, t) {
      if (record.shown === 'diagram') {
        if (record.figure.dataset.drawn !== '1') {
          // Mermaid's strict security level sanitizes this markup itself.
          record.figure.innerHTML = record.svg
          record.figure.dataset.drawn = '1'
          record.figure.dataset.note = ''
        }
        return
      }
      if (record.figure.dataset.note === record.shown && record.figure.childElementCount === 1) return
      const message = record.shown === 'loading'
        ? t('mermaid.note.loading')
        : record.shown === 'unavailable'
          ? t('mermaid.note.unavailable')
          : fill(t('mermaid.note.error'), { message: record.error })
      const note = document.createElement('div')
      note.className = 'git-panel-mermaid-note'
      if (record.shown === 'error') note.dataset.tone = 'error'
      // Text, never markup: the message can quote the diagram's own text.
      note.textContent = message
      record.figure.replaceChildren(note)
      record.figure.dataset.drawn = ''
      record.figure.dataset.note = record.shown
    }

    /**
     * Show or retire the source half of one tracked block.
     *
     * The source hides only while a diagram stands in the figure, and the
     * write happens only when the node's own state disagrees — a React
     * re-render that recreated the holder resets it, and this is what catches
     * that without touching the figure's markup.
     *
     * @param {object} record - the tracked block.
     * @returns {void} nothing.
     */
    function applyVisibility(record) {
      const shown = record.svg !== null && record.figure.isConnected === true
      const wanted = shown === true ? 'none' : ''
      if (record.holder.style.display !== wanted) record.holder.style.display = wanted
      if (record.banner !== null && record.banner.style.display !== wanted) record.banner.style.display = wanted
    }

    /**
     * What a tracked block's figure should show right now.
     *
     * @param {object} record - the tracked block.
     * @returns {string} `diagram`, `loading`, `unavailable`, or `error`.
     */
    function wantedShown(record) {
      if (record.svg !== null) return 'diagram'
      if (record.error !== null) return 'error'
      if (record.pending === true) return 'loading'
      return hub.snapshot().library === 'unavailable' ? 'unavailable' : 'loading'
    }

    /**
     * Bring one tracked record's figure and source to its record state.
     *
     * @param {object} record - the tracked block.
     * @param {(key: string, params?: Record<string, string>) => string} t - the namespace translate.
     * @returns {void} nothing.
     */
    function syncRecordFigure(record, t) {
      const wanted = wantedShown(record)
      if (wanted !== record.shown) {
        record.shown = wanted
        writeShown(record, t)
      }
      applyVisibility(record)
    }

    /**
     * Return a tracked block to the plain code block it was.
     *
     * @param {object} record - the tracked block.
     * @returns {void} nothing.
     */
    function restoreBlock(record) {
      record.svg = null
      record.shown = 'empty'
      record.figure.remove()
      record.holder.style.display = ''
      if (record.banner !== null) record.banner.style.display = ''
    }

    /**
     * Render one tracked block's diagram off the render queue.
     *
     * Everything asynchronous re-checks the token before it writes: a second
     * pass over the same block, a config turn-off, or the block leaving the
     * page must not let a stale render overwrite newer state.
     *
     * @param {object} record - the tracked block.
     * @param {string} source - the mermaid source.
     * @param {number} token - the render generation this attempt belongs to.
     * @param {(key: string, params?: Record<string, string>) => string} t - the namespace translate.
     * @returns {Promise<void>} nothing once the outcome is applied.
     */
    async function renderBlockFigure(record, source, token, t) {
      const lib = await loadMermaid()
      if (token !== record.token) return
      record.pending = false
      if (lib !== null) {
        try {
          ensureMermaidTheme(lib)
          const drawn = await lib.render(`git-panel-mermaid-${token}`, source)
          if (token !== record.token) return
          const svg = typeof drawn?.svg === 'string' ? drawn.svg : ''
          if (svg === '') throw new Error('the renderer produced no SVG')
          record.svg = svg
        } catch (error) {
          if (token !== record.token) return
          record.error = failureText(error)
        }
      }
      syncRecordFigure(record, t)
    }

    /**
     * Bring one tracked block to the state the hub describes.
     *
     * @param {Element} block - one `md-code-block` element.
     * @param {string} source - the matched mermaid source.
     * @param {(key: string, params?: Record<string, string>) => string} t - the namespace translate.
     * @returns {void} nothing.
     */
    function enhanceBlock(block, source, t) {
      const holder = codeHolderOf(block)
      if (holder === null) return
      const banner = block.firstElementChild === holder ? null : block.firstElementChild
      let record = tracked.get(block)
      if (record !== undefined && record.figure.isConnected === false) {
        // The re-render that dropped the figure dropped the drawing with it;
        // a fresh record below re-renders from the source.
        tracked.delete(block)
        record = undefined
      }
      if (record === undefined) {
        const figure = document.createElement('div')
        figure.className = 'git-panel-mermaid-figure'
        holder.after(figure)
        record = { figure, holder, banner: null, source: '', token: 0, svg: null, error: null, pending: false, shown: 'empty' }
        tracked.set(block, record)
      }
      // A React re-render can recreate the holder around the figure; keep the
      // record pointing at the live nodes and the figure beside the new one.
      record.holder = holder
      record.banner = banner
      if (record.figure.previousElementSibling !== holder) holder.after(record.figure)
      if (record.source !== source) {
        record.source = source
        record.token += 1
        record.svg = null
        record.error = null
        record.pending = true
        record.shown = 'loading'
        writeShown(record, t)
        applyVisibility(record)
        void renderBlockFigure(record, source, record.token, t)
        return
      }
      syncRecordFigure(record, t)
    }

    /**
     * Bring one rendered Markdown body's mermaid blocks to the wanted state.
     *
     * The pass is diff-shaped and safe to repeat: it writes only what moved,
     * so an observer loop settles after one idle pass. The enhancement runs
     * only for a complete document — a streaming page re-renders too often for
     * half a fence to mean anything.
     *
     * @param {HTMLElement} container - the element the Markdown body rendered into.
     * @param {{ text: string, eof: boolean, t: (key: string, params?: Record<string, string>) => string }} job - the document text and its translate.
     * @returns {number} how many rendered blocks were matched to a mermaid source.
     */
    function syncDocument(container, job) {
      if (container === null) return 0
      installThemeWatcher()
      for (const [block, record] of [...tracked]) {
        if (block.isConnected === false) tracked.delete(block)
      }
      const state = hub.snapshot()
      const sources = state.enabled === true && job.eof === true
        ? scanMermaidBlocks(job.text)
        : []
      const wanted = new Map()
      for (const source of sources) wanted.set(source, (wanted.get(source) ?? 0) + 1)
      let seen = 0
      const matched = new Set()
      for (const block of container.querySelectorAll('div.md-code-block')) {
        const source = codeTextOf(block)
        const remaining = wanted.get(source) ?? 0
        if (remaining <= 0) continue
        wanted.set(source, remaining - 1)
        seen += 1
        matched.add(block)
        enhanceBlock(block, source, job.t)
      }
      for (const [block, record] of [...tracked]) {
        if (matched.has(block) === false) {
          restoreBlock(record)
          tracked.delete(block)
        }
      }
      return seen
    }

    /**
     * The document body this renderer registers under its own id.
     *
     * The render half is the built-in Markdown body, line for line — same
     * primitive, same labels shape, same image resolver — so a preview that
     * opens through this renderer looks exactly like the built-in one except
     * for the mermaid blocks. What is added is the pass that keeps those
     * blocks drawn: subscribed to the hub, re-run on every document change,
     * and observed, because React can recreate a block without telling this
     * component's dependencies.
     *
     * @param {object} props - owner-loaded contents and localized labels.
     * @returns {object|null} the Markdown document, or nothing for a non-text delivery.
     */
    function MermaidMarkdownBody(props) {
      const { content, resourceAddress, useResource, t } = props
      const containerRef = React.useRef(null)
      const absolutePath = typeof useResource === 'function'
        ? useResource(resourceAddress)?.value?.absolutePath
        : undefined
      const baseURI = typeof document === 'undefined' ? '' : document.baseURI
      // Same resolver the built-in body builds, so relative images keep
      // working; the helpers above are this chunk's own copy of it.
      const pathImages = React.useMemo(() => ({ resolve: (destination) => markdownImageUrl(baseURI, absolutePath, destination) }), [baseURI, absolutePath])
      const copyLabel = t('mermaid.code.copy')
      const copiedLabel = t('mermaid.code.copied')
      const footnotes = t('mermaid.footnotes')
      const codeLabel = t('mermaid.codeBlock.title')
      const wrapLabel = t('mermaid.codeBlock.wrap')
      const unwrapLabel = t('mermaid.codeBlock.unwrap')
      const labels = React.useMemo(() => ({
        code: {
          copyLabel,
          copiedLabel,
          toolbarLabels: { codeLabel, wrapLabel, unwrapLabel },
        },
        footnotes,
      }), [copyLabel, copiedLabel, footnotes, codeLabel, wrapLabel, unwrapLabel])
      const [snap, setSnap] = React.useState(() => hub.snapshot())
      React.useEffect(() => {
        setSnap(hub.snapshot())
        return hub.subscribe(() => setSnap(hub.snapshot()))
      }, [])
      React.useEffect(() => {
        if (content?.kind !== 'text') return undefined
        const container = containerRef.current
        if (container === null) return undefined
        const job = { text: content.text, eof: content.eof === true, t }
        syncDocument(container, job)
        if (typeof MutationObserver !== 'function') return undefined
        let timer = 0
        const observer = new MutationObserver(() => {
          window.clearTimeout(timer)
          timer = window.setTimeout(() => syncDocument(container, job), MERMAID_SYNC_DEBOUNCE_MS)
        })
        observer.observe(container, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          window.clearTimeout(timer)
        }
      }, [content?.text, content?.eof, snap.enabled, snap.library, snap.themeEpoch, t])
      if (content?.kind !== 'text') return null
      // This mount renders `git-panel-*` class names, so it carries its own
      // copy of the stylesheet, like every other mount.
      return h(
        'div',
        { ref: containerRef, className: 'git-panel-markdown', 'data-gitpanel-markdown': true },
        h(StyleTag, null),
        primitives === null ? null : h(primitives.MarkdownText, {
          text: content.text,
          streaming: content.eof !== true,
          labels,
          pathImages,
        }),
      )
    }

    /**
     * Register this renderer's metadata with the document preview registry.
     *
     * Extension priority is what makes a `.md` file open through this body by
     * default; the built-in Markdown renderer stays one viewer choice behind
     * it in the toolbar's viewer menu, which is also the way back.
     *
     * The registry reaches this plugin through `ctx.get('documentPreviews')`,
     * never through a declared inject: a build without the document preview
     * service answers `undefined` there and this feature simply skips, while a
     * declared inject would park the whole plugin waiting for it.
     *
     * @param {object|undefined} registry - the document preview registry, or undefined where the service is absent.
     * @returns {Function} the registration's disposer, or a no-op where the service is missing.
     */
    function registerDocumentPreview(registry) {
      if (registry === null || typeof registry?.register !== 'function') return () => {}
      return registry.register({
        id: MERMAID_BODY_ID,
        extensions: MARKDOWN_EXTENSIONS,
        priority: 'extension',
        title: () => boundTranslate('mermaid.viewerLabel'),
        loading: 'text-pages',
        wrap: false,
      })
    }

    /**
     * Follow the plugin's Mermaid switch for the life of the plugin.
     *
     * The same rule the address repair reads by: unknown keeps the documented
     * default (on), and only a known `false` turns the feature off, as soon as
     * it is known.
     *
     * @param {object} ctx - the apply-scope client context.
     * @returns {Function} the disposer ending the watch.
     */
    function watchMermaidConfig(ctx) {
      const form = ctx?.configForms?.get?.(SETTINGS_NS)
      if (form === null || typeof form !== 'object') return () => {}
      /**
       * Apply the latest answer; only a known setting ever changes the hub.
       *
       * @returns {void} nothing.
       */
      const sync = () => {
        const value = settingsValue(form.getSnapshot(), MERMAID_FIELD)
        if (typeof value === 'boolean') hub.patch({ enabled: value })
      }
      const unsubscribe = typeof form.subscribe === 'function' ? form.subscribe(sync) : () => {}
      sync()
      return unsubscribe
    }

    return {
      hub,
      bodyId: MERMAID_BODY_ID,
      MermaidMarkdownBody,
      scanMermaidBlocks,
      loadMermaid,
      markdownImageUrl,
      registerDocumentPreview,
      watchMermaidConfig,
      syncDocument,
    }
  } }),
})
