/**
 * The right-Sidebar half: the tab that opens the panel and closes itself, and the
 * chip title beside it.
 *
 * Split out of `client.js` as a package-local chunk. The tab is a door, not a
 * surface — it never renders Host data — and its one piece of state (which
 * navigation revisions were already acted on) has to outlive the body, so it lives
 * here with the components that read it.
 *
 * @module GitPanel/client.sidebar
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.sidebar.js',
  factory: () => ({ create: (shared) => {
    const { h, React, boundTranslate, cx, GitGlyph, StyleTag, PANEL_ID, hostContext } = shared

    /**
     * Select the full-page Git panel and reveal it.
     *
     * The layout service throws while the main key is not committed yet; the
     * launcher's explicit button retries, so the failed transition stays quiet.
     * A fullscreen right Sidebar covers the frame, so when the transition comes
     * from a tab in that presentation the column is collapsed to reveal the
     * panel.
     *
     * @param {object} [info] - the launcher's tab info, when forwarded from a tab.
     * @returns {boolean} whether the panel was selected.
     */
    function openGitPanel(info) {
      const layout = hostContext?.layout
      if (layout === null || typeof layout?.selectPanel !== 'function') return false
      try {
        layout.selectPanel(PANEL_ID)
      } catch {
        return false
      }
      if (info?.sidebar?.fullscreen === true) {
        const sidebar = hostContext?.sidebarRight
        if (typeof sidebar?.isExpanded === 'function' && sidebar.isExpanded() && typeof sidebar?.toggleExpanded === 'function') {
          try {
            sidebar.toggleExpanded()
          } catch {
            // The sidebar's own chrome still collapses it.
          }
        }
      }
      return true
    }

    /**
     * Per-tab navigation revisions this plugin has already acted on.
     *
     * The revision survives a body remount while the tab record does, and a
     * remount happens for reasons that are not a navigation at all — a session
     * switch, a sidebar expand, a pane change. Remembering what was handled is
     * what keeps those from re-selecting the panel the user just left, which is
     * why the memory lives outside the component.
     */
    const handledRevisions = new Map()

    /**
     * Close the tab one tab body belongs to.
     *
     * The framework hands every tab body its own close action, which acts on
     * that tab in its own session. The controller's `close(tabId)` is not a
     * substitute: it needs a mounted seat binding, and a body's first effect
     * runs before that binding is published.
     *
     * @param {object|null} info - the tab information the framework handed the body.
     * @returns {boolean} whether the tab accepted the close.
     */
    function closeOwnTab(info) {
      const actions = info?.tab?.actions
      if (typeof actions?.close !== 'function') return false
      try {
        actions.close()
        return true
      } catch {
        return false
      }
    }

    /**
     * The right Sidebar's Git tab body: a door, not a page.
     *
     * A *navigation* to this tab — the guide capsule, the tab chip — opens the
     * full-page panel and drops the tab again, which is what leaves no Git tab
     * in the column once the user returns to the conversation. Everything else
     * — a record restored from a previous session, a body remounted because the
     * user switched session or expanded the column — only closes itself: every
     * session keeps its own layout, so forwarding there would re-select the very
     * panel the user just left.
     *
     * The card below is the fallback for a deployment that refuses the close: it
     * names the tool and offers the same door, and deliberately reads nothing
     * from the Host, so a lingering tab cannot sit on stale repository data.
     *
     * @param {object} props - tab body props, including the framework's `useTabInfo`.
     * @returns {object|null} the fallback card, or nothing once the tab is gone.
     */
    function GitTabDoor({ useTabInfo, t = boundTranslate }) {
      const info = typeof useTabInfo === 'function' ? useTabInfo() : null
      const revision = info?.tab?.navigation?.revision ?? 0
      const visible = info?.tab?.visible === true
      const tabId = info?.tab?.id
      const key = String(tabId)
      const [closed, setClosed] = React.useState(false)
      React.useEffect(() => {
        const handled = handledRevisions.get(key) ?? 0
        if (revision > handled) handledRevisions.set(key, revision)
        // The panel is opened once per navigation, and only from the foreground:
        // a background session showing its own layout must not take the seat.
        if (visible === true && revision > handled && openGitPanel(info) !== true) return
        const done = closeOwnTab(info)
        if (done) handledRevisions.delete(key)
        setClosed(done)
      }, [visible, revision, key])
      if (closed) return null
      return h(
        'div',
        { className: 'git-panel' },
        h(StyleTag, null),
        h(
          'div',
          { className: 'git-panel-launch' },
          h('div', { className: 'git-panel-launch-icon' }, h(GitGlyph, { size: 28 })),
          h('div', { className: 'git-panel-launch-title' }, t('title')),
          h('div', { className: 'git-panel-launch-text' }, t('launcherHint')),
          h('div', { className: 'git-panel-launch-text' }, t('launcherWhere')),
          h(
            'div',
            { className: 'git-panel-launch-actions' },
            h(
              'button',
              {
                type: 'button',
                className: cx('git-panel-btn', 'git-panel-btn-primary'),
                onClick: () => {
                  if (openGitPanel(info) === true) setClosed(closeOwnTab(info))
                },
              },
              t('openPanel'),
            ),
          ),
        ),
      )
    }

    /**
     * The right Sidebar's chip title.
     *
     * @returns {object} the chip content.
     */
    function GitTitle({ t = boundTranslate }) {
      return h(
        React.Fragment,
        null,
        h('span', { 'aria-hidden': true, style: { marginRight: 4, display: 'inline-flex', verticalAlign: '-2px' } }, h(GitGlyph, { size: 13 })),
        t('title'),
      )
    }

    return { openGitPanel, GitTabDoor, GitTitle }
  } }),
})
