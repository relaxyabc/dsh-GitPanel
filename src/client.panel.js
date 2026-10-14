/**
 * The Git tool: the full-page three-column panel.
 *
 * Split out of `client.js` as a package-local chunk. The panel owns every piece of
 * the tool's state and all of its Host traffic — the toolbar, the branches column,
 * the history column and the commit column are one component's render — and it is
 * handed the row and modal components the other chunks build, so nothing here has
 * to reach back for a definition.
 *
 * @module GitPanel/client.panel
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.panel.js',
  factory: () => ({ create: (shared) => {
    const {
      h, React, boundTranslate, cx, basename, fill, callHost, failureText, isStaleHost,
      commitMessageParts, commitTime, mainSessionIdOf, GitGlyph, StyleTag, DASH, UP, DOWN,
      COMMIT_PAGE, HISTORY_LOAD_CAP, HISTORY_LOAD_STEP, HISTORY_LOAD_AHEAD_PX,
      HISTORY_FILTER_DEBOUNCE_MS, HISTORY_VIEWPORT_PX, NO_FILES,
      rows: { ContextMenu, Dialog },
      diff: { DiffModal },
      panes: { BranchesColumn, HistoryColumn, CommitColumn },
    } = shared

    /**
     * Drop the comment lines and rim whitespace from a commit template.
     *
     * Git's own cleanup strips `#` lines before the message is stored, but the
     * panel commits with `-m`, which does not: what the box holds is exactly
     * what is committed, so the comments come out when the template is filled
     * in. Whatever survives is what the user sees and can edit.
     *
     * @param {unknown} template - the raw template text the Host read.
     * @returns {string} the usable message text, empty when nothing usable remains.
     */
    function stripTemplateComments(template) {
      if (typeof template !== 'string' || template === '') return ''
      const kept = template.split(/\r?\n/).filter((line) => line.trimStart().startsWith('#') === false)
      return kept.join('\n').replace(/^\s+/, '').replace(/\s+$/, '')
    }

    /**
     * Turn a `YYYY-MM-DD` date-input value into a UNIX timestamp in seconds.
     *
     * The boundary is the local start (or end) of that day: the date input
     * speaks the user's calendar day, while the commits carry plain seconds.
     *
     * @param {unknown} text - the date input value.
     * @param {boolean} end - whether the day's last second is wanted.
     * @returns {number|null} the boundary in seconds, or null when the value is not a usable date.
     */
    function dayBoundary(text, end) {
      if (typeof text !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(text) === false) return null
      const parsed = new Date(`${text}T${end === true ? '23:59:59' : '00:00:00'}`)
      return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000)
    }

    /**
     * The local calendar date offset from today by whole days.
     *
     * The date inputs speak the user's calendar day, so a quick range is
     * spelled in the same `YYYY-MM-DD` they display rather than in seconds.
     *
     * @param {number} back - whole days before today; 0 is today.
     * @returns {string} the date in the date input's own format.
     */
    /** A filter with no condition. @returns {{search: string, author: string, since: string, until: string}} the empty filter. */
    function emptyFilter() {
      return { search: '', author: '', since: '', until: '' }
    }

    /**
     * The query arguments one filter asks the Host for.
     *
     * The filter box has always matched a hash as well as message text, and
     * `--grep` cannot match a hash, so a hash-shaped search travels as a revision
     * instead: the Host resolves it and answers with that one commit.
     *
     * @param {{search: string, author: string, since: string, until: string}} filter - the applied filter.
     * @returns {object} the `log`/`logCount` arguments, empty for an empty filter.
     */
    function logQuery(filter) {
      const query = {}
      const search = filter.search.trim()
      const author = filter.author.trim()
      if (search !== '') {
        if (/^[0-9a-f]{4,40}$/i.test(search)) query.ref = search
        else query.search = search
      }
      if (author !== '') query.author = author
      if (filter.since !== '') query.since = filter.since
      if (filter.until !== '') query.until = filter.until
      return query
    }

    /**
     * Whether one already-loaded commit satisfies a filter.
     *
     * This narrows what the list holds right now, which is what makes typing feel
     * immediate; the authoritative set is the one the Host returns for the same
     * conditions once the debounce has passed.
     *
     * @param {object} commit - the commit row.
     * @param {{search: string, author: string, since: string, until: string}} filter - the filter to apply.
     * @returns {boolean} whether the commit stays.
     */
    function matchesFilter(commit, filter) {
      const search = filter.search.trim().toLowerCase()
      const author = filter.author.trim().toLowerCase()
      const since = dayBoundary(filter.since, false)
      const until = dayBoundary(filter.until, true)
      if (search !== '' && !(commit.hash.toLowerCase().includes(search) || commitMessageParts(commit).full.toLowerCase().includes(search))) return false
      if (author !== '' && !(`${commit.author}\n${commit.email}`.toLowerCase().includes(author))) return false
      const time = commitTime(commit)
      if (since !== null && !(time >= since)) return false
      if (until !== null && !(time <= until)) return false
      return true
    }

    function quickRangeDate(back) {
      const day = new Date()
      day.setDate(day.getDate() - back)
      const pad = (value) => String(value).padStart(2, '0')
      return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
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
      const [amendMode, setAmendMode] = React.useState(false)
      // The message the user was writing before amend mode replaced it. A ref,
      // not state: only the toggle reads it, and restoring a draft is not a
      // render input of its own.
      const amendDraft = React.useRef('')
      const [busy, setBusy] = React.useState(false)
      const [reposLoading, setReposLoading] = React.useState(false)
      const [stateLoading, setStateLoading] = React.useState(false)
      const [logLoading, setLogLoading] = React.useState(false)
      const [logHasMore, setLogHasMore] = React.useState(false)
      const [logLoadingMore, setLogLoadingMore] = React.useState(false)
      // The number of commits the applied filter matches, until the Host has
      // counted them; null means "not counted", not "none".
      const [logTotal, setLogTotal] = React.useState(null)
      const [logAutoLoading, setLogAutoLoading] = React.useState(false)
      const [logCap, setLogCap] = React.useState(HISTORY_LOAD_CAP)
      // The raw message of the selected commit, read on selection because the
      // history page carries only the subject and body.
      const [selectedMessage, setSelectedMessage] = React.useState(null)
      // A Host that predates the filter arguments answers unfiltered pages, so
      // the panel falls back to narrowing what it has and says so.
      const [staleFilter, setStaleFilter] = React.useState(false)
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
      // The history filter has two halves: the draft the inputs bind to, and the
      // query the Host was asked. The draft narrows what is already loaded while
      // the debounce runs, so typing keeps reacting without one history walk per
      // keystroke; the query is what the pages and the count are read for.
      const [historyFilter, setHistoryFilter] = React.useState(emptyFilter)
      const [logFilter, setLogFilter] = React.useState(emptyFilter)
      // The window of history rows the list renders. The panel owns it because
      // the scroll that moves it is also the scroll that reads the next page.
      const [historyViewport, setHistoryViewport] = React.useState({ top: 0, height: HISTORY_VIEWPORT_PX })
      // The commit template of the repository in force. A ref, not state: the
      // box is seeded through effects and refilled after a commit, and neither
      // is a render input of its own.
      const templateRef = React.useRef('')
      // The loaded history, readable synchronously: the page loader and the
      // "load all" loop both need the count of rows loaded *now*, and the
      // `commits` a render closed over goes stale inside that loop.
      const commitsRef = React.useRef([])
      // The raw message of the newest commit, for the amend box. A ref: the box
      // reads it on a click, and reading it is not a render of its own.
      const newestMessageRef = React.useRef(null)
      // The identity of the history read in hand. Every fresh read bumps it, so
      // a page that arrives after a refresh, a repository switch or a filter
      // change is dropped instead of being appended to a list it does not belong
      // to.
      const logRequestRef = React.useRef(0)
      // A scroll fires in bursts, and the state alone would let a second page
      // start before the re-render that disables the button.
      const logLoadingMoreRef = React.useRef(false)
      // The running "load all" loop: whether it is running, whether the user
      // asked it to stop, and the ceiling it works against.
      const logAutoLoadingRef = React.useRef(false)
      const logStopRef = React.useRef(false)
      const logCapRef = React.useRef(HISTORY_LOAD_CAP)

      /**
       * Replace the loaded history and keep its synchronous mirror in step.
       *
       * @param {Array<object>|Function} next - the rows, or an updater over them.
       * @returns {undefined} nothing.
       */
      const putCommits = React.useCallback((next) => {
        commitsRef.current = typeof next === 'function' ? next(commitsRef.current) : next
        setCommits(commitsRef.current)
      }, [])

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
      // working-tree toggle never re-reads a page of commits. The applied filter
      // belongs to this effect's identity: a filter change is a different
      // history, so it reloads from its newest match and the generation it bumps
      // drops whatever the previous filter still had in flight.
      React.useEffect(() => {
        let cancelled = false
        logRequestRef.current += 1
        // A fresh history starts at the first ceiling, whatever the previous one
        // had been raised to.
        logCapRef.current = HISTORY_LOAD_CAP
        setLogCap(HISTORY_LOAD_CAP)
        if (repository === null) {
          putCommits([])
          setLogHasMore(false)
          setLogTotal(null)
          setLogLoading(false)
          return undefined
        }
        const query = logQuery(logFilter)
        setLogLoading(true)
        setError(null)
        callHost('log', { workspaceRoot, path: repository.path, limit: COMMIT_PAGE, ...query })
          .then((payload) => {
            if (cancelled) return
            const page = Array.isArray(payload.commits) ? payload.commits : []
            putCommits(page)
            setLogHasMore(payload.hasMore === true)
            // A Host that predates the filter arguments ignores them, which shows
            // up as a page carrying commits the filter would have excluded: the
            // panel then falls back to narrowing what it has and says so.
            if (Object.keys(query).length > 0 && page.some((commit) => matchesFilter(commit, logFilter) === false)) setStaleFilter(true)
            else setStaleFilter(false)
          })
          .catch((failure) => {
            if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
          })
          .finally(() => {
            if (!cancelled) setLogLoading(false)
          })
        // The count is read alongside the first page: the header shows how much
        // of a matching history is loaded, and the loader needs to know when it
        // has reached the end. A Host that cannot answer leaves it unknown.
        callHost('logCount', { workspaceRoot, path: repository.path, ...query })
          .then((payload) => {
            if (!cancelled) setLogTotal(Number.isFinite(payload?.total) ? payload.total : null)
          })
          .catch(() => {
            if (!cancelled) setLogTotal(null)
          })
        return () => {
          cancelled = true
        }
      }, [repository, workspaceRoot, logToken, logFilter, putCommits])

      // A filter draft becomes the query once the user stops typing. Every
      // applied filter costs the Host a walk of the matching history, so the
      // debounce is what keeps a six-letter search from spending six of them.
      React.useEffect(() => {
        const timer = window.setTimeout(() => setLogFilter(historyFilter), HISTORY_FILTER_DEBOUNCE_MS)
        return () => window.clearTimeout(timer)
      }, [historyFilter])

      /**
       * Read the next page of the selected repository's history.
       *
       * The page continues after the commits already loaded, and is dropped when
       * a refresh, a repository switch or a filter change happened meanwhile: the
       * read generation is what keeps two histories from being concatenated into
       * one list. Rows are de-duplicated by hash for a history that moved between
       * the reads.
       *
       * @returns {Promise<{appended: number, hasMore: boolean}|null>} the page that landed, or null when nothing was read.
       */
      const loadMoreCommits = React.useCallback(() => {
        if (repository === null || logHasMore !== true || logLoadingMoreRef.current === true) return Promise.resolve(null)
        const generation = logRequestRef.current
        const skip = commitsRef.current.length
        logLoadingMoreRef.current = true
        setLogLoadingMore(true)
        return callHost('log', { workspaceRoot, path: repository.path, limit: COMMIT_PAGE, skip, ...logQuery(logFilter) })
          .then((payload) => {
            if (generation !== logRequestRef.current) return null
            const page = Array.isArray(payload.commits) ? payload.commits : []
            putCommits((current) => {
              const seen = new Set(current.map((entry) => entry.hash))
              return current.concat(page.filter((entry) => seen.has(entry.hash) === false))
            })
            setLogHasMore(payload.hasMore === true)
            return { appended: page.length, hasMore: payload.hasMore === true }
          })
          .catch((failure) => {
            if (generation === logRequestRef.current) setError(failure instanceof Error ? failure.message : String(failure))
            return null
          })
          .finally(() => {
            logLoadingMoreRef.current = false
            setLogLoadingMore(false)
          })
      }, [logFilter, logHasMore, putCommits, repository, workspaceRoot])

      /**
       * Read the rest of the matching history in the background.
       *
       * One page at a time, sequentially: the Host walks the matching history for
       * every page it answers, so a burst of parallel requests would only make it
       * walk the same commits several times. The loop ends at the ceiling the
       * panel keeps loaded, when the history runs out, when the user stops it, or
       * when the read it is on top of no longer belongs to the list in force.
       *
       * @returns {Promise<void>} resolves when the loop ends.
       */
      const loadAllCommits = React.useCallback(async () => {
        if (repository === null || logAutoLoadingRef.current === true) return
        const generation = logRequestRef.current
        const cap = logCapRef.current
        logAutoLoadingRef.current = true
        logStopRef.current = false
        setLogAutoLoading(true)
        try {
          while (generation === logRequestRef.current && logStopRef.current === false && commitsRef.current.length < cap) {
            const page = await loadMoreCommits()
            if (page === null || page.appended === 0 || page.hasMore !== true) break
          }
        } finally {
          logAutoLoadingRef.current = false
          setLogAutoLoading(false)
        }
      }, [loadMoreCommits, repository])

      /**
       * Ask a running drain to stop after the page it is reading.
       *
       * @returns {undefined} nothing.
       */
      const stopLoadingAll = React.useCallback(() => {
        logStopRef.current = true
      }, [])

      /**
       * Raise the loaded-history ceiling one step and keep loading.
       *
       * @returns {undefined} nothing.
       */
      const raiseLoadCap = React.useCallback(() => {
        logCapRef.current += HISTORY_LOAD_STEP
        setLogCap(logCapRef.current)
        loadAllCommits()
      }, [loadAllCommits])

      /**
       * Follow one history scroll.
       *
       * A scroll does two jobs: it moves the window of rendered rows, and near the
       * end of what is loaded it reads the next page, so the history keeps going
       * without a control to hunt for.
       *
       * @param {object} element - the history list that scrolled.
       * @returns {undefined} nothing.
       */
      const onHistoryScroll = React.useCallback((element) => {
        setHistoryViewport({ top: element.scrollTop, height: element.clientHeight })
        if (element.scrollHeight - element.scrollTop - element.clientHeight <= HISTORY_LOAD_AHEAD_PX) loadMoreCommits()
      }, [loadMoreCommits])

      // The selected repository's commit template, read once per repository
      // alongside the history: one cheap config probe and at most one small
      // file. The box is seeded only while it is still empty, so a draft the
      // user has already typed is never replaced; an older Host half does not
      // know the operation, and a missing template is a convenience the panel
      // stays quiet about rather than an error to report.
      React.useEffect(() => {
        let cancelled = false
        templateRef.current = ''
        if (repository === null) return undefined
        callHost('commitTemplate', { workspaceRoot, path: repository.path })
          .then((payload) => {
            if (cancelled) return
            const template = stripTemplateComments(payload?.template)
            templateRef.current = template
            if (template !== '') setMessage((current) => (current === '' ? template : current))
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [repository, workspaceRoot])

      // A selection belongs to the repository it was made in — and so does the
      // amend box: a draft and an amend target never cross repositories.
      React.useEffect(() => {
        setSelectedCommit(null)
        setSelectedFile(null)
        setCommitFiles([])
        setFilesError(null)
        setSelectedPaths(new Set())
        setAmendMode(false)
        amendDraft.current = ''
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

      /** The hash of the newest loaded commit: the only one the amend box edits. */
      const newestHash = commits[0]?.hash ?? null

      /**
       * The raw message of the selected commit.
       *
       * The history page carries the subject and the body only, so the one commit
       * the detail column shows is the one whose whole message is read. The text
       * is kept with the hash it belongs to: a selection that moves on before the
       * read lands must not show the previous commit's message.
       */
      React.useEffect(() => {
        let cancelled = false
        if (selectedCommit === null || repository === null) {
          setSelectedMessage(null)
          return undefined
        }
        callHost('commitMessage', { workspaceRoot, path: repository.path, commit: selectedCommit.hash })
          .then((payload) => {
            if (cancelled) return
            setSelectedMessage(typeof payload?.message === 'string' ? { hash: selectedCommit.hash, message: payload.message } : null)
          })
          .catch((failure) => {
            if (cancelled) return
            setSelectedMessage(null)
            // An older Host does not know the operation; the subject and body the
            // page carries are then all the detail column can show.
            if (isStaleHost(failure)) setStaleHost(true)
          })
        return () => {
          cancelled = true
        }
      }, [selectedCommit, repository, workspaceRoot])

      /**
       * The raw message of the newest commit, for the amend box.
       *
       * The box is filled synchronously when the toggle or a menu row is used, so
       * the read happens as soon as there is a newest commit to amend. Keyed by
       * the hash rather than the list, because appending a page must not re-read
       * a message that has not changed.
       */
      React.useEffect(() => {
        let cancelled = false
        newestMessageRef.current = null
        if (newestHash === null || repository === null) return undefined
        callHost('commitMessage', { workspaceRoot, path: repository.path, commit: newestHash })
          .then((payload) => {
            if (!cancelled && typeof payload?.message === 'string') newestMessageRef.current = payload.message
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [newestHash, repository, workspaceRoot])

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
       * In amend mode the same call rewrites the newest commit instead of adding
       * one: git folds whatever is staged into it, so the panel only has to name
       * `amend` and let the Host pass it to `git commit --amend`.
       *
       * @param {boolean} all - whether to stage every change first.
       * @param {boolean} push - whether to publish afterwards.
       * @returns {Promise<void>} nothing.
       */
      async function commit(all, push) {
        const text = message.trim()
        if (text === '') return
        const amending = amendMode === true
        const payload = await mutate('commit', { message: text, all, amend: amending }, undefined)
        if (payload === null) return
        // A plain commit is followed by a fresh template, the way Git's own
        // editor seeds every new message; a rewritten commit hands back an
        // empty box instead.
        setMessage(amending === true ? '' : templateRef.current)
        if (amending) {
          amendDraft.current = ''
          setAmendMode(false)
        }
        const short = String(payload.hash ?? '').slice(0, 8)
        if (!push) {
          setNotice(fill(amending ? t('notice.amendCommitted') : t('notice.committed'), { short }))
          return
        }
        const pushed = await mutate('push', { remote: state?.remoteNames?.[0] }, undefined, 'state')
        setNotice(pushed === null ? fill(t('notice.committedPushFailed'), { short }) : fill(t('notice.committedPushed'), { short }))
      }

      /**
       * Flip the commit box between committing and amending.
       *
       * Turning amend on swaps the draft for the newest commit's own message, so
       * the user edits what is already there rather than retyping it; turning it
       * off hands the draft back instead of losing it.
       *
       * @returns {undefined} nothing.
       */
      function toggleAmend() {
        if (amendMode === true) {
          setAmendMode(false)
          setMessage(amendDraft.current)
          return
        }
        const newest = commits[0]
        if (newest === undefined) return
        amendDraft.current = message
        // The newest commit's raw message is read as soon as it becomes the
        // newest; a Host that cannot answer leaves the subject and body.
        setMessage(commitMessageParts({ ...newest, message: newestMessageRef.current ?? undefined }).full)
        setAmendMode(true)
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
        return [
          {
            label: t('menu.editMessage'),
            disabled: !newest,
            title: newest ? undefined : t('amend.newestOnly'),
            run: () => setDialog({ title: t('amend'), input: commitMessageParts({ ...commit, message: newestMessageRef.current ?? undefined }).full, multiline: true, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
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
            run: () => setDialog({ title: t('amend'), input: commitMessageParts({ ...commit, message: newestMessageRef.current ?? undefined }).full, multiline: true, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
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
       * Merge one branch into the branch that is checked out.
       *
       * Git reads the message for the merge commit from `-m` here rather than
       * from an editor, so the dialog supplies one; `fill` lets the notice name
       * the branch that was integrated.
       *
       * @param {string} name - the branch to merge from.
       * @param {string} value - the merge commit message from the dialog.
       * @returns {Promise<void>} nothing.
       */
      async function mergeBranch(name, value) {
        const text = String(value ?? '').trim()
        if (text === '') return
        const payload = await mutate('merge', { branch: name, message: text }, undefined)
        setNotice(payload === null ? fill(t('notice.mergeConflicted'), { name }) : fill(t('notice.merged'), { name }))
      }

      /**
       * Replay the branch that is checked out onto another commit.
       *
       * @param {string} name - the commit or branch to rebase onto.
       * @returns {Promise<void>} nothing.
       */
      async function rebaseOnto(name) {
        const payload = await mutate('rebase', { branch: name }, undefined)
        setNotice(payload === null ? fill(t('notice.rebaseConflicted'), { name }) : fill(t('notice.rebased'), { name }))
      }

      /**
       * Build the branch context-menu rows.
       *
       * @param {object} branch - the branch under the pointer.
       * @param {boolean} remote - whether it tracks a remote.
       * @returns {Array<object>} the rows.
       */
      function branchMenu(branch, remote) {
        // Merging and rebasing both change the branch that is checked out, so a
        // remote-tracking row — where a checkout would first create a local
        // branch — is named as the branch to integrate from, never as the target.
        const mergeItem = {
          label: fill(t('menu.merge'), { name: currentBranch ?? t('detached') }),
          disabled: branch.current === true,
          run: () =>
            setDialog({
              title: fill(t('dialog.merge.title'), { name: branch.name }),
              text: fill(t('dialog.merge.text'), { name: branch.name, current: currentBranch ?? t('detached') }),
              warning: t('dialog.merge.warning'),
              input: fill(t('dialog.merge.message'), { name: branch.name }),
              multiline: true,
              confirm: t('dialog.merge.confirm'),
              run: (value) => mergeBranch(branch.name, value),
            }),
        }
        const rebaseItem = {
          label: fill(t('menu.rebase'), { name: currentBranch ?? 'HEAD' }),
          disabled: branch.current === true,
          run: () =>
            setDialog({
              title: fill(t('dialog.rebase.title'), { name: branch.name }),
              text: fill(t('dialog.rebase.text'), { name: branch.name, current: currentBranch ?? t('detached') }),
              warning: t('dialog.rebase.warning'),
              confirm: t('dialog.rebase.confirm'),
              run: () => rebaseOnto(branch.name),
            }),
        }
        if (remote) {
          const local = branch.name.replace(/^[^/]+\//, '')
          return [
            { label: `${t('checkout')} "${local}"`, run: () => mutate('checkout', { name: local, create: true, startPoint: branch.name }, fill(t('notice.checkedOut'), { name: local })) },
            { label: `${t('cherryPick')} into ${currentBranch ?? 'HEAD'}`, run: () => mutate('cherryPick', { commit: branch.name }, fill(t('notice.cherryPicked'), { name: branch.name })) },
            { separator: true },
            mergeItem,
            rebaseItem,
            { separator: true },
            { label: t('copyHash'), run: () => copyText(branch.name) },
          ]
        }
        return [
          { label: `${t('checkout')} ${branch.name}`, disabled: branch.current === true, run: () => mutate('checkout', { name: branch.name }, fill(t('notice.switched'), { name: branch.name })) },
          { separator: true },
          mergeItem,
          rebaseItem,
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

      /** Whether any history filter condition is set. */
      const historyFilterActive = historyFilter.search !== '' || historyFilter.author !== '' || historyFilter.since !== '' || historyFilter.until !== ''

      /**
       * Clear every history filter at once.
       *
       * @returns {undefined} nothing.
       */
      function clearHistoryFilter() {
        setHistoryFilter({ search: '', author: '', since: '', until: '' })
      }

      /**
       * The quick time ranges the history filter offers.
       *
       * `back` is whole days before today: a range fills the since bound with
       * that day and leaves the until bound empty, so the window always runs
       * to now. The labels are read at render time like every other string.
       */
      const quickRanges = [
        { key: 'day', back: 0, label: t('historyFilter.range.day') },
        { key: 'week', back: 6, label: t('historyFilter.range.week') },
        { key: 'fortnight', back: 14, label: t('historyFilter.range.fortnight') },
        { key: 'month', back: 29, label: t('historyFilter.range.month') },
      ]

      /**
       * The quick range whose window the current bounds still match.
       *
       * Derived, not stored: a hand-edited bound simply stops matching any
       * range and the select falls back to the custom entry on its own.
       */
      const activeRange = historyFilter.until === '' ? quickRanges.find((range) => quickRangeDate(range.back) === historyFilter.since)?.key ?? '' : ''

      /**
       * Apply one quick time range, or clear both bounds for all time.
       *
       * @param {string} key - the selected range key, empty for all time.
       * @returns {undefined} nothing.
       */
      function applyQuickRange(key) {
        const range = quickRanges.find((entry) => entry.key === key)
        setHistoryFilter((value) => ({ ...value, since: range === undefined ? '' : quickRangeDate(range.back), until: '' }))
      }

      /**
       * The loaded history narrowed by the filter draft.
       *
       * The authoritative filtered set is the one the Host returns for the same
       * conditions; this narrows what is already loaded so the list reacts while
       * the debounce to that query is still running. When the draft and the
       * applied filter agree — the steady state — this is the identity on the
       * pages the Host sent, and the two can never disagree about a row.
       */
      const filteredCommits = React.useMemo(() => {
        const active = historyFilter.search !== '' || historyFilter.author !== '' || historyFilter.since !== '' || historyFilter.until !== ''
        return active === false ? commits : commits.filter((commit) => matchesFilter(commit, historyFilter))
      }, [commits, historyFilter])

      /**
       * The selected commit with its raw message, once the Host has answered.
       *
       * The detail column reads the whole message through `commitMessageParts`,
       * which falls back to the subject and body the page carries, so this only
       * has to attach the text when it belongs to the commit in hand.
       */
      const detailCommit = selectedCommit !== null && selectedMessage !== null && selectedMessage.hash === selectedCommit.hash
        ? { ...selectedCommit, message: selectedMessage.message }
        : selectedCommit

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
        // A stopped merge or rebase is neither an error the user typed nor a
        // working-tree edit: it is a repository state that needs deciding on, so
        // it gets the banner with the buttons that resolve it while the toolbar
        // controls keep working.
        state?.inProgress === 'merge'
          ? h(
              'div',
              { className: cx('git-panel-banner', 'git-panel-banner-warn', 'git-panel-banner-actions') },
              h('span', { className: 'git-panel-banner-text' }, t('mergeInProgress')),
              h('button', { type: 'button', className: 'git-panel-btn', disabled: busy, onClick: () => mutate('commit', { noEdit: true }, t('notice.mergeCompleted')) }, t('mergeComplete')),
              h('button', { type: 'button', className: 'git-panel-btn', disabled: busy, onClick: () => mutate('mergeAbort', {}, t('notice.mergeAborted')) }, t('mergeAbort')),
            )
          : state?.inProgress === 'rebase'
            ? h(
                'div',
                { className: cx('git-panel-banner', 'git-panel-banner-warn', 'git-panel-banner-actions') },
                h('span', { className: 'git-panel-banner-text' }, t('rebaseInProgress')),
                h('button', { type: 'button', className: 'git-panel-btn', disabled: busy, onClick: () => mutate('rebaseContinue', {}, t('notice.rebaseContinued')) }, t('rebaseContinue')),
                h('button', { type: 'button', className: 'git-panel-btn', disabled: busy, onClick: () => mutate('rebaseAbort', {}, t('notice.rebaseAborted')) }, t('rebaseAbort')),
              )
            : state?.inProgress === undefined || state.inProgress === null
              ? null
              : h('div', { className: cx('git-panel-banner', 'git-panel-banner-warn') }, fill(t('inProgress.other'), { kind: state.inProgress })),
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
                h(BranchesColumn, {
                  amendMode, canAmend: commits.length > 0, branchFilter, branchMenu, branches, busy,
                  commit, copyText, diff, files, filteredBranches, filteredRemotes, groups, message,
                  mutate, openDiff, pickedPaths, remotes, selectEverything, selectedCommit,
                  selectedFile, selectedPaths, setBranchFilter, setGroups, setMenu, setMessage,
                  setSelectedCommit, setSelectedFile, setSelectedStaged, state, t, toggleAmend,
                  togglePicked,
                }),
                // ---- middle: history ------------------------------------------
                h(HistoryColumn, {
                  activeRange, applyQuickRange, autoLoading: logAutoLoading,
                  capped: logHasMore === true && commits.length >= logCap, clearHistoryFilter, commitMenu,
                  commits, filteredCommits, historyFilter, historyFilterActive, loadMore: loadMoreCommits,
                  loadingMore: logLoadingMore, more: logHasMore, onLoadAll: loadAllCommits,
                  onRaiseCap: raiseLoadCap, onScroll: onHistoryScroll, onStopLoad: stopLoadingAll,
                  quickRanges, selectedCommit, setHistoryFilter, setMenu, setSelectedCommit,
                  setSelectedFile, staleFilter, t, total: logTotal, viewport: historyViewport,
                }),
                // ---- right: the commit message above, its files below ---------
                h(CommitColumn, {
                  commitFiles, commitMessageMenu, filesError, filesLoading, openDiff,
                  selectedCommit: detailCommit, selectedFile, setMenu, setSelectedFile, t,
                }),
              ),
        menu === null ? null : h(ContextMenu, { menu, onClose: closeMenu }),
        dialog === null ? null : h(Dialog, { dialog, onClose: () => setDialog(null), t }),
        diffOpen && activeFile !== null && repository !== null ? h(DiffModal, { file: activeFile, commit: selectedCommit, text: diff, stale: staleHost, whole: wholeFileDiff, onClose: () => setDiffOpen(false), t }) : null,
      )
    }

    return { GitPanel }
  } }),
})
