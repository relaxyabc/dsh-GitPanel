/**
 * Browser half of the Git manager bundle.
 *
 * Contributes an IntelliJ-style Git tool to the Web client: a sidebar entry in
 * the global panel rail selects a full-page main panel whose three columns are
 * branches (left), commit history (middle), and the selected commit's details
 * (right). The right Sidebar also gets a Git tab that summarises the repository
 * and points at that panel.
 *
 * Every Host interaction goes through the authenticated `/api/local-git` route
 * the bundle's Host half owns.
 *
 * @module GitPanel
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** This implementation's identity in the right-Sidebar tab system. */
    const PLUGIN_ID = 'GitPanel'

    /** The right-Sidebar tab kind this package owns. */
    const GIT_KIND = 'git'

    /** Sidebar panel id and the matching `main` slot key. */
    const PANEL_ID = 'git'

    /** The authenticated Host route every operation is posted to. */
    const ROUTE = '/api/local-git'

    /** Commit page size requested from the Host. */
    const COMMIT_PAGE = 200

    /** Most side-by-side diff rows one modal renders before it truncates. */
    const MAX_DIFF_ROWS = 3000

    /** The plugin entry whose configuration the Plugins page card edits. */
    const SETTINGS_NS = 'GitPanel'

    /** The one configuration field the Plugins page card edits. */
    const DEPTH_FIELD = 'discoveryDepth'

    /**
     * The shared settings primitives the Plugins page form is built from.
     *
     * Resolved during apply, so a deployment without the primitives module
     * loses only the settings card instead of the whole tool.
     */
    let primitives = null

    /** Glyphs spelled as escapes so no encoding can mangle them. */
    const CARET_OPEN = '\u25be'
    const CARET_CLOSED = '\u25b8'
    const BRANCH_GLYPH = '\u2387'
    const ENTER_GLYPH = '\u21b5'
    const CHECK_GLYPH = '\u2713'
    const WARN_GLYPH = '!'
    const DOT_GLYPH = '\u2022'
    const ARROW = '\u2192'
    const UP = '\u2191'
    const DOWN = '\u2193'
    const DASH = '\u2014'
    const CLOSE_GLYPH = '\u00d7'

    /**
     * Post one operation to the Host half.
     *
     * @param {string} op - operation name.
     * @param {object} args - operation arguments.
     * @returns {Promise<object>} the operation payload.
     * @throws {Error} when the transport or the Host refuses the operation.
     */
    async function callHost(op, args) {
      let response
      try {
        response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, args }),
        })
      } catch (error) {
        throw new Error(`the Host is unreachable: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (response.status === 401) throw new Error('this browser session is not authorized')
      if (response.status === 403) throw new Error('the Host refused this origin')
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`the Host answered ${response.status} without JSON`)
      }
      if (body === null || typeof body !== 'object') throw new Error('the Host answered an unexpected payload')
      if (body.ok !== true) throw new Error(typeof body.error === 'string' && body.error !== '' ? body.error : 'the operation failed')
      return body.data ?? {}
    }

    /**
     * The message of an unknown thrown value.
     *
     * @param {unknown} error - the failure.
     * @returns {string} its message.
     */
    function failureText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * Whether a Host failure means the running Host half predates this client build.
     *
     * The browser re-fetches `client.js` on every page load while the Host half
     * is imported once when the DSH process starts, so a refreshed page can
     * outrun the Host for as long as that process keeps running. Reporting that
     * state beats repeating the Host's raw `unknown operation` text, and the
     * few operations an older Host still answers let the panel stay usable.
     *
     * @param {unknown} error - the failure.
     * @returns {boolean} whether the Host reported the operation as unknown.
     */
    function isStaleHost(error) {
      return failureText(error).includes('unknown operation')
    }

    /**
     * I18n namespace and dictionaries. Every user-facing string lives in `en` /
     * `zh` and is read through `t()` at render time, so a language switch needs
     * no re-registration; `locale/*.json` stays manifest metadata only.
     */
    const LOCALE_NS = 'gitPanel'

    /** English copy (the fallback language). */
    const en = {
      'title': 'Git',
      'launcherHint': 'Branches, commits, changes and remotes',
      'launcherWhere': 'Opens as a full page in the main area.',
      'openPanel': 'Open Git panel',
      'workspace': 'Workspace',
      'repository': 'Repository',
      'branches': 'Branches',
      'local': 'Local',
      'remote': 'Remote',
      'branchesFilter': 'Filter branches',
      'commits': 'Commits',
      'changes': 'Working tree',
      'details': 'Commit',
      'noChanges': 'Working tree clean',
      'openDiff': 'Double-click to open the diff',
      'noCommits': 'No commits',
      'noBranches': 'No branches',
      'messagePlaceholder': 'Describe this change\u2026',
      'message': 'Commit message',
      'commit': 'Commit',
      'commitAll': 'Commit all',
      'commitPush': 'Commit & push',
      'push': 'Push',
      'stageAll': 'Stage all',
      'unstageAll': 'Unstage all',
      'refresh': 'Refresh',
      'close': 'Close',
      'selectCommit': 'Select a commit to see its message and files',
      'menu.editMessage': 'Edit commit message',
      'depth': 'Maximum scan depth',
      'depth.hint': 'Directory levels scanned below the workspace root (1-8)',
      'settings.unavailable': 'This deployment does not serve the Git plugin configuration.',
      'settings.readOnly': 'This deployment stores configuration read-only.',
      'settings.saveFailed': 'The Host did not accept the change.',
      'settings.save': 'Save',
      'settings.saving': 'Saving\u2026',
      'settings.overridden': 'modified',
      'settings.reset': 'Reset',
      'settings.invalidNumber': 'Enter a whole number between 1 and 8.',
      'loading': 'Loading\u2026',
      'files.loading': 'Reading the changed paths\u2026',
      'files.none': 'This commit changed no path',
      'files.failed': 'The changed paths could not be read',
      'diff.before': 'Before',
      'diff.after': 'After',
      'diff.empty': 'No differences to show',
      'diff.binary': 'Binary file \u2014 no text diff',
      'diff.working': 'working tree',
      'diff.committed': 'commit {short}',
      'diff.truncated': 'Only the first {count} diff rows are shown',
      'noWorkspace': 'No workspace is open yet.',
      'noRepository': 'No Git repository was found under this workspace.',
      'detached': 'detached HEAD',
      'files': 'Files',
      'author': 'Author',
      'date': 'Date',
      'hash': 'Commit',
      'parents': 'Parents',
      'cancel': 'Cancel',
      'ok': 'OK',
      'amend': 'Amend message',
      'amend.newestOnly': 'only the newest commit can be rewritten',
      'checkout': 'Checkout',
      'cherryPick': 'Cherry-pick',
      'resetSoft': 'Reset (soft)',
      'resetMixed': 'Reset (mixed)',
      'resetHard': 'Reset (hard)',
      'revert': 'Revert commit',
      'copyHash': 'Copy hash',
      'deleteBranch': 'Delete branch',
      'newBranch': 'New branch from here',
      'dialog.createBranch.confirm': 'Create and check out',
      'dialog.resetHard.warning': 'Every uncommitted change in the working tree will be discarded.',
      'dialog.deleteBranch.warning': 'The branch is removed only when it is already merged.',
      'menu.showDiff': 'Show the diff',
      'aheadBehind.title': 'commits ahead of and behind the upstream',
      'file.binary': 'binary',
      'noMessage': '(no message)',
      'submodules': 'Submodules',
      'submodule.initialized': 'initialized',
      'submodule.uninitialized': 'uninitialized',
      'submodule.out-of-date': 'out-of-date',
      'submodule.conflicted': 'conflicted',
      'working': 'Working\u2026',
      'copied': 'copied to the clipboard',
      'notice.stagedAll': 'staged everything',
      'notice.unstagedAll': 'unstaged everything',
      'notice.pushed': 'pushed',
      'notice.switched': 'switched to {name}',
      'notice.checkedOut': 'checked out {name}',
      'notice.created': 'created {name}',
      'notice.deleted': 'deleted {name}',
      'notice.reset': 'reset --{mode} {short}',
      'notice.cherryPicked': 'cherry-picked {name}',
      'notice.reverted': 'reverted {name}',
      'notice.amended': 'message amended',
      'notice.committed': 'committed {short}',
      'notice.committedPushFailed': 'committed {short}, but the push failed',
      'notice.committedPushed': 'committed {short} and pushed',
      'notice.staleHost': 'This panel is newer than the running Host half: the DSH process still serves the previous build, so new operations are unavailable. Restart the DSH process (or let HMR watch this package) to load them.',
    }

    /** Simplified Chinese copy, key-for-key with `en`. */
    const zh = {
      'title': 'Git',
      'launcherHint': '分支、提交、改动与远程',
      'launcherWhere': '在主区域以整页打开。',
      'openPanel': '打开 Git 面板',
      'close': '关闭',
      'selectCommit': '选择一个提交查看提交信息与文件改动',
      'menu.editMessage': '修改提交信息',
      'workspace': '工作区',
      'repository': '仓库',
      'branches': '分支',
      'local': '本地',
      'remote': '远程',
      'branchesFilter': '筛选分支',
      'commits': '提交',
      'changes': '工作区改动',
      'details': '提交',
      'noChanges': '工作区干净',
      'openDiff': '双击查看改动详情',
      'noCommits': '暂无提交',
      'noBranches': '暂无分支',
      'messagePlaceholder': '描述这次改动…',
      'message': '提交信息',
      'commit': '提交',
      'commitAll': '全部提交',
      'commitPush': '提交并推送',
      'push': '推送',
      'stageAll': '暂存全部',
      'unstageAll': '取消全部暂存',
      'refresh': '刷新',
      'noWorkspace': '尚未打开任何工作区。',
      'depth': '最大递归深度',
      'depth.hint': '工作区根目录下递归扫描的目录层数(1-8)',
      'settings.unavailable': '当前部署未提供 Git 插件配置。',
      'settings.readOnly': '当前部署的配置为只读。',
      'settings.saveFailed': 'Host 未接受这次修改。',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.overridden': '已修改',
      'settings.reset': '重置',
      'settings.invalidNumber': '请输入 1–8 之间的整数。',
      'loading': '载入中…',
      'files.loading': '正在读取改动文件…',
      'files.none': '该提交没有改动任何文件',
      'files.failed': '无法读取改动文件列表',
      'diff.before': '修改前',
      'diff.after': '修改后',
      'diff.empty': '没有可展示的差异',
      'diff.binary': '二进制文件,无法展示文本差异',
      'diff.working': '工作区改动',
      'diff.committed': '提交 {short}',
      'diff.truncated': '仅展示前 {count} 行差异',
      'noRepository': '此工作区下未找到 Git 仓库。',
      'detached': '分离 HEAD',
      'files': '文件',
      'author': '作者',
      'date': '日期',
      'hash': '提交',
      'parents': '父提交',
      'cancel': '取消',
      'ok': '确定',
      'amend': '修改提交信息',
      'amend.newestOnly': '只能改写最新提交',
      'checkout': '检出',
      'cherryPick': '摘取',
      'resetSoft': '重置(soft)',
      'resetMixed': '重置(mixed)',
      'resetHard': '重置(hard)',
      'revert': '还原提交',
      'copyHash': '复制哈希',
      'deleteBranch': '删除分支',
      'newBranch': '从此提交新建分支',
      'dialog.createBranch.confirm': '创建并检出',
      'dialog.resetHard.warning': '工作区中所有未提交的改动都将被丢弃。',
      'dialog.deleteBranch.warning': '仅会删除已合并的分支。',
      'menu.showDiff': '查看差异',
      'aheadBehind.title': '相对上游领先 / 落后的提交数',
      'file.binary': '二进制',
      'noMessage': '(无提交信息)',
      'submodules': '子模块',
      'submodule.initialized': '已初始化',
      'submodule.uninitialized': '未初始化',
      'submodule.out-of-date': '有新提交',
      'submodule.conflicted': '有冲突',
      'working': '处理中…',
      'copied': '已复制到剪贴板',
      'notice.stagedAll': '已暂存全部改动',
      'notice.unstagedAll': '已取消全部暂存',
      'notice.pushed': '已推送',
      'notice.switched': '已切换到 {name}',
      'notice.checkedOut': '已检出 {name}',
      'notice.created': '已创建 {name}',
      'notice.deleted': '已删除 {name}',
      'notice.reset': '已重置(--{mode})到 {short}',
      'notice.cherryPicked': '已摘取 {name}',
      'notice.reverted': '已还原 {name}',
      'notice.amended': '已修改提交信息',
      'notice.committed': '已提交 {short}',
      'notice.committedPushFailed': '已提交 {short},但推送失败',
      'notice.committedPushed': '已提交 {short} 并推送',
      'notice.staleHost': '当前面板比运行中的 Host 半新:DSH 进程仍在提供上一版构建,因此新操作不可用。重启 DSH 进程(或让 HMR 监听本包)后即可加载。',
    }

    /** Submodule state → dictionary key; an unknown state renders raw. */
    const SUBMODULE_STATE_KEYS = {
      initialized: 'submodule.initialized',
      uninitialized: 'submodule.uninitialized',
      'out-of-date': 'submodule.out-of-date',
      conflicted: 'submodule.conflicted',
    }

    /**
     * Fill `{name}` placeholders in a translated template.
     *
     * @param {string} template - translated template.
     * @param {Record<string, string>} vars - placeholder values.
     * @returns {string} the filled string.
     */
    function fill(template, vars) {
      return template.replace(/\{(\w+)\}/g, (match, key) => (vars && vars[key] !== undefined ? String(vars[key]) : match))
    }

    /**
     * The translated label for one submodule state.
     *
     * @param {string} state - the raw host state.
     * @param {(key: string) => string} t - translate function.
     * @returns {string} the label; an unknown state renders raw.
     */
    function submoduleStateText(state, t) {
      const key = SUBMODULE_STATE_KEYS[state]
      return key === undefined ? state : t(key)
    }

    /**
     * Translate bound at apply time, used by copy read outside the framework's
     * `t` prop reach (guide entries, panel-list labels) and as the components'
     * fallback before the framework prop arrives.
     */
    let boundTranslate = (key) => en[key] ?? key

    /**
     * The apply-scope client context, kept so slot components can drive the
     * main-panel selection (slot occupants receive no `ctx`).
     */
    let hostContext = null

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
     * Pick the main-view Session's id from a sessions snapshot.
     *
     * The main view retains exactly one Session under the `mainView` source and
     * the list rows carry those retention counts — the same rule the shipped
     * workspace browser uses to find the current Session.
     *
     * @param {object|undefined} sessions - the `useSessions` snapshot.
     * @returns {string|undefined} the main-view Session id.
     */
    function mainSessionIdOf(sessions) {
      if (sessions === null || typeof sessions !== 'object') return undefined
      const rows = sessions.byId ?? {}
      const ids = Array.isArray(sessions.ids) && sessions.ids.length > 0 ? sessions.ids : Object.keys(rows)
      for (const id of ids) {
        const row = rows[id]
        if (row === null || typeof row !== 'object') continue
        if ((row.retainedBy?.mainView ?? 0) > 0) return id
      }
      return undefined
    }

    /**
     * Join class names.
     *
     * @param {...(string|false|null|undefined)} parts - names.
     * @returns {string} the class attribute.
     */
    function cx(...parts) {
      return parts.filter((part) => typeof part === 'string' && part !== '').join(' ')
    }

    /**
     * Format a UNIX timestamp in seconds as a short relative age.
     *
     * @param {number} seconds - commit timestamp.
     * @returns {string} the age.
     */
    function relativeAge(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return ''
      const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds)
      if (delta < 60) return `${delta}s`
      if (delta < 3600) return `${Math.floor(delta / 60)}m`
      if (delta < 86400) return `${Math.floor(delta / 3600)}h`
      if (delta < 2592000) return `${Math.floor(delta / 86400)}d`
      if (delta < 31536000) return `${Math.floor(delta / 2592000)}mo`
      return `${Math.floor(delta / 31536000)}y`
    }

    /**
     * Format a commit timestamp as a readable local date.
     *
     * @param {number} seconds - commit timestamp.
     * @returns {string} the date, or an empty string.
     */
    function absoluteDate(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return ''
      const date = new Date(seconds * 1000)
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * The display letter for a porcelain status.
     *
     * @param {string} status - the status letter.
     * @returns {string} the display letter.
     */
    function statusText(status) {
      if (status === '?') return 'U'
      return typeof status === 'string' && status !== '' ? status : 'M'
    }

    /**
     * The last path segment.
     *
     * @param {string} path - a path.
     * @returns {string} the basename.
     */
    function basename(path) {
      const parts = String(path).split(/[\\/]/)
      return parts[parts.length - 1] ?? path
    }

    /** The token-only stylesheet: no Harness Client package is imported. */
    const STYLES = [
      '.git-panel{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-base,transparent)}',
      '.git-panel *{box-sizing:border-box}',
      '.git-panel-bar{display:flex;flex-direction:column;gap:6px;flex:none;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}',
      '.git-panel-bar-row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.git-panel-field{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 180px;max-width:360px}',
      '.git-panel-field-label{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-field .git-panel-select{width:100%;max-width:none;padding:3px 8px}',
      '.git-panel-branch-chip{flex:none;display:inline-flex;align-items:center;gap:5px;max-width:220px;padding:2px 8px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#1f2328)}',
      '.git-panel-branch-chip-glyph{display:inline-flex;color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-branch-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
      '.git-panel-spacer{flex:1;min-width:4px}',
      '.git-panel-select{max-width:260px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:2px 6px;font:inherit;cursor:pointer}',
      '.git-panel-input{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:2px 7px;font:inherit;min-width:0}',
      '.git-panel-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:2px 8px;font:inherit;cursor:pointer;white-space:nowrap}',
      '.git-panel-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}',
      '.git-panel-btn:disabled{opacity:.45;cursor:default}',
      '.git-panel-btn-primary{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 16%,transparent);color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 26%,transparent)}',
      '.git-panel-cols{flex:1;min-height:0;display:flex}',
      '.git-panel-col{display:flex;flex-direction:column;min-height:0;min-width:0}',
      '.git-panel-col-left{width:268px;flex:none;border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-col-mid{flex:1;min-width:220px}',
      '.git-panel-col-right{width:400px;flex:none;border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-pane{display:flex;flex-direction:column;min-height:0;overflow:hidden}',
      '.git-panel-pane-top{flex:1 1 46%;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-pane-grow{flex:1}',
      '.git-panel-pane-head{display:flex;align-items:center;gap:6px;flex:none;padding:5px 9px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-pane-title{font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#57606a);white-space:nowrap}',
      '.git-panel-count{flex:none;font-size:10.5px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-list{flex:1;min-height:0;overflow:auto;padding:3px 0 8px}',
      '.git-panel-empty{padding:8px 10px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-row{display:flex;align-items:center;gap:7px;padding:3px 10px;cursor:default}',
      '.git-panel-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1))}',
      '.git-panel-row-sel,.git-panel-row-sel:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 18%,transparent)}',
      '.git-panel-branch{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git-panel-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#57606a);font-size:11px}',
      '.git-panel-group{display:flex;align-items:center;gap:6px;width:100%;padding:5px 9px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.git-panel-group:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}',
      '.git-panel-caret{flex:none;width:10px;font-size:9px;opacity:.75}',
      '.git-panel-tag{flex:none;padding:0 5px;border-radius:3px;font-size:10px;font-weight:600;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#0969da) 14%,transparent);color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-chip{flex:none;padding:0 5px;border-radius:3px;font-size:10px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-status{flex:none;width:14px;text-align:center;font-weight:700;font-size:11px;font-family:ui-monospace,monospace}',
      '.git-panel-status-M{color:var(--dsw-alias-state-warn-primary,#9a6700)}',
      '.git-panel-status-A{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-status-D{color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-status-R{color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-status-C{color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-status-U{color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-status-\\?{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-check{flex:none;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary,#0969da);cursor:pointer}',
      '.git-panel-numstat{flex:none;display:flex;gap:4px;font-family:ui-monospace,monospace;font-size:10px}',
      '.git-panel-plus{color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-minus{color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-commit{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
      '.git-panel-commit-top{display:flex;align-items:center;gap:6px;min-width:0}',
      '.git-panel-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git-panel-meta{display:flex;gap:7px;overflow:hidden;color:var(--dsw-alias-label-secondary,#57606a);font-size:11px;white-space:nowrap}',
      '.git-panel-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}',
      '.git-panel-detail{flex:1 1 46%;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-detail-head{flex:none;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-detail-subject{font-weight:600;font-size:13px;margin-bottom:5px;word-break:break-word}',
      '.git-panel-detail-body{margin-top:6px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11.5px}',
      '.git-panel-kv-key{color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-kv-value{overflow:hidden;text-overflow:ellipsis;word-break:break-all}',
      '.git-panel-msg{display:flex;flex-direction:column;gap:6px;flex:none;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}',
      '.git-panel-textarea{width:100%;min-height:56px;resize:vertical;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border-radius:5px;padding:5px 7px;font:inherit}',
      '.git-panel-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.git-panel-banner{margin:6px 10px;padding:6px 8px;border-radius:5px;word-break:break-word}',
      '.git-panel-banner-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#cf222e) 12%,transparent);color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-banner-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 12%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-banner-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#9a6700) 14%,transparent);color:var(--dsw-alias-state-warn-primary,#9a6700)}',
      '.git-panel-sbs{display:flex;flex-direction:column;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.55;tab-size:4}',
      '.git-panel-sbs-columns{display:grid;grid-template-columns:1fr 1fr;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24))}',
      '.git-panel-sbs-column{padding:3px 9px;font-family:inherit;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-sbs-hunk{padding:3px 9px;color:var(--dsw-alias-brand-primary,#0969da);background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}',
      '.git-panel-sbs-row{display:grid;grid-template-columns:44px minmax(0,1fr) 44px minmax(0,1fr)}',
      '.git-panel-sbs-no{padding:0 6px;text-align:right;color:var(--dsw-alias-label-secondary,#57606a);opacity:.7;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));user-select:none}',
      '.git-panel-sbs-cell{padding:0 9px;white-space:pre-wrap;word-break:break-word;min-width:0}',
      '.git-panel-sbs-del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#cf222e) 14%,transparent);color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.git-panel-sbs-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 14%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}',
      '.git-panel-sbs-blank{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.09))}',
      '.git-panel-ctx{position:fixed;z-index:90;min-width:230px;padding:4px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 8px 28px rgba(0,0,0,.24);display:flex;flex-direction:column;gap:1px}',
      '.git-panel-ctx-head{padding:4px 8px 5px;font-size:11px;color:var(--dsw-alias-label-secondary,#57606a);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));margin-bottom:3px;word-break:break-all}',
      '.git-panel-ctx-item{display:flex;align-items:center;gap:6px;width:100%;padding:4px 8px;border:0;border-radius:4px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.git-panel-ctx-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16))}',
      '.git-panel-ctx-item:disabled{opacity:.5;cursor:default}',
      '.git-panel-ctx-sep{height:1px;margin:3px 0;background:var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-scrim{position:fixed;inset:0;z-index:89}',
      '.git-panel-dialog{position:fixed;z-index:91;top:50%;left:50%;transform:translate(-50%,-50%);width:min(360px,90vw);display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 12px 44px rgba(0,0,0,.3)}',
      '.git-panel-dialog-title{font-weight:600}',
      '.git-panel-dialog-actions{display:flex;justify-content:flex-end;gap:7px}',
      '.git-panel-modal{position:fixed;z-index:91;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1180px,94vw);height:min(760px,88vh);display:flex;flex-direction:column;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 12px 44px rgba(0,0,0,.3);overflow:hidden}',
      '.git-panel-modal-head{flex:none;display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}',
      '.git-panel-modal-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.git-panel-modal-body{flex:1;min-height:0;overflow:auto}',
      '.git-panel-launch{display:flex;flex-direction:column;gap:10px;padding:14px}',
      '.git-panel-launch-title{font-weight:600;font-size:13px}',
      '.git-panel-launch-text{color:var(--dsw-alias-label-secondary,#57606a)}',
      '.git-panel-launch-icon{color:var(--dsw-alias-brand-primary,#0969da)}',
      '.git-panel-launch-actions{display:flex;margin-top:2px}',
    ].join('\n')

    /**
     * The inline stylesheet.
     *
     * @returns {object} the style element.
     */
    function StyleTag() {
      return h('style', null, STYLES)
    }

    /** The Git glyph path, shared by the rail, the guide capsule and the launcher. */
    const GIT_PATH =
      'M5.5 1a2.5 2.5 0 0 0-1 4.79V10.2a2.5 2.5 0 1 0 1 0V5.79A2.5 2.5 0 0 0 5.5 1Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm0 9.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm5.75-8.5a2.5 2.5 0 0 0-1 4.79v.46a3.25 3.25 0 0 1-3.25 3.25h-.4a2.5 2.5 0 1 0 0 1.5h.4a4.75 4.75 0 0 0 4.75-4.75v-.46a2.5 2.5 0 0 0-1-4.79Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z'

    /**
     * The Git glyph.
     *
     * @param {object} props - icon props.
     * @returns {object} the svg element.
     */
    function GitGlyph({ size = 16 }) {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, fill: 'currentColor' },
        h('path', { d: GIT_PATH }),
      )
    }

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
            : h('textarea', { className: 'git-panel-textarea', value, autoFocus: true, onChange: (event) => setValue(event.target.value) }),
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
     * Render one unified diff as two aligned columns with line numbers.
     *
     * @param {object} props - the diff text and the translate function.
     * @returns {object} the side-by-side element.
     */
    function SideBySideDiff({ text, t = boundTranslate }) {
      const parsed = React.useMemo(() => parseUnifiedDiff(text), [text])
      if (parsed.binary) return h('div', { className: 'git-panel-empty' }, t('diff.binary'))
      if (parsed.hunks.length === 0) return h('div', { className: 'git-panel-empty' }, t('diff.empty'))
      return h(
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
                { key: `row-${hunkIndex}-${rowIndex}`, className: 'git-panel-sbs-row' },
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
      )
    }

    /**
     * One changed-path row.
     *
     * @param {object} props - row inputs.
     * @returns {object} the row element.
     */
    function ChangeRow({ file, busy, selected, onToggle, onSelect, onOpen, onContextMenu, t = boundTranslate }) {
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
          checked: file.staged === true,
          disabled: busy,
          title: file.staged === true ? t('unstageAll') : t('stageAll'),
          onClick: (event) => event.stopPropagation(),
          onChange: () => onToggle(file),
        }),
        h('span', { className: cx('git-panel-status', `git-panel-status-${statusText(file.status)}`) }, statusText(file.status)),
        h('span', { className: 'git-panel-branch' }, basename(file.path)),
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

    /**
     * The modal diff viewer: one file at a time, side by side.
     *
     * The content follows the current selection, so picking another row while
     * the modal is open swaps the diff; Escape, the scrim, or the close control
     * dismisses it. An empty diff for a commit says which part is out of date: a
     * Host that predates commit-aware diffs answers every commit file with an
     * empty worktree diff, which must not read as "this commit changed nothing".
     *
     * @param {object} props - the selected file, its diff, the owning commit, whether the Host is older, and close.
     * @returns {object} the modal element.
     */
    function DiffModal({ file, commit, text, stale, onClose, t = boundTranslate }) {
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
            h('span', { className: 'git-panel-spacer' }),
            h('button', { type: 'button', className: 'git-panel-btn', onClick: onClose, title: t('close') }, CLOSE_GLYPH),
          ),
          h('div', { className: 'git-panel-modal-body' }, body),
        ),
      )
    }

    /**
     * The Git plugin's configuration card.
     *
     * The Plugins page renders a bundle's own configuration on that bundle's
     * page, keyed by the package name, between its description and its rows — so
     * this is what opening `GitPanel` in the installed group shows. The body
     * is the shared settings form: it stages what the user types and writes it
     * only on save, which is the page's own contract — the plugin never commits
     * a value the user did not confirm.
     *
     * @param {object} props - the form snapshot and the form actions.
     * @returns {object} the form.
     */
    function GitSettingsCard(props) {
      const { t } = props
      const state = props.useGitSettings((snapshot) => snapshot)
      return h(
        primitives.SettingsForm,
        {
          labels: {
            unavailable: t('settings.unavailable'),
            readOnly: t('settings.readOnly'),
            saveFailed: t('settings.saveFailed'),
            save: t('settings.save'),
            saving: t('settings.saving'),
          },
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        h(primitives.SettingsValueField, {
          id: 'GitPanel-discovery-depth',
          label: t('depth'),
          hint: t('depth.hint'),
          overriddenLabel: t('settings.overridden'),
          resetLabel: t('settings.reset'),
          invalidLabel: t('settings.invalidNumber'),
          numeric: true,
          disabled: state.writable !== true,
          text: state[DEPTH_FIELD].text,
          overridden: state[DEPTH_FIELD].overridden,
          invalid: state[DEPTH_FIELD].invalid,
          onEdit: (text) => props.edit(DEPTH_FIELD, text),
          onReset: () => props.resetField(DEPTH_FIELD),
        }),
      )
    }

    /**
     * Build the Plugins page card's staged form over this plugin's settings.
     *
     * @param {object} configForms - the client configuration-form service.
     * @returns {{ inject: Function, dispose: Function }} the card's slot face and its disposer.
     */
    function createSettingsCard(configForms) {
      const form = new primitives.SettingsFormModel(configForms.get(SETTINGS_NS), [primitives.settingsNumberField(DEPTH_FIELD)])
      const store = form.bind(() => ({ ...form.shell(), [DEPTH_FIELD]: form.field(DEPTH_FIELD) }))
      return {
        /**
         * The face the card's slot registration injects.
         *
         * @returns {object} the snapshot hook the card reads and the form actions.
         */
        inject() {
          return { hooks: { gitSettings: store }, ...form.actions() }
        },
        /** Release the form's subscription to the settings document. */
        dispose() {
          form.dispose()
        },
      }
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
      const [busy, setBusy] = React.useState(false)
      const [reposLoading, setReposLoading] = React.useState(false)
      const [repoLoading, setRepoLoading] = React.useState(false)
      const [reloadToken, setReloadToken] = React.useState(0)
      const [error, setError] = React.useState(null)
      const [staleHost, setStaleHost] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [menu, setMenu] = React.useState(null)
      const [dialog, setDialog] = React.useState(null)
      const [branchFilter, setBranchFilter] = React.useState('')
      const [groups, setGroups] = React.useState({ local: true, remote: false, submodules: true })

      /** Whether either access is still in flight; the toolbar reports it. */
      const loading = reposLoading || repoLoading

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

      /** Reload the selected workspace, repository and history. */
      const refresh = React.useCallback(() => setReloadToken((value) => value + 1), [])

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
            // `discoveryDepth` is part of the current contract: a Host that does
            // not report it serves an older build, and saying so beats letting
            // the user discover it through a failed operation.
            setStaleHost(!Number.isFinite(payload.discoveryDepth))
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
      }, [workspaceRoot, reloadToken])

      // The selected repository's own state, reloaded whenever it changes.
      React.useEffect(() => {
        let cancelled = false
        if (repository === null) {
          setState(null)
          setCommits([])
          return undefined
        }
        setRepoLoading(true)
        setError(null)
        const calls = [callHost('state', { workspaceRoot, path: repository.path }), callHost('log', { workspaceRoot, path: repository.path, limit: COMMIT_PAGE })]
        Promise.all(calls)
          .then(([nextState, nextLog]) => {
            if (cancelled) return
            setState(nextState)
            setCommits(Array.isArray(nextLog.commits) ? nextLog.commits : [])
          })
          .catch((failure) => {
            if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
          })
          .finally(() => {
            if (!cancelled) setRepoLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [repository, workspaceRoot, reloadToken])

      // A selection belongs to the repository it was made in.
      React.useEffect(() => {
        setSelectedCommit(null)
        setSelectedFile(null)
        setCommitFiles([])
        setFilesError(null)
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
      // commit's own version of the file.
      const activeFile = selectedFile
      const activeCommit = selectedCommit
      React.useEffect(() => {
        let cancelled = false
        if (activeFile === null || repository === null) {
          setDiff(null)
          return undefined
        }
        callHost('diff', { workspaceRoot, path: repository.path, file: activeFile.path, staged: activeFile.staged === true, commit: activeCommit?.hash })
          .then((payload) => {
            if (!cancelled) setDiff(payload.diff ?? '')
          })
          .catch((failure) => {
            if (!cancelled) setDiff(`(diff unavailable: ${failureText(failure)})`)
          })
        return () => {
          cancelled = true
        }
      }, [activeFile, activeCommit, repository, workspaceRoot])

      /**
       * Run one mutating operation, then reload.
       *
       * @param {string} op - operation name.
       * @param {object} args - operation arguments.
       * @param {string|undefined} success - notice shown on success.
       * @returns {Promise<object|null>} the payload, or null on failure.
       */
      const mutate = React.useCallback(
        async (op, args, success) => {
          if (repository === null) return null
          setBusy(true)
          setError(null)
          try {
            const payload = await callHost(op, { workspaceRoot, path: repository.path, ...args })
            await refresh()
            if (success !== undefined) setNotice(success)
            return payload
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
            return null
          } finally {
            setBusy(false)
          }
        },
        [repository, workspaceRoot, refresh],
      )

      const closeMenu = React.useCallback(() => setMenu(null), [])
      const files = state?.files ?? []
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
       * @param {boolean} all - whether to stage every change first.
       * @param {boolean} push - whether to publish afterwards.
       * @returns {Promise<void>} nothing.
       */
      async function commit(all, push) {
        const text = message.trim()
        if (text === '') return
        const payload = await mutate('commit', { message: text, all }, undefined)
        if (payload === null) return
        setMessage('')
        const short = String(payload.hash ?? '').slice(0, 8)
        if (!push) {
          setNotice(fill(t('notice.committed'), { short }))
          return
        }
        const pushed = await mutate('push', { remote: state?.remoteNames?.[0] }, undefined)
        setNotice(pushed === null ? fill(t('notice.committedPushFailed'), { short }) : fill(t('notice.committedPushed'), { short }))
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
            run: () => setDialog({ title: t('amend'), input: fullMessage, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
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
            run: () => setDialog({ title: t('amend'), input: commit.body === '' ? commit.subject : `${commit.subject}\n\n${commit.body}`, confirm: t('amend'), run: (value) => mutate('amend', { message: value }, t('notice.amended')) }),
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
                roots.map((entry) => h('option', { key: entry.path, value: entry.path }, entry.path)),
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
                      h('span', { className: 'git-panel-pane-title' }, t('changes')),
                      h('span', { className: 'git-panel-count' }, String(files.length)),
                      h('span', { className: 'git-panel-spacer' }),
                      h('button', { type: 'button', className: 'git-panel-btn', disabled: busy || files.length === 0, onClick: () => mutate('stage', {}, t('notice.stagedAll')) }, t('stageAll')),
                      h('button', { type: 'button', className: 'git-panel-btn', disabled: busy || files.every((file) => file.staged !== true), onClick: () => mutate('unstage', {}, t('notice.unstagedAll')) }, t('unstageAll')),
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
                          onToggle: (entry) => mutate(entry.staged === true ? 'unstage' : 'stage', { paths: [entry.path] }, undefined),
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
                                entry.staged === true ? { label: t('unstageAll'), run: () => mutate('unstage', { paths: [entry.path] }) } : { label: t('stageAll'), run: () => mutate('stage', { paths: [entry.path] }) },
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
                ),
                // ---- middle: history ------------------------------------------
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
                ),
                // ---- right: the commit message above, its files below ---------
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
                ),
              ),
        menu === null ? null : h(ContextMenu, { menu, onClose: closeMenu }),
        dialog === null ? null : h(Dialog, { dialog, onClose: () => setDialog(null), t }),
        diffOpen && selectedFile !== null && repository !== null ? h(DiffModal, { file: selectedFile, commit: selectedCommit, text: diff, stale: staleHost, onClose: () => setDiffOpen(false), t }) : null,
      )
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

    /** Required browser services: slots for every seat, the tab registry, the right-Sidebar controller, layout, locale, and the shared configuration forms. */
    const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'layout', 'locale', 'configForms']

    /**
     * Register the sidebar entry, the main panel, the right-Sidebar tab, its
     * title, and the plugin's configuration card on the Plugins page.
     *
     * @param {object} ctx - client root context.
     */
    function apply(ctx) {
      hostContext = ctx
      const t = ctx.locale.bind(LOCALE_NS)
      boundTranslate = t
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { en, zh }), 'ui-GitPanel: dictionaries')
      try {
        primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      } catch {
        primitives = null
      }
      ctx.effect(
        () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: LOCALE_NS }, GitPanel)),
        'ui-GitPanel: git main panel',
      )

      ctx.effect(
        () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => t('title') }, GitGlyph)),
        'ui-GitPanel: git panel entry',
      )

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: PLUGIN_ID,
            kind: GIT_KIND,
            priority: 'extension',
            keepMounted: true,
            title: () => t('title'),
            guide: [{ id: 'git', order: 20, title: () => t('title'), description: () => t('launcherHint'), icon: GitGlyph }],
          }),
        'ui-GitPanel: git type',
      )

      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PLUGIN_ID, locale: LOCALE_NS }, GitTabDoor)),
        'ui-GitPanel: git tab door',
      )

      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: PLUGIN_ID, locale: LOCALE_NS }, GitTitle)),
        'ui-GitPanel: git tab title',
      )

      // The Plugins page renders a bundle's own configuration on that bundle's
      // page, keyed by the package name, and only once the Host serves the
      // namespace — so an older Host or a read-only document shows no dead form,
      // and a third-party bundle never claims a cell in the official group.
      if (primitives !== null && typeof ctx.configForms?.whileServed === 'function') {
        const card = createSettingsCard(ctx.configForms)
        ctx.effect(() => () => card.dispose(), 'ui-GitPanel: settings form subscription')
        ctx.effect(
          () =>
            ctx.configForms.whileServed([SETTINGS_NS], () =>
              ctx.slots.inject('plugins.bundle.config', () =>
                ctx.slots.register(
                  {
                    name: 'plugins.bundle.config',
                    key: PLUGIN_ID,
                    locale: LOCALE_NS,
                    inject: () => card.inject(),
                  },
                  GitSettingsCard,
                ),
              ),
            ),
          'ui-GitPanel: settings card',
        )
      }
    }

    return { inject, apply }
  },
})
