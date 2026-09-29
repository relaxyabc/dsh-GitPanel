/**
 * The branches column: branches and remotes, submodules, and the working tree.
 *
 * Split out of `client.panel.js` as a package-local chunk. The column is a pure
 * function of the panel's state and callbacks — it holds no state of its own — so
 * the whole working-tree surface can be read without the panel's data loading.
 *
 * @module GitPanel/client.branches
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.branches.js',
  factory: () => ({ create: (shared) => {
    const { h, cx, submoduleStateText, CHECK_GLYPH, WARN_GLYPH, rows: { ChangeRow, BranchRow, GroupHead } } = shared

    /**
     * The left column: branches and remotes, submodules, and the working tree with its commit box.
     *
     * @param {object} props - the panel's state and actions, passed straight down.
     * @returns {object} the column element.
     */
    function BranchesColumn(props) {
      const {
        branchFilter, branchMenu, branches, busy, commit, copyText, diff, files, filteredBranches,
        filteredRemotes, groups, message, mutate, openDiff, pickedPaths, remotes, selectEverything,
        selectedCommit, selectedFile, selectedPaths, setBranchFilter, setGroups, setMenu, setMessage,
        setSelectedCommit, setSelectedFile, setSelectedStaged, state, t, togglePicked,
      } = props
      return (
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
        )
      )
    }

    return { BranchesColumn }
  } }),
})
