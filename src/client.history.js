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
    const { h, React, cx, absoluteDate, commitMessageParts, DOT_GLYPH, DASH, rows: { CommitRow } } = shared

    /**
     * The right column: the commit message box, then the selected commit's files.
     *
     * @param {object} props - the panel's state and actions, passed straight down.
     * @returns {object} the column element.
     */
    function CommitColumn(props) {
      const {
        commitFiles, commitMessageMenu, filesError, filesLoading, openDiff, selectedCommit, selectedFile,
        setMenu, setSelectedFile, t,
      } = props
      // The raw message keeps the newlines the folded subject lost, so the
      // detail head splits it again: the first line bold, the rest below.
      const parts = commitMessageParts(selectedCommit)
      return (
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
                    h('div', { className: 'git-panel-detail-subject' }, parts.subject || t('noMessage')),
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
     * The middle column: the filter row above the commit history list.
     *
     * All three filters are local — the search matches the raw message or the
     * hash, the author matches name or e-mail, and the two dates bound the
     * commit's own timestamp — so typing never talks to the Host. The panel
     * owns the state and hands the narrowed list and the controls down.
     *
     * @param {object} props - the panel's state and actions, passed straight down.
     * @returns {object} the column element.
     */
    function HistoryColumn(props) {
      const {
        activeRange, applyQuickRange, clearHistoryFilter, commitMenu, commits, filteredCommits,
        historyFilter, historyFilterActive, quickRanges, selectedCommit, setHistoryFilter, setMenu,
        setSelectedCommit, setSelectedFile, t,
      } = props
      const narrowed = filteredCommits.length !== commits.length
      return (
        h(
          'div',
          { className: cx('git-panel-col', 'git-panel-col-mid') },
          h(
            'div',
            { className: 'git-panel-pane-head' },
            h('span', { className: 'git-panel-pane-title' }, t('commits')),
            h('span', { className: 'git-panel-count' }, narrowed === true ? `${filteredCommits.length}/${commits.length}` : String(commits.length)),
            historyFilterActive === true ? h('button', { type: 'button', className: 'git-panel-btn', title: t('historyFilter.clear'), onClick: clearHistoryFilter }, t('historyFilter.clear')) : null,
          ),
          h(
            'div',
            { className: 'git-panel-filters' },
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
            { className: 'git-panel-list' },
            commits.length === 0 ? h('div', { className: 'git-panel-empty' }, t('noCommits')) : null,
            commits.length !== 0 && filteredCommits.length === 0 ? h('div', { className: 'git-panel-empty' }, t('history.noMatch')) : null,
            filteredCommits.map((commit) =>
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
        )
      )
    }

    return { CommitColumn, HistoryColumn }
  } }),
})
