/**
 * The file-preview repair, and the reader it is built on.
 *
 * Split out of `client.js` as a package-local chunk: the browser half has to
 * replace `URL` for one address scheme without disturbing any other, and the whole
 * of that — the derivation, the wrapper, and the settings subscription that turns
 * it on and off — belongs in one place a reader can audit against the upstream
 * defect. `client.js` binds it and installs it during apply.
 *
 * @module GitPanel/client.preview-fix
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.preview-fix.js',
  factory: () => ({ create: (shared) => {
    const { FILE_PREVIEW_FIELD, RESOURCE_PREFIX, SETTINGS_NS } = shared

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

    return { resourceProtocolOf, watchFilePreviewFix }
  } }),
})
