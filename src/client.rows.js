/**
 * The repeating rows, the pointer menu, and the dialog.
 *
 * Split out of `client.js` as a package-local chunk: every one of these is a pure
 * function of its props — the panel owns the state and passes the callbacks down —
 * so they are the part of the browser half that can be read, and changed, without
 * knowing anything about the Host.
 *
 * @module GitPanel/client.rows
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.rows.js',
  factory: () => ({ create: (shared) => {
    const { h, React, boundTranslate, cx, basename, statusText, relativeAge, ARROW, BRANCH_GLYPH, CARET_OPEN, CARET_CLOSED, ENTER_GLYPH } = shared

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
            : h('textarea', {
                // A commit message runs over several lines, so the amend dialog
                // asks for the tall variant; a one-line branch name does not.
                className: cx('git-panel-textarea', dialog.multiline === true ? 'git-panel-textarea-tall' : false),
                value,
                autoFocus: true,
                onChange: (event) => setValue(event.target.value),
              }),
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

    return { ContextMenu, Dialog, ChangeRow, BranchRow, CommitRow, GroupHead }
  } }),
})
