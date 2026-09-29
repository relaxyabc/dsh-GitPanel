/**
 * The diff engine and the modal that shows it.
 *
 * Split out of `client.js` as a package-local chunk: unified-diff parsing, the
 * change runs the navigation bar jumps between, and the side-by-side renderer are
 * one subject with one set of rules, and none of them touch Host state. The panel
 * is handed the modal; the rest of the file is here for the tests that read it.
 *
 * @module GitPanel/client.diff
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.diff.js',
  factory: () => ({ create: (shared) => {
    const { h, React, boundTranslate, cx, basename, fill, MAX_DIFF_ROWS, CLOSE_GLYPH, DASH, UP, DOWN } = shared

    /**
     * Parse one unified diff into the rows a side-by-side view renders.
     *
     * A hunk's deletions and additions are buffered and paired in order, so the
     * old line sits beside the line that replaced it; a context line occupies
     * both sides. Anything past `MAX_DIFF_ROWS` is dropped and reported, so one
     * enormous generated file cannot freeze the tab.
     *
     * @param {string} text - the unified diff.
     * @returns {{ head: Array<string>, hunks: Array<object>, added: number, removed: number, binary: boolean, truncated: boolean }} the parsed diff.
     */
    function parseUnifiedDiff(text) {
      const head = []
      const hunks = []
      let pendingRemoved = []
      let pendingAdded = []
      let hunk = null
      let left = 0
      let right = 0
      let rows = 0
      let added = 0
      let removed = 0
      let binary = false
      let truncated = false

      /**
       * Append one row while the cap allows it.
       *
       * @param {object|null} old - `{ no, text }` for the old side.
       * @param {object|null} current - `{ no, text }` for the new side.
       * @param {string} kind - `context`, `change`, `del`, or `add`.
       * @returns {boolean} whether the row was kept.
       */
      const push = (old, current, kind) => {
        if (hunk === null) return false
        if (rows >= MAX_DIFF_ROWS) {
          truncated = true
          return false
        }
        hunk.rows.push({
          kind,
          leftNo: old === null ? null : old.no,
          left: old === null ? null : old.text,
          rightNo: current === null ? null : current.no,
          right: current === null ? null : current.text,
        })
        rows += 1
        return true
      }

      /** Pair the buffered deletions with the additions that replaced them. */
      const flush = () => {
        const count = Math.max(pendingRemoved.length, pendingAdded.length)
        for (let index = 0; index < count && !truncated; index += 1) {
          const old = pendingRemoved[index] ?? null
          const current = pendingAdded[index] ?? null
          const kind = old === null ? 'add' : current === null ? 'del' : 'change'
          push(old, current, kind)
        }
        pendingRemoved = []
        pendingAdded = []
      }

      for (const line of String(text ?? '').split('\n')) {
        if (binary || truncated) break
        const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        if (hunkHeader !== null) {
          flush()
          left = Number(hunkHeader[1])
          right = Number(hunkHeader[2])
          hunk = { header: line, rows: [] }
          hunks.push(hunk)
          continue
        }
        if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
          binary = true
          continue
        }
        if (hunk === null) {
          if (line.trim() === '' || line.startsWith('\u0000')) continue
          head.push(line)
          continue
        }
        if (line.startsWith('\\')) continue
        if (line.startsWith('-')) {
          removed += 1
          pendingRemoved.push({ no: left, text: line.slice(1) })
          left += 1
          continue
        }
        if (line.startsWith('+')) {
          added += 1
          pendingAdded.push({ no: right, text: line.slice(1) })
          right += 1
          continue
        }
        if (line.startsWith(' ')) {
          flush()
          push({ no: left, text: line.slice(1) }, { no: right, text: line.slice(1) }, 'context')
          left += 1
          right += 1
        }
      }
      flush()
      return { head, hunks, added, removed, binary, truncated }
    }

    /**
     * The contiguous changed regions of a parsed diff, in reading order.
     *
     * A run is one or more adjacent non-context rows. Each run records where it
     * starts among the rendered rows, so the overview ruler can place it in
     * proportion to the whole diff, and the key of the row a click should reveal.
     *
     * @param {Array<object>} hunks - the parsed hunks.
     * @returns {{ runs: Array<object>, total: number }} the runs and the rendered row count.
     */
    function changeRunsOf(hunks) {
      const runs = []
      let open = false
      let row = 1 // The sticky column header is the first rendered row.
      hunks.forEach((hunk, hunkIndex) => {
        open = false
        row += 1 // The hunk header.
        hunk.rows.forEach((entry, rowIndex) => {
          if (entry.kind === 'context') {
            open = false
            row += 1
            return
          }
          if (open) {
            runs[runs.length - 1].count += 1
            row += 1
            return
          }
          open = true
          const line = entry.rightNo ?? entry.leftNo
          runs.push({
            key: `${hunkIndex}-${rowIndex}`,
            kind: entry.kind === 'add' ? 'add' : entry.kind === 'del' ? 'del' : 'change',
            line,
            label: line === null ? '+' : String(line),
            count: 1,
            start: row,
          })
          row += 1
        })
      })
      return { runs, total: row }
    }

    /**
     * Render one unified diff as two aligned columns with line numbers.
     *
     * Three navigation aids mirror an IDE diff: a sticky rail beside the line
     * numbers with previous/next controls, a proportional overview ruler that
     * places every change where it sits in the diff and shows the visible range,
     * and click-to-jump on both. In whole-file mode the diff also carries the
     * entire file on both sides; the compact default keeps the context short.
     *
     * @param {object} props - the diff text and the translate function.
     * @returns {object} the side-by-side element.
     */
    function SideBySideDiff({ text, t = boundTranslate }) {
      const parsed = React.useMemo(() => parseUnifiedDiff(text), [text])
      const geometry = React.useMemo(() => changeRunsOf(parsed.hunks), [parsed])
      const runs = geometry.runs
      const anchors = React.useRef({})
      const scrollRef = React.useRef(null)
      const [current, setCurrent] = React.useState(-1)
      const [viewport, setViewport] = React.useState({ top: 0, height: 1 })

      /**
       * Measure the scroll viewport so the ruler shows the visible range.
       *
       * @returns {undefined} nothing.
       */
      const measure = () => {
        const element = scrollRef.current
        if (element === null || element === undefined) return
        const span = element.scrollHeight
        if (!Number.isFinite(span) || span <= 0) return
        setViewport({ top: element.scrollTop / span, height: Math.min(1, element.clientHeight / span) })
      }

      React.useEffect(() => {
        measure()
      }, [text])

      /**
       * Scroll to the fraction of the diff the pointer landed on.
       *
       * @param {object} event - the ruler click.
       * @returns {undefined} nothing.
       */
      const scrollToFraction = (event) => {
        const element = scrollRef.current
        const rect = typeof event?.currentTarget?.getBoundingClientRect === 'function' ? event.currentTarget.getBoundingClientRect() : undefined
        if (element === null || element === undefined || rect === undefined || rect.height === 0) return
        const fraction = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
        const scrollable = element.scrollHeight - element.clientHeight
        if (scrollable > 0) element.scrollTop = fraction * scrollable
      }

      /**
       * Build the ref callback that records one row's element under its key.
       *
       * @param {string} key - the row's hunk-row key.
       * @returns {Function} the ref callback.
       */
      const anchorFor = (key) => (element) => {
        if (element === null || element === undefined) delete anchors.current[key]
        else anchors.current[key] = element
      }

      /**
       * Reveal one change run and remember it as the current one.
       *
       * @param {number} index - the run's position.
       * @returns {undefined} nothing.
       */
      const jumpTo = (index) => {
        const run = runs[index]
        if (run === undefined) return
        setCurrent(index)
        const element = anchors.current[run.key]
        if (element !== undefined && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }

      if (parsed.binary) return h('div', { className: 'git-panel-empty' }, t('diff.binary'))
      if (parsed.hunks.length === 0) return h('div', { className: 'git-panel-empty' }, t('diff.empty'))
      const rail =
        runs.length === 0
          ? null
          : h(
              'div',
              { className: 'git-panel-sbs-nav', 'aria-label': t('diff.changes') },
              h(
                'div',
                { className: 'git-panel-sbs-nav-head' },
                h('button', { type: 'button', className: 'git-panel-sbs-nav-step', disabled: current <= 0, title: t('diff.prev'), onClick: () => jumpTo(current > 0 ? current - 1 : 0) }, UP),
                h('span', { className: 'git-panel-sbs-nav-count' }, `${current < 0 ? DASH : current + 1}/${runs.length}`),
                h('button', { type: 'button', className: 'git-panel-sbs-nav-step', disabled: current >= runs.length - 1, title: t('diff.next'), onClick: () => jumpTo(current < 0 ? 0 : current + 1) }, DOWN),
              ),
              runs.map((run, index) =>
                h(
                  'button',
                  {
                    key: `nav-${index}`,
                    type: 'button',
                    className: cx('git-panel-sbs-nav-item', index === current ? 'git-panel-sbs-nav-current' : false, `git-panel-sbs-nav-${run.kind}`),
                    title: fill(t('diff.jump'), { line: run.label }),
                    onClick: () => jumpTo(index),
                  },
                  run.label,
                ),
              ),
            )
      const overview =
        runs.length === 0
          ? null
          : h(
              'div',
              { className: 'git-panel-sbs-overview', 'aria-label': t('diff.changes'), title: t('diff.changes'), onClick: scrollToFraction },
              h('div', { className: 'git-panel-sbs-overview-view', style: { top: `${viewport.top * 100}%`, height: `${viewport.height * 100}%` } }),
              runs.map((run, index) =>
                h('button', {
                  key: `mark-${index}`,
                  type: 'button',
                  className: cx('git-panel-sbs-mark', `git-panel-sbs-mark-${run.kind}`, index === current ? 'git-panel-sbs-mark-current' : false),
                  style: { top: `${((run.start - 1) / geometry.total) * 100}%`, height: `${(run.count / geometry.total) * 100}%` },
                  title: fill(t('diff.jump'), { line: run.label }),
                  onClick: (event) => {
                    event.stopPropagation()
                    jumpTo(index)
                  },
                }),
              ),
            )
      return h(
        'div',
        { className: 'git-panel-sbs-layout' },
        h(
          'div',
          { className: 'git-panel-sbs-scroll', ref: scrollRef, onScroll: measure },
          h(
            'div',
            { className: 'git-panel-sbs-wrap' },
            rail,
            h(
              'div',
              { className: 'git-panel-sbs' },
              h(
                'div',
                { className: 'git-panel-sbs-columns' },
                h('span', { className: 'git-panel-sbs-column' }, t('diff.before')),
                h('span', { className: 'git-panel-sbs-column' }, t('diff.after')),
              ),
              parsed.hunks.map((hunk, hunkIndex) =>
                h(
                  'div',
                  { key: `hunk-${hunkIndex}` },
                  h('div', { className: 'git-panel-sbs-hunk' }, hunk.header),
                  hunk.rows.map((row, rowIndex) =>
                    h(
                      'div',
                      { key: `row-${hunkIndex}-${rowIndex}`, className: 'git-panel-sbs-row', ref: anchorFor(`${hunkIndex}-${rowIndex}`) },
                      h('span', { className: 'git-panel-sbs-no' }, row.leftNo === null ? '' : String(row.leftNo)),
                      h(
                        'span',
                        { className: cx('git-panel-sbs-cell', row.left === null ? 'git-panel-sbs-blank' : row.kind === 'change' || row.kind === 'del' ? 'git-panel-sbs-del' : false) },
                        row.left === null ? '' : row.left,
                      ),
                      h('span', { className: 'git-panel-sbs-no' }, row.rightNo === null ? '' : String(row.rightNo)),
                      h(
                        'span',
                        { className: cx('git-panel-sbs-cell', row.right === null ? 'git-panel-sbs-blank' : row.kind === 'change' || row.kind === 'add' ? 'git-panel-sbs-add' : false) },
                        row.right === null ? '' : row.right,
                      ),
                    ),
                  ),
                ),
              ),
              parsed.truncated ? h('div', { className: 'git-panel-empty' }, fill(t('diff.truncated'), { count: MAX_DIFF_ROWS })) : null,
            ),
          ),
        ),
        overview,
      )
    }

    /**
     * The modal diff viewer: one file at a time, side by side.
     *
     * The content follows the current selection, so picking another row while
     * the modal is open swaps the diff; Escape, the scrim, or the close control
     * dismisses it. An empty diff for a commit says which part is out of date: a
     * Host that predates commit-aware diffs answers every commit file with an
     * empty worktree diff, which must not read as "this commit changed nothing".
     *
     * @param {object} props - the selected file, its diff, the owning commit, whether the Host is older, whether the whole file is shown, and close.
     * @returns {object} the modal element.
     */
    function DiffModal({ file, commit, text, stale, whole, onClose, t = boundTranslate }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      const empty = text !== null && String(text).trim() === ''
      const body =
        text === null
          ? h('div', { className: 'git-panel-empty' }, t('loading'))
          : empty && stale === true && commit !== null
            ? h('div', { className: cx('git-panel-banner', 'git-panel-banner-warn'), style: { margin: 10 } }, t('notice.staleHost'))
            : h(SideBySideDiff, { text, t })
      return h(
        React.Fragment,
        null,
        h('div', { className: 'git-panel-scrim', onClick: onClose }),
        h(
          'div',
          { className: 'git-panel-modal' },
          h(
            'div',
            { className: 'git-panel-modal-head' },
            h('span', { className: 'git-panel-modal-title', title: file.path }, basename(file.path)),
            h('span', { className: 'git-panel-sub', title: file.path }, file.path),
            h('span', { className: 'git-panel-chip' }, commit === null ? t('diff.working') : fill(t('diff.committed'), { short: commit.short })),
            whole === true ? h('span', { className: 'git-panel-chip' }, t('diff.whole')) : null,
            h('span', { className: 'git-panel-spacer' }),
            h('button', { type: 'button', className: 'git-panel-btn', onClick: onClose, title: t('close') }, CLOSE_GLYPH),
          ),
          h('div', { className: 'git-panel-modal-body' }, body),
        ),
      )
    }

    return { parseUnifiedDiff, changeRunsOf, SideBySideDiff, DiffModal }
  } }),
})
