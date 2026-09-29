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
      mainSessionIdOf, GitGlyph, StyleTag, DASH, UP, DOWN, COMMIT_PAGE, NO_FILES,
      rows: { ContextMenu, Dialog },
      diff: { DiffModal },
      panes: { BranchesColumn, HistoryColumn, CommitColumn },
    } = shared

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
        setMessage('')
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
        setMessage(newest.body === '' ? newest.subject : `${newest.subject}\n\n${newest.body}`)
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
        const fullMessage = commit.body === '' ? commit.subject : `${commit.subject}\n\n${commit.body}`
        return [
          {
            label: t('menu.editMessage'),
            disabled: !newest,
            title: newest ? undefined : t('amend.newestOnly'),
            run: () => setDialog({ title: t('amend'), input: fullMessage, multiline: true, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
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
            run: () => setDialog({ title: t('amend'), input: commit.body === '' ? commit.subject : `${commit.subject}\n\n${commit.body}`, multiline: true, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
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
                  commitMenu, commits, selectedCommit, setMenu, setSelectedCommit, setSelectedFile,
                  t,
                }),
                // ---- right: the commit message above, its files below ---------
                h(CommitColumn, {
                  commitFiles, commitMessageMenu, filesError, filesLoading, openDiff, selectedCommit,
                  selectedFile, setMenu, setSelectedFile, t,
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
