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
    const { h, React, cx, absoluteDate, DOT_GLYPH, DASH, rows: { CommitRow } } = shared

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
        )
      )
    }

    /**
     * The middle column: the commit history list.
     *
     * @param {object} props - the panel's state and actions, passed straight down.
     * @returns {object} the column element.
     */
    function HistoryColumn(props) {
      const {
        commitMenu, commits, selectedCommit, setMenu, setSelectedCommit, setSelectedFile, t,
      } = props
      return (
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
        )
      )
    }

    return { CommitColumn, HistoryColumn }
  } }),
})
