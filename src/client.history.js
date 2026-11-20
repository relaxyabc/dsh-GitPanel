/**
 * The history column and the selected commit's column.
 *
 * Split out of `client.panel.js` as a package-local chunk. Both are pure functions
 * of the panel's state and callbacks: the commit list, and the commit message box
 * above the files that commit touched.
 *
 * @module GitPanel/client.history
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.history.js',
  factory: () => ({ create: (shared) => {
    const {
      h, React, cx, boundTranslate, absoluteDate, commitTime, commitMessageParts, fill, DOT_GLYPH, DASH,
      CARET_OPEN, STAR_GLYPH, STAR_OPEN_GLYPH,
      HISTORY_ROW_HEIGHT, HISTORY_WINDOW_OVERSCAN,
      rows: { CommitRow },
    } = shared

    /** Width of the branch filter popup, in pixels. */
    const BRANCH_MENU_WIDTH = 280

    /** Room kept between the popup and the window edge, in pixels. */
    const BRANCH_MENU_MARGIN = 8

    /**
     * The right column: the commit message box, then the selected commit's files.
     *
     * @param {object} props - the panel's state and actions, passed straight down.
     * @returns {object} the column element.
     */
    function CommitColumn(props) {
      const {
        commitFiles, commitMessageMenu, filesError, filesLoading, openDiff, selectedCommit, selectedFile,
        setMenu, setSelectedFile, t, width,
      } = props
      // The raw message keeps the newlines the folded subject lost, so the
      // detail head splits it again: the first line bold, the rest below.
      const parts = commitMessageParts(selectedCommit)
      return (
        h(
          'div',
          {
            className: cx('git-panel-col', 'git-panel-col-right'),
            // A splitter drag carries the width inline; without one the
            // stylesheet's default stands.
            style: typeof width === 'number' ? { width } : undefined,
          },
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
                    h('div', { className: 'git-panel-detail-subject' }, parts.subject || t('noMessage')),
                    h(
                      'div',
                      { className: 'git-panel-kv' },
                      h('div', { className: 'git-panel-kv-key' }, t('hash')),
                      h('div', { className: cx('git-panel-kv-value', 'git-panel-mono') }, selectedCommit.hash),
                      h('div', { className: 'git-panel-kv-key' }, t('author')),
                      h('div', { className: 'git-panel-kv-value' }, `${selectedCommit.author} <${selectedCommit.email}>`),
                      h('div', { className: 'git-panel-kv-key' }, t('date')),
                      h('div', { className: 'git-panel-kv-value' }, absoluteDate(commitTime(selectedCommit))),
                      h('div', { className: 'git-panel-kv-key' }, t('parents')),
                      h('div', { className: cx('git-panel-kv-value', 'git-panel-mono') }, selectedCommit.parents.map((parent) => parent.slice(0, 8)).join(' ') || DASH),
                    ),
                    parts.body === '' ? null : h('div', { className: 'git-panel-detail-body' }, parts.body),
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
        )
      )
    }

    /**
     * Lay the visible commits out on graph lanes, the way `git log --graph`
     * draws them: every commit takes the lane its hash was reserved on, its
     * first parent continues straight down that lane — unless another child
     * already claimed that parent, in which case the edge joins it as a curve
     * — and every extra parent either joins a lane that already waits for it
     * or opens a new one behind a merge curve. Parents outside the visible
     * page — a truncated page, or a commit the filters hid — draw a stub that
     * ends at their row instead of an empty lane running on; once the next
     * page is loaded the stub becomes the lane it always was.
     *
     * @param {{hash: string, parents?: string[]}[]} commits - the rendered page, newest first.
     * @returns {{columns: number, rows: Array<{lane: number, incoming: boolean, fulls: number[], below: number[], curves: Array<{from: number, to: number}>}}} the lane count and, per commit, the lanes to draw.
     */
    function commitGraphRows(commits) {
      const visible = new Set(commits.map((commit) => commit.hash))
      /** The hash each lane is waiting for, or null while the lane is free. */
      const slots = []
      /**
       * Reserve a lane, reusing an emptied slot first so the x positions of
       * the surviving lanes never jump.
       *
       * @returns {number} the reserved lane index.
       */
      const freeSlot = () => {
        const reuse = slots.indexOf(null)
        if (reuse !== -1) return reuse
        slots.push(null)
        return slots.length - 1
      }
      const rows = commits.map((commit) => {
        const parents = [...new Set(Array.isArray(commit.parents) ? commit.parents.filter((parent) => typeof parent === 'string' && parent !== '') : [])]
        let lane = slots.indexOf(commit.hash)
        const incoming = lane !== -1
        if (incoming === false) {
          lane = freeSlot()
          // Reserve the lane under the commit's own hash: an extra parent that
          // needs a fresh lane must not land on the lane this very row sits on.
          slots[lane] = commit.hash
        }
        // Lanes that already carry a hash run straight through this row.
        const fulls = []
        for (let index = 0; index < slots.length; index += 1) {
          if (index !== lane && slots[index] !== null) fulls.push(index)
        }
        const curves = []
        const first = parents[0] ?? null
        if (first === null) {
          // A root: nothing waits on this lane any more.
          slots[lane] = null
        } else if (slots.indexOf(first) !== -1) {
          // Another child already claimed the first parent's lane: the edge
          // joins it as a curve and this lane ends here instead of forking a
          // second waiting slot for the same hash.
          curves.push({ from: lane, to: slots.indexOf(first) })
          slots[lane] = null
        } else {
          // The usual case: the first parent continues straight down this
          // lane, on the page or as a stub when the page does not carry it.
          slots[lane] = visible.has(first) === true ? first : null
        }
        parents.slice(1).forEach((parent) => {
          let target = slots.indexOf(parent)
          if (target === -1) {
            target = freeSlot()
            // A parent the page does not show leaves a stub: the curve is
            // drawn, but the slot dies with the row so no empty lane runs on.
            slots[target] = visible.has(parent) === true ? parent : null
          }
          curves.push({ from: lane, to: target })
        })
        // The lane below the dot carries the first parent when it kept this
        // lane; a claimed or root lane ends at the dot.
        const below = slots[lane] !== null ? [...fulls, lane] : [...fulls]
        return { lane, incoming, fulls, below, curves }
      })
      let columns = 1
      for (const row of rows) {
        columns = Math.max(columns, row.lane + 1, ...row.fulls.map((slot) => slot + 1), ...row.curves.map((curve) => Math.max(curve.from, curve.to) + 1))
      }
      return { columns, rows }
    }

    /**
     * One branch row of the branch filter popup: the favorite star, then the
     * branch name, with the checked-out one tagged the way the branch column
     * tags it.
     *
     * @param {object} props - row inputs.
     * @param {string} props.name - the full branch name.
     * @param {boolean} props.current - whether the branch is checked out.
     * @param {boolean} props.favorite - whether the branch is starred.
     * @param {boolean} props.selected - whether this branch is the active filter.
     * @param {Function} props.onPick - called with the branch name on click.
     * @param {Function} props.onToggleFavorite - called with the branch name when the star is used.
     * @param {Function} props.t - the translator.
     * @returns {object} the row element.
     */
    function BranchMenuRow({ name, current, favorite, selected, onPick, onToggleFavorite, t }) {
      return h(
        'div',
        { className: 'git-panel-branch-menu-item' },
        h(
          'button',
          {
            type: 'button',
            className: 'git-panel-branch-menu-star',
            title: t(favorite === true ? 'branchFilter.unstar' : 'branchFilter.star'),
            'aria-label': `${t(favorite === true ? 'branchFilter.unstar' : 'branchFilter.star')} ${name}`,
            'aria-pressed': favorite === true,
            onClick: (event) => {
              event.stopPropagation()
              onToggleFavorite(name)
            },
          },
          h('span', { className: favorite === true ? 'git-panel-branch-menu-star-on' : undefined }, favorite === true ? STAR_GLYPH : STAR_OPEN_GLYPH),
        ),
        h(
          'button',
          {
            type: 'button',
            className: cx('git-panel-branch-menu-name', selected === true ? 'git-panel-row-sel' : false),
            title: name,
            onClick: () => onPick(name),
          },
          current === true ? h('span', { className: 'git-panel-tag' }, 'HEAD') : null,
          h('span', { className: 'git-panel-branch' }, name),
        ),
      )
    }

    /**
     * The branch filter popup, the one IDEA's Git log opens from its filter bar.
     *
     * A search box filters every list below it; HEAD stands first as the default
     * walk, then the sections in the order IDEA shows them: the branches this
     * checkout recently visited, the starred favorites, the local branches, and
     * one group per remote. Rows are picked with a click and starred with their
     * star; the popup closes on the scrim, on Escape, and on a pick.
     *
     * The lists arrive through props — the panel owns the repository data, the
     * favorites and the recent read — so this stays a pure function of them and
     * of its own search box.
     *
     * @param {object} props - popup inputs.
     * @param {{left: number, top: number}} props.anchor - the chip rectangle the popup hangs from.
     * @param {Array<object>} props.branches - the local branch rows.
     * @param {Array<object>} props.remotes - the remote-tracking branch rows.
     * @param {string|null} props.currentBranch - the checked-out branch, null when detached.
     * @param {string[]} props.favorites - the starred branch names, in display order.
     * @param {string[]|null} props.recent - the recently checked-out names, newest first; null until read.
     * @param {string} props.search - the popup's search box value, owned by the panel.
     * @param {Function} props.onSearch - updates the search box value.
     * @param {string} props.selected - the branch the filter points at, empty for HEAD.
     * @param {Function} props.onPick - called with the picked branch name, empty for HEAD.
     * @param {Function} props.onToggleFavorite - called with the starred branch name.
     * @param {Function} props.onClose - closes the popup.
     * @param {Function} [props.t] - the translator.
     * @returns {object} the popup element.
     */
    function BranchFilterMenu({ anchor, branches, remotes, currentBranch, favorites, recent, search, onSearch, selected, onPick, onToggleFavorite, onClose, t = boundTranslate }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const needle = search.trim().toLowerCase()
      /** Whether one branch name survives the search box. */
      const named = (name) => needle === '' || name.toLowerCase().includes(needle)
      // A name the repository no longer carries must not dead-end the filter,
      // so every section intersects with what exists; the recent read especially
      // names branches the reflog remembers but the checkout may have deleted.
      const exists = new Set([...branches, ...remotes].map((branch) => branch.name))
      const headShown = needle === '' || 'head'.includes(needle) === true
      const recentNames = (Array.isArray(recent) ? recent : []).filter((name) => named(name) === true && exists.has(name) === true)
      const favoriteNames = (Array.isArray(favorites) ? favorites : []).filter((name) => named(name) === true && exists.has(name) === true)
      const localNames = branches.filter((branch) => named(branch.name) === true).map((branch) => branch.name)
      const remoteGroups = []
      for (const branch of remotes) {
        if (named(branch.name) === false) continue
        const remote = branch.name.split('/')[0]
        const group = remoteGroups.find((entry) => entry.remote === remote)
        if (group === undefined) remoteGroups.push({ remote, names: [branch.name] })
        else group.names.push(branch.name)
      }
      const nothingShown = headShown === false && recentNames.length === 0 && favoriteNames.length === 0 && localNames.length === 0 && remoteGroups.length === 0

      const left = Math.max(BRANCH_MENU_MARGIN, Math.min(anchor.left, window.innerWidth - BRANCH_MENU_WIDTH - BRANCH_MENU_MARGIN))
      const top = anchor.top + 6

      /**
       * One favorite star's state for a branch name.
       *
       * @param {string} name - the branch.
       * @returns {boolean} whether it is starred.
       */
      const starred = (name) => Array.isArray(favorites) === true && favorites.includes(name) === true

      return h(
        React.Fragment,
        null,
        h('div', { className: 'git-panel-scrim', onClick: onClose, onContextMenu: (event) => { event.preventDefault(); onClose() } }),
        h(
          'div',
          { className: 'git-panel-branch-menu', style: { left, top, width: BRANCH_MENU_WIDTH } },
          h('input', {
            className: 'git-panel-input git-panel-branch-menu-search',
            value: search,
            placeholder: t('branchesFilter'),
            title: t('branchesFilter'),
            'aria-label': t('branchesFilter'),
            autoFocus: true,
            onChange: (event) => onSearch(event.target.value),
          }),
          // HEAD first: picking it clears the branch filter and the history
          // reads the checked-out state again, which is what it walked before
          // any branch was chosen.
          headShown === true
            ? h(
                'div',
                { className: 'git-panel-branch-menu-item', key: 'head' },
                h('span', { className: 'git-panel-branch-menu-spacer' }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: cx('git-panel-branch-menu-name', selected === '' ? 'git-panel-row-sel' : false),
                    title: t('branchFilter.head.hint'),
                    onClick: () => onPick(''),
                  },
                  h('span', { className: 'git-panel-branch' }, 'HEAD'),
                ),
              )
            : null,
          recentNames.length === 0 ? null : h('div', { className: 'git-panel-branch-menu-head' }, t('branchFilter.recent')),
          recentNames.map((name) =>
            h(BranchMenuRow, {
              key: `recent-${name}`,
              name,
              current: name === currentBranch,
              favorite: starred(name),
              selected: selected === name,
              onPick,
              onToggleFavorite,
              t,
            }),
          ),
          favoriteNames.length === 0 ? null : h('div', { className: 'git-panel-branch-menu-head' }, t('branchFilter.favorites')),
          favoriteNames.map((name) =>
            h(BranchMenuRow, {
              key: `fav-${name}`,
              name,
              current: name === currentBranch,
              favorite: true,
              selected: selected === name,
              onPick,
              onToggleFavorite,
              t,
            }),
          ),
          localNames.length === 0 ? null : h('div', { className: 'git-panel-branch-menu-head' }, t('local')),
          localNames.map((name) =>
            h(BranchMenuRow, {
              key: `local-${name}`,
              name,
              current: name === currentBranch,
              favorite: starred(name),
              selected: selected === name,
              onPick,
              onToggleFavorite,
              t,
            }),
          ),
          remoteGroups.map((group) =>
            h(
              React.Fragment,
              { key: `remote-${group.remote}` },
              h('div', { className: 'git-panel-branch-menu-head' }, group.remote),
              group.names.map((name) =>
                h(BranchMenuRow, {
                  key: `remote-${name}`,
                  name,
                  current: name === currentBranch,
                  favorite: starred(name),
                  selected: selected === name,
                  onPick,
                  onToggleFavorite,
                  t,
                }),
              ),
            ),
          ),
          nothingShown === true ? h('div', { className: 'git-panel-branch-menu-empty' }, t('branchFilter.none')) : null,
        ),
      )
    }

    /**
     * The middle column: the filter row above the commit history list.
     *
     * All three filters are local — the search matches the raw message or the
     * hash, the author matches name or e-mail, and the two dates bound the
     * commit's own timestamp — so typing never talks to the Host. The panel
     * owns the state and hands the narrowed list and the controls down; the
     * graph lanes are computed over the narrowed list, so a filtered page
     * still draws a coherent graph of itself.
     *
     * @param {object} props - the panel's state and actions, passed straight down.
     * @returns {object} the column element.
     */
    function HistoryColumn(props) {
      const {
        activeRange, applyQuickRange, autoLoading, branchFilter, branchMenuOpen, capped, clearHistoryFilter, commitMenu, commits,
        filteredCommits, historyFilter, historyFilterActive, loadMore, loadingMore, more, onLoadAll,
        onRaiseCap, onScroll, onStopLoad, openBranchMenu, quickRanges, selectedCommit, setHistoryFilter, setMenu,
        setSelectedCommit, setSelectedFile, staleFilter, t, total, viewport,
      } = props
      const narrowed = filteredCommits.length !== commits.length
      // The count follows what the header can promise: the narrowed pair while a
      // filter draft is ahead of the query, the loaded-of-total pair once the
      // Host has counted the matching history, and a trailing `+` while nothing
      // has counted it yet.
      const count = narrowed === true
        ? `${filteredCommits.length}/${commits.length}`
        : total === null
          ? `${commits.length}${more === true ? '+' : ''}`
          : `${commits.length}/${total}`
      // Which rows are rendered. The window itself is the panel's state — the
      // scroll that moves it also reads the next page — so this stays a pure
      // function of it; the pads around the window stand in for the rows that are
      // not rendered, so the scrollbar keeps describing the whole loaded history.
      const first = Math.max(0, Math.floor(viewport.top / HISTORY_ROW_HEIGHT) - HISTORY_WINDOW_OVERSCAN)
      const last = Math.min(filteredCommits.length, Math.ceil((viewport.top + viewport.height) / HISTORY_ROW_HEIGHT) + HISTORY_WINDOW_OVERSCAN)
      const visible = filteredCommits.slice(first, last)
      const status = autoLoading === true
        ? h(
            'div',
            { className: 'git-panel-list-more' },
            h('span', { className: 'git-panel-count' }, t('history.loadingAll')),
            h('button', { type: 'button', className: 'git-panel-btn', onClick: onStopLoad }, t('history.stopLoad')),
          )
        : loadingMore === true
          ? h('div', { className: 'git-panel-list-more' }, h('span', { className: 'git-panel-count' }, t('history.loadingMore')))
          : capped === true
            ? h(
                'div',
                { className: 'git-panel-list-more' },
                h('span', { className: 'git-panel-count' }, fill(t('history.capped'), { loaded: commits.length, total: total === null ? '?' : total })),
                h('button', { type: 'button', className: 'git-panel-btn', onClick: onRaiseCap }, t('history.continueLoad')),
              )
            : more === true
              ? h(
                  'div',
                  { className: 'git-panel-list-more' },
                  h('button', { type: 'button', className: 'git-panel-btn', title: t('history.loadMore'), onClick: loadMore }, t('history.loadMore')),
                  h('button', { type: 'button', className: 'git-panel-btn', title: t('history.loadAll'), onClick: onLoadAll }, t('history.loadAll')),
                )
              : null
      const graph = React.useMemo(() => commitGraphRows(filteredCommits), [filteredCommits])
      return (
        h(
          'div',
          { className: cx('git-panel-col', 'git-panel-col-mid') },
          h(
            'div',
            { className: 'git-panel-pane-head' },
            h('span', { className: 'git-panel-pane-title' }, t('commits')),
            h('span', { className: 'git-panel-count' }, count),
            historyFilterActive === true ? h('button', { type: 'button', className: 'git-panel-btn', title: t('historyFilter.clear'), onClick: clearHistoryFilter }, t('historyFilter.clear')) : null,
          ),
          h(
            'div',
            { className: 'git-panel-filters', title: t('historyFilter.scope') },
            staleFilter === true ? h('div', { className: 'git-panel-count' }, t('historyFilter.staleHost')) : null,
            h(
              'div',
              { className: 'git-panel-filters-row' },
              h('input', {
                className: 'git-panel-input',
                value: historyFilter.search,
                placeholder: t('historyFilter.search'),
                title: t('historyFilter.search'),
                'aria-label': t('historyFilter.search'),
                onChange: (event) => setHistoryFilter((value) => ({ ...value, search: event.target.value })),
              }),
              // The branch the history is walked from: HEAD until a branch is
              // picked, the way IDEA's log filter reads before its first pick.
              // The popup the chip opens is the panel's, rendered above every
              // column; the chip only reports where it stands.
              h(
                'button',
                {
                  type: 'button',
                  className: cx('git-panel-select', 'git-panel-branch-filter'),
                  // A fixed-width chip clips a long branch name, so the hover
                  // tip names what is actually in force instead of repeating
                  // the generic label.
                  title: branchFilter === '' ? t('historyFilter.branch') : branchFilter,
                  'aria-label': t('historyFilter.branch'),
                  'aria-haspopup': 'menu',
                  'aria-expanded': branchMenuOpen === true,
                  onClick: (event) => openBranchMenu(event.currentTarget.getBoundingClientRect()),
                },
                h('span', { className: 'git-panel-branch-filter-label' }, t('historyFilter.branch.label')),
                h('span', { className: 'git-panel-caret' }, CARET_OPEN),
                h('span', { className: 'git-panel-branch-filter-name' }, branchFilter === '' ? 'HEAD' : branchFilter),
              ),
            ),
            h(
              'div',
              { className: 'git-panel-filters-row' },
              h('input', {
                className: 'git-panel-input',
                value: historyFilter.author,
                placeholder: t('historyFilter.author'),
                title: t('historyFilter.author'),
                'aria-label': t('historyFilter.author'),
                onChange: (event) => setHistoryFilter((value) => ({ ...value, author: event.target.value })),
              }),
              h('select', {
                className: 'git-panel-select',
                value: activeRange,
                title: t('historyFilter.range'),
                'aria-label': t('historyFilter.range'),
                onChange: (event) => applyQuickRange(event.target.value),
              },
                h('option', { value: '' }, t('historyFilter.range.all')),
                quickRanges.map((range) => h('option', { key: range.key, value: range.key }, range.label)),
              ),
              h('input', {
                type: 'date',
                className: 'git-panel-input',
                value: historyFilter.since,
                title: t('historyFilter.since'),
                'aria-label': t('historyFilter.since'),
                onChange: (event) => setHistoryFilter((value) => ({ ...value, since: event.target.value })),
              }),
              h('input', {
                type: 'date',
                className: 'git-panel-input',
                value: historyFilter.until,
                title: t('historyFilter.until'),
                'aria-label': t('historyFilter.until'),
                onChange: (event) => setHistoryFilter((value) => ({ ...value, until: event.target.value })),
              }),
            ),
          ),
          h(
            'div',
            {
              className: 'git-panel-list',
              // The panel owns what a scroll does — it moves the window of
              // rendered rows and, near the end, reads the next page.
              onScroll: (event) => onScroll(event.currentTarget),
            },
            // An empty list means one of two things, and they read differently:
            // a filtered history that matches nothing is a filter result, while
            // an unfiltered one that is empty is a repository with no commits.
            commits.length === 0
              ? h('div', { className: 'git-panel-empty' }, t(historyFilterActive === true ? 'history.noMatch' : 'noCommits'))
              : null,
            commits.length !== 0 && filteredCommits.length === 0 ? h('div', { className: 'git-panel-empty' }, t('history.noMatch')) : null,
            first > 0 ? h('div', { className: 'git-panel-list-pad', style: { height: first * HISTORY_ROW_HEIGHT } }) : null,
            visible.map((commit, index) =>
              h(CommitRow, {
                t,
                key: commit.hash,
                commit,
                // The graph is laid out over the whole filtered list, so the row's
                // draw data is at its absolute position, not its window index.
                graph: graph.rows[first + index] ?? null,
                columns: graph.columns,
                selected: selectedCommit?.hash === commit.hash,
                onSelect: (entry) => {
                  setSelectedCommit(entry)
                  setSelectedFile(null)
                },
                onContextMenu: (event, entry) => setMenu({ x: event.clientX, y: event.clientY, title: `${entry.short} ${entry.subject}`, items: commitMenu(entry) }),
              }),
            ),
            last < filteredCommits.length ? h('div', { className: 'git-panel-list-pad', style: { height: (filteredCommits.length - last) * HISTORY_ROW_HEIGHT } }) : null,
            // The list may end before the repository does: this row says so, and
            // reads the next page on a click, in one step or all the way.
            status,
          ),
        )
      )
    }

    return { CommitColumn, HistoryColumn, BranchFilterMenu }
  } }),
})
