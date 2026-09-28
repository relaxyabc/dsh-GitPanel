/**
 * Host half of the Git manager bundle.
 *
 * Owns every filesystem and process interaction: repository discovery under a
 * workspace root, `git` subprocess invocation for reads and mutations, and one
 * exact Fetch route on the authenticated `/api` carrier so the browser half can
 * reach it. The route is registered through `ctx.connection.fetch`, so it
 * inherits the same Host/Origin fence and browser-session authentication as the
 * shipped API bridge; it is never a bare unauthenticated webserver route.
 *
 * Reads are `repos`, `state`, `log`, `commitFiles`, and `diff`; writes are
 * `stage`, `unstage`, `commit`, `push`, `checkout`, `deleteBranch`, `reset`,
 * `cherryPick`, `revert`, `amend`, and `submodule`. The one setting, the
 * repository discovery depth, is a plain plugin Config field the Plugins page
 * edits through the Host settings service.
 *
 * @module GitPanel
 */
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Exact Fetch route the browser half posts operations to. */
const ROUTE_PATH = '/api/local-git'

/** Services this plugin needs before it can register its route. */
export const inject = ['webServer', 'connection']

/** Largest body accepted for one operation, in bytes. */
const MAX_BODY_BYTES = 1024 * 1024

/** Wall-clock cap for a single `git` invocation, in milliseconds. */
const GIT_TIMEOUT_MS = 60_000

/** Cap on captured stdout/stderr of one `git` invocation, in bytes. */
const GIT_MAX_BUFFER = 32 * 1024 * 1024

/** Directory names never descended into during repository discovery. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.gradle',
  '.idea',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
])

/** Deepest directory level repository discovery may ever descend to. */
const MAX_DISCOVERY_DEPTH = 8

/** Directory levels discovery descends to when no configuration says otherwise. */
const DEFAULT_DISCOVERY_DEPTH = 3

/**
 * Live plugin settings.
 *
 * `discoveryDepth` is declared volatile, so the Loader keeps serving the
 * running plugin a live reference and commits an edited value in place instead
 * of re-applying the plugin. Holding the resolved configuration and unwrapping
 * it per call is therefore what makes a settings edit take effect at once.
 */
const settings = { config: null }

/**
 * Clamp a configured discovery depth into the guardrail range.
 *
 * @param {unknown} value - the configured depth.
 * @returns {number} the effective depth.
 */
function clampDepth(value) {
  const depth = Math.trunc(Number(value))
  if (!Number.isFinite(depth)) return DEFAULT_DISCOVERY_DEPTH
  return Math.min(Math.max(depth, 1), MAX_DISCOVERY_DEPTH)
}

/**
 * Read a stored configuration value, unwrapping the live reference a volatile
 * field resolves to.
 *
 * @param {unknown} value - the configured value.
 * @returns {unknown} the plain value behind it.
 */
function configValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/**
 * The discovery depth in force right now.
 *
 * @returns {number} the clamped depth.
 */
function effectiveDepth() {
  return clampDepth(configValue(settings.config?.discoveryDepth))
}

/** Most repositories one discovery call reports. */
const MAX_REPOSITORIES = 64

/** Most directory entries one discovery call visits. */
const MAX_DISCOVERY_ENTRIES = 20_000

/** Record separator separating two commit records in `git log` output. */
const RS = '\u001e'

/** Field separator separating two fields of one record. */
const US = '\u001f'

/**
 * Run one `git` command in a directory.
 *
 * Arguments travel as an argv array, so no caller-supplied value is ever parsed
 * by a shell. A non-zero exit is reported as data, not thrown: `git` uses the
 * exit status for ordinary answers such as "the path is untracked".
 *
 * @param {string} cwd - absolute directory to run in.
 * @param {readonly string[]} args - complete argv after the program name.
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code: number }>} the invocation outcome.
 */
function runGit(cwd, args) {
  return new Promise((settle) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        settle({
          ok: error === null,
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
          code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
        })
      },
    )
  })
}

/**
 * Run one `git` command and require success.
 *
 * @param {string} cwd - absolute directory to run in.
 * @param {readonly string[]} args - complete argv after the program name.
 * @returns {Promise<string>} stdout on success.
 * @throws {Error} with `git`'s stderr when the command fails.
 */
async function gitOrThrow(cwd, args) {
  const result = await runGit(cwd, args)
  if (!result.ok) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git exited with ${result.code}`
    throw new Error(detail)
  }
  return result.stdout
}

/**
 * Assert a value is a non-empty string.
 *
 * @param {unknown} value - candidate.
 * @returns {string} the value when it is usable.
 * @throws {Error} when the value is missing or empty.
 */
function requireText(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('a non-empty string is required')
  return value
}

/**
 * Resolve a caller-supplied repository path against the workspace root.
 *
 * Paths escaping the workspace root are refused, so the route can only ever
 * operate on directories the Session already owns.
 *
 * @param {string} workspaceRoot - absolute workspace root of the calling Session.
 * @param {string} candidate - absolute or root-relative repository path.
 * @returns {string} the absolute repository path.
 * @throws {Error} when the path escapes the workspace root.
 */
function resolveInside(workspaceRoot, candidate) {
  const root = resolve(requireText(workspaceRoot))
  const target = resolve(root, requireText(candidate))
  const foldedRoot = process.platform === 'win32' ? root.toLowerCase() : root
  const foldedTarget = process.platform === 'win32' ? target.toLowerCase() : target
  if (foldedTarget !== foldedRoot && !foldedTarget.startsWith(`${foldedRoot}\\`) && !foldedTarget.startsWith(`${foldedRoot}/`)) {
    throw new Error('the path is outside the workspace root')
  }
  return target
}

/**
 * List every Git repository at or below one directory.
 *
 * A directory holding a `.git` entry (directory or file) is a repository. Its
 * own tree is still searched, so a nested independent repository is reported,
 * and each declared submodule working tree is enqueued explicitly so a
 * submodule placed outside the parent's tree is still found. Sibling
 * directories are searched recursively, so a workspace holding several
 * independent repositories reports all of them.
 *
 * The descent limit is the configured discovery depth, clamped to the
 * `MAX_DISCOVERY_DEPTH` guardrail, so a live settings edit applies per call.
 *
 * @param {string} root - absolute workspace root.
 * @returns {Promise<Array<{ path: string, name: string, relative: string, isSubmodule: boolean }>>} discovered repositories.
 */
async function discoverRepositories(root) {
  const depthLimit = effectiveDepth()
  const found = []
  const seen = new Set()
  const queue = [{ path: root, depth: 0 }]
  let visited = 0

  while (queue.length > 0 && found.length < MAX_REPOSITORIES && visited < MAX_DISCOVERY_ENTRIES) {
    const current = queue.shift()
    let entries
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    visited += entries.length

    let isRepository = false
    let declaresSubmodules = false
    const directories = []
    for (const entry of entries) {
      if (entry.name === '.git') {
        isRepository = true
        continue
      }
      if (entry.name === '.gitmodules') {
        declaresSubmodules = true
        continue
      }
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      if (entry.name.startsWith('.') && entry.name !== '.config') continue
      directories.push(entry.name)
    }

    if (isRepository && !seen.has(current.path)) {
      seen.add(current.path)
      found.push(current.path)
      // Enqueue declared submodule working trees explicitly: a submodule placed
      // outside the parent's own tree is still a repository of this workspace.
      // The declaration is already in hand, so this costs no extra `git` run.
      if (declaresSubmodules) {
        for (const submodule of await listSubmodulePaths(current.path)) {
          const absolute = join(current.path, submodule.path)
          if (!seen.has(absolute)) queue.push({ path: absolute, depth: current.depth })
        }
      }
    }

    if (current.depth >= depthLimit) continue
    directories.sort((left, right) => left.localeCompare(right, 'en'))
    for (const name of directories) queue.push({ path: join(current.path, name), depth: current.depth + 1 })
  }

  return dedupeRepositories(await Promise.all(found.map((path) => describeRepository(root, path))))
}

/**
 * Drop duplicate discovery rows.
 *
 * A submodule working tree reached twice — once through the walk, once through
 * its own declaration — would otherwise be reported twice, and the two arrival
 * routes spell separators differently.
 *
 * @param {Array<{ path: string, name: string, relative: string, isSubmodule: boolean }>} rows - described repositories.
 * @returns {Array<{ path: string, name: string, relative: string, isSubmodule: boolean }>} the unique rows, in discovery order.
 */
function dedupeRepositories(rows) {
  const seen = new Set()
  const unique = []
  for (const row of rows) {
    if (seen.has(row.path)) continue
    seen.add(row.path)
    unique.push(row)
  }
  return unique
}

/**
 * Read a repository's declared submodule paths.
 *
 * @param {string} repositoryPath - absolute repository directory.
 * @returns {Promise<Array<{ path: string }>>} declared submodules.
 */
async function listSubmodulePaths(repositoryPath) {
  const result = await runGit(repositoryPath, ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'])
  if (!result.ok) return []
  const rows = []
  for (const line of result.stdout.split('\n')) {
    const separator = line.indexOf(' ')
    if (separator === -1) continue
    const value = line.slice(separator + 1).trim()
    if (value !== '') rows.push({ path: value })
  }
  return rows
}

/**
 * Build one discovery row for a repository directory.
 *
 * @param {string} root - absolute workspace root.
 * @param {string} repositoryPath - absolute repository directory.
 * @returns {Promise<{ path: string, name: string, relative: string, isSubmodule: boolean }>} the row.
 */
async function describeRepository(root, repositoryPath) {
  const relative = repositoryPath.slice(root.length).replace(/^[\\/]+/, '')
  let isSubmodule = false
  try {
    const superproject = (await gitOrThrow(repositoryPath, ['rev-parse', '--show-superproject-working-tree'])).trim()
    isSubmodule = superproject !== ''
  } catch {
    isSubmodule = false
  }
  return {
    path: repositoryPath.replace(/\\/g, '/'),
    name: relative === '' ? repositoryPath.split(/[\\/]/).pop() ?? repositoryPath : relative.split(/[\\/]/).pop() ?? relative,
    relative: relative.replace(/\\/g, '/'),
    isSubmodule,
  }
}

/**
 * Parse one `git status --porcelain=v2 --branch` record set.
 *
 * @param {string} raw - NUL-separated porcelain v2 output.
 * @returns {{ branch: object, detached: boolean, head: string, upstream: string|null, ahead: number, behind: number, files: Array<object> }} the parsed status.
 */
function parsePorcelainV2(raw) {
  const branch = { head: null, upstream: null, ahead: 0, behind: 0, oid: null }
  const files = []
  const parts = raw.split('\0')
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === '') continue
    if (part.startsWith('# ')) {
      const body = part.slice(2)
      const separator = body.indexOf(' ')
      const key = separator === -1 ? body : body.slice(0, separator)
      const value = separator === -1 ? '' : body.slice(separator + 1)
      if (key === 'branch.head') branch.head = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') branch.upstream = value
      else if (key === 'branch.oid') branch.oid = value
      else if (key === 'branch.ab') {
        const match = /^\+(\d+)\s+-(\d+)$/.exec(value.trim())
        if (match !== null) {
          branch.ahead = Number(match[1])
          branch.behind = Number(match[2])
        }
      }
      continue
    }
    if (part.startsWith('1 ')) {
      const fields = part.split(' ')
      files.push({ status: statusLetter(fields[1]), index: fields[1]?.[0] ?? '.', path: fields.slice(8).join(' '), from: null })
      continue
    }
    if (part.startsWith('2 ')) {
      const fields = part.split(' ')
      const origin = parts[index + 1] ?? ''
      index += 1
      files.push({ status: statusLetter(fields[1]), index: fields[1]?.[0] ?? '.', path: fields.slice(9).join(' '), from: origin })
      continue
    }
    if (part.startsWith('u ')) {
      const fields = part.split(' ')
      files.push({ status: 'U', index: 'U', path: fields.slice(10).join(' '), from: null })
      continue
    }
    if (part.startsWith('? ')) {
      files.push({ status: '?', index: '?', path: part.slice(2), from: null })
    }
  }
  return {
    branch,
    detached: branch.head === null,
    head: branch.head ?? (branch.oid === null ? '' : branch.oid.slice(0, 7)),
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    files,
  }
}

/**
 * Reduce a porcelain XY status pair to one letter.
 *
 * @param {string} xy - the two status characters, index first.
 * @returns {string} the reported letter.
 */
function statusLetter(xy) {
  if (typeof xy !== 'string' || xy.length < 2) return 'M'
  const [index, worktree] = [xy[0], xy[1]]
  const candidates = [index, worktree]
  for (const candidate of candidates) {
    if (candidate === 'U') return 'U'
    if (candidate !== '.' && candidate !== ' ' && candidate !== '?') return candidate
  }
  return xy === '??' ? '?' : 'M'
}

/**
 * Parse one `git log --format` payload into structured commits.
 *
 * Records are separated by the format's own record separator and their fields
 * by the unit separator, so a multi-line commit body — which is the only field
 * that may contain newlines — needs no line-oriented parsing at all.
 *
 * @param {string} raw - the formatted log output.
 * @returns {Array<object>} commits, newest first.
 */
function parseLog(raw) {
  const commits = []
  for (const record of raw.split(RS)) {
    if (record.trim() === '') continue
    const fields = record.split(US)
    const hash = fields[0] ?? ''
    if (hash === '') continue
    commits.push({
      hash,
      short: hash.slice(0, 8),
      author: fields[1] ?? '',
      email: fields[2] ?? '',
      timestamp: Number(fields[3] ?? 0),
      parents: (fields[4] ?? '').split(' ').filter((entry) => entry !== ''),
      refs: (fields[5] ?? '')
        .split(', ')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
      subject: fields[6] ?? '',
      body: fields.slice(7).join(US).trim(),
    })
  }
  return commits
}

/**
 * Parse `git branch --format` output into branch rows.
 *
 * @param {string} raw - the formatted output.
 * @param {boolean} remote - whether these are remote-tracking branches.
 * @returns {Array<object>} branch rows.
 */
function parseBranches(raw, remote) {
  const rows = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const fields = line.split(US)
    const name = fields[0] ?? ''
    if (name === '' || name.endsWith('/HEAD')) continue
    rows.push({
      name,
      current: (fields[1] ?? '') === '*',
      upstream: fields[2] === undefined || fields[2] === '' ? null : fields[2],
      track: fields[3] === undefined || fields[3] === '' ? null : fields[3],
      subject: fields[4] ?? '',
      timestamp: Number(fields[5] ?? 0),
      remote,
    })
  }
  return rows
}

/**
 * Parse `git submodule status` output.
 *
 * @param {string} raw - the status output.
 * @returns {Array<object>} submodule rows.
 */
function parseSubmodules(raw) {
  const rows = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const marker = line[0]
    const rest = line.slice(1).trim()
    const separator = rest.indexOf(' ')
    const oid = separator === -1 ? rest : rest.slice(0, separator)
    const remainder = separator === -1 ? '' : rest.slice(separator + 1).trim()
    const fields = remainder.split(' ')
    rows.push({
      path: fields[0] ?? '',
      head: oid,
      describe: fields.slice(1).join(' '),
      state: marker === '-' ? 'uninitialized' : marker === '+' ? 'out-of-date' : marker === 'U' ? 'conflicted' : 'initialized',
    })
  }
  return rows
}

/**
 * Read a repository's submodule rows.
 *
 * `git submodule status` walks the whole working tree and costs about a second
 * even in a repository that has no submodule at all, which is the single
 * slowest call this plugin makes. A repository that declares none — no
 * `.gitmodules` entry and no gitlink in the index — cannot report one, so the
 * expensive call only runs once a declaration exists. The cheap probes answer
 * in tens of milliseconds.
 *
 * @param {string} repositoryPath - absolute repository directory.
 * @returns {Promise<Array<object>>} the submodule rows.
 */
async function readSubmodules(repositoryPath) {
  const declared = await listSubmodulePaths(repositoryPath)
  if (declared.length === 0 && !(await hasGitlink(repositoryPath))) return []
  const result = await runGit(repositoryPath, ['submodule', 'status', '--recursive'])
  return result.ok ? parseSubmodules(result.stdout) : []
}

/**
 * Whether a repository's index records a gitlink.
 *
 * A submodule entry can exist without a `.gitmodules` mapping, so the index is
 * the second place a declaration can live.
 *
 * @param {string} repositoryPath - absolute repository directory.
 * @returns {Promise<boolean>} whether the index holds a mode-160000 entry.
 */
async function hasGitlink(repositoryPath) {
  const result = await runGit(repositoryPath, ['ls-files', '--stage'])
  if (!result.ok) return false
  for (const line of result.stdout.split('\n')) if (line.startsWith('160000 ')) return true
  return false
}

/**
 * Build the complete branch and change picture for one repository.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @returns {Promise<object>} the repository state.
 */
async function readState(repositoryPath) {
  const root = (await gitOrThrow(repositoryPath, ['rev-parse', '--show-toplevel'])).trim().replace(/\\/g, '/')
  const statusRaw = await gitOrThrow(repositoryPath, [
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all',
    '-z',
  ])
  const parsed = parsePorcelainV2(statusRaw)

  const [stagedRaw, unstagedRaw] = await Promise.all([
    runGit(repositoryPath, ['diff', '--cached', '--numstat', '-z']).then((result) => (result.ok ? result.stdout : '')),
    runGit(repositoryPath, ['diff', '--numstat', '-z']).then((result) => (result.ok ? result.stdout : '')),
  ])
  const stagedStats = new Map()
  for (const row of parseNumstat(stagedRaw)) stagedStats.set(row.path, row)
  const unstagedStats = new Map()
  for (const row of parseNumstat(unstagedRaw)) unstagedStats.set(row.path, row)

  const files = parsed.files.map((file) => {
    const code = file.status
    const untracked = code === '?'
    const staged = !untracked && code !== 'U' && (file.index !== '.' || stagedStats.has(file.path))
    const primary = staged && stagedStats.has(file.path) ? stagedStats.get(file.path) : unstagedStats.get(file.path) ?? stagedStats.get(file.path)
    const added = (stagedStats.get(file.path)?.added ?? 0) + (untracked ? 0 : unstagedStats.get(file.path)?.added ?? 0)
    const removed = (stagedStats.get(file.path)?.removed ?? 0) + (untracked ? 0 : unstagedStats.get(file.path)?.removed ?? 0)
    return {
      path: file.path,
      from: file.from,
      status: code,
      added,
      removed,
      binary: primary?.added === null || primary?.removed === null,
      staged,
      untracked,
    }
  })

  const branchFormat = `--format=%(refname:short)${US}%(HEAD)${US}%(upstream:short)${US}%(upstream:track)${US}%(contents:subject)${US}%(committerdate:unix)`
  const [branchResult, remoteResult, submodules, remoteNames] = await Promise.all([
    runGit(repositoryPath, ['branch', branchFormat]),
    runGit(repositoryPath, ['branch', '--remotes', branchFormat]),
    readSubmodules(repositoryPath),
    runGit(repositoryPath, ['remote']),
  ])

  return {
    root,
    name: root.split('/').pop() ?? root,
    branch: parsed.head,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    branches: parseBranches(branchResult.ok ? branchResult.stdout : '', false),
    remotes: parseBranches(remoteResult.ok ? remoteResult.stdout : '', true),
    remoteNames: (remoteNames.ok ? remoteNames.stdout : '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
    submodules,
    files,
  }
}

/**
 * Parse `git diff --numstat -z` output.
 *
 * @param {string} raw - the NUL-separated numstat output.
 * @returns {Array<{ added: number|null, removed: number|null, path: string }>} per-path line counts.
 */
function parseNumstat(raw) {
  const rows = []
  const parts = raw.split('\0')
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === '') continue
    const first = part.indexOf('\t')
    const second = first === -1 ? -1 : part.indexOf('\t', first + 1)
    if (first === -1 || second === -1) continue
    const added = part.slice(0, first)
    const removed = part.slice(first + 1, second)
    let path = part.slice(second + 1)
    if (path === '') {
      const from = parts[index + 1] ?? ''
      const to = parts[index + 2] ?? ''
      index += 2
      path = from === to ? to : `${from} -> ${to}`
    }
    rows.push({
      added: added === '-' ? null : Number(added),
      removed: removed === '-' ? null : Number(removed),
      path,
    })
  }
  return rows
}

/**
 * Read one repository's commit history.
 *
 * The page carries no per-commit file list: `--numstat` over a whole page costs
 * several times the plain log and can pull megabytes across the wire for
 * history the user has not looked at. `readCommit` answers that per commit, on
 * selection.
 *
 * `args.path` is the repository to read (resolved by the caller); `args.file`
 * optionally narrows the history to one path inside it.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} the commit page.
 */
async function readLog(repositoryPath, args) {
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 200) : 30
  const format = `${RS}%H${US}%an${US}%ae${US}%at${US}%P${US}%D${US}%s${US}%b`
  const argv = ['log', `-n${limit}`, '--no-color', `--format=${format}`]
  if (typeof args.branch === 'string' && args.branch !== '') argv.push(args.branch)
  if (typeof args.file === 'string' && args.file !== '') argv.push('--', args.file)
  const raw = await gitOrThrow(repositoryPath, argv)
  return { commits: parseLog(raw) }
}

/**
 * The first parent of one commit, or null for a root commit.
 *
 * A commit is shown against its first parent: a merge has no single change set
 * of its own, and the first parent is what `git log`'s own diff would use.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {string} commit - the commit to inspect.
 * @returns {Promise<string|null>} the first parent hash.
 */
async function firstParentOf(repositoryPath, commit) {
  const raw = await gitOrThrow(repositoryPath, ['rev-list', '--max-count=1', '--parents', commit])
  const fields = raw.trim().split(/\s+/).filter((entry) => entry !== '')
  return fields.length > 1 ? fields[1] : null
}

/**
 * The argv listing one commit's changed paths.
 *
 * @param {string|null} parent - the commit's first parent, or null for a root commit.
 * @param {string} commit - the commit to inspect.
 * @returns {string[]} the argv after the program name.
 */
function commitNumstatArgs(parent, commit) {
  return parent === null
    ? ['show', '--no-color', '--no-renames', '--numstat', '-z', '--format=', commit]
    : ['diff', '--no-color', '--no-renames', '--numstat', '-z', parent, commit]
}

/**
 * The argv showing one file's change inside one commit.
 *
 * @param {string|null} parent - the commit's first parent, or null for a root commit.
 * @param {string} commit - the commit to inspect.
 * @param {string} file - the repository-relative path.
 * @returns {string[]} the argv after the program name.
 */
function commitDiffArgs(parent, commit, file) {
  return parent === null
    ? ['show', '--no-color', '--no-ext-diff', '--no-renames', '--format=', commit, '--', file]
    : ['diff', '--no-color', '--no-ext-diff', '--no-renames', parent, commit, '--', file]
}

/**
 * Read the paths one commit changed.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} the commit's file rows.
 */
async function readCommit(repositoryPath, args) {
  const commit = requireText(args.commit)
  const parent = await firstParentOf(repositoryPath, commit)
  const raw = await gitOrThrow(repositoryPath, commitNumstatArgs(parent, commit))
  const files = parseNumstat(raw).map((row) => ({
    path: row.path,
    added: row.added,
    removed: row.removed,
    binary: row.added === null || row.removed === null,
  }))
  return { commit, parent, files }
}

/**
 * Stage or unstage paths, or every path when none is named.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} an empty success payload.
 */
async function writeStage(repositoryPath, args) {
  const paths = Array.isArray(args.paths) ? args.paths.filter((entry) => typeof entry === 'string') : []
  const staged = args.staged === true
  if (staged) {
    await gitOrThrow(repositoryPath, ['reset', '--', ...(paths.length > 0 ? paths : [])])
  } else if (paths.length > 0) {
    await gitOrThrow(repositoryPath, ['add', '--', ...paths])
  } else {
    await gitOrThrow(repositoryPath, ['add', '-A'])
  }
  return {}
}

/**
 * Create one commit.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} the new commit hash and subject.
 */
async function writeCommit(repositoryPath, args) {
  const message = requireText(args.message)
  if (Array.isArray(args.paths) && args.paths.length > 0) {
    await gitOrThrow(repositoryPath, ['add', '--', ...args.paths.filter((entry) => typeof entry === 'string')])
  }
  const argv = ['commit', '-m', message]
  if (args.amend === true) argv.push('--amend')
  if (args.all === true) argv.push('--all')
  const output = await gitOrThrow(repositoryPath, argv)
  const hash = (await gitOrThrow(repositoryPath, ['rev-parse', 'HEAD'])).trim()
  return { hash, summary: output.trim().split('\n').slice(0, 2).join('\n') }
}

/**
 * Publish the current branch or a named branch to its remote.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} git's own progress report.
 */
async function writePush(repositoryPath, args) {
  const argv = ['push']
  if (args.setUpstream === true) argv.push('--set-upstream')
  if (typeof args.remote === 'string' && args.remote !== '') argv.push(args.remote)
  if (typeof args.branch === 'string' && args.branch !== '') argv.push(args.branch)
  const output = await gitOrThrow(repositoryPath, argv)
  return { summary: output.trim() }
}

/**
 * Switch to an existing branch or create one.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} the branch now checked out.
 */
async function writeCheckout(repositoryPath, args) {
  const target = requireText(args.name)
  const argv = ['checkout']
  if (args.create === true) argv.push('-b')
  argv.push(target)
  if (typeof args.startPoint === 'string' && args.startPoint !== '') argv.push(args.startPoint)
  const output = await gitOrThrow(repositoryPath, argv)
  const branch = (await runGit(repositoryPath, ['branch', '--show-current'])).stdout.trim()
  return { branch, summary: output.trim() }
}

/**
 * Delete a local branch.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} git's own report.
 */
async function writeDeleteBranch(repositoryPath, args) {
  const name = requireText(args.name)
  const argv = args.force === true ? ['branch', '-D', name] : ['branch', '-d', name]
  const output = await gitOrThrow(repositoryPath, argv)
  return { summary: output.trim() }
}

/**
 * Move HEAD to another commit, optionally keeping or discarding local state.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} git's own report.
 */
async function writeReset(repositoryPath, args) {
  const commit = requireText(args.commit)
  const mode = args.mode === 'soft' || args.mode === 'hard' ? args.mode : 'mixed'
  const output = await gitOrThrow(repositoryPath, ['reset', `--${mode}`, commit])
  return { summary: output.trim() }
}

/**
 * Apply one commit onto the current branch.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} git's own report.
 */
async function writeCherryPick(repositoryPath, args) {
  const commit = requireText(args.commit)
  const argv = ['cherry-pick']
  if (args.record === true) argv.push('-x')
  if (args.noCommit === true) argv.push('--no-commit')
  argv.push(commit)
  const output = await gitOrThrow(repositoryPath, argv)
  return { summary: output.trim() }
}

/**
 * Revert one commit with a new commit.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} git's own report.
 */
async function writeRevert(repositoryPath, args) {
  const commit = requireText(args.commit)
  const argv = ['revert', '--no-edit']
  if (args.noCommit === true) argv.push('--no-commit')
  argv.push(commit)
  const output = await gitOrThrow(repositoryPath, argv)
  return { summary: output.trim() }
}

/**
 * Rewrite the message of the newest commit.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} the rewritten commit hash.
 */
async function writeAmend(repositoryPath, args) {
  const message = requireText(args.message)
  const output = await gitOrThrow(repositoryPath, ['commit', '--amend', '-m', message])
  const hash = (await gitOrThrow(repositoryPath, ['rev-parse', 'HEAD'])).trim()
  return { hash, summary: output.trim() }
}

/**
 * Initialize, update, or synchronize submodules.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} git's own report.
 */
async function writeSubmodule(repositoryPath, args) {
  const action = typeof args.action === 'string' ? args.action : 'update'
  if (action === 'init') {
    const output = await gitOrThrow(repositoryPath, ['submodule', 'update', '--init', '--recursive'])
    return { summary: output.trim() }
  }
  if (action === 'sync') {
    const output = await gitOrThrow(repositoryPath, ['submodule', 'sync', '--recursive'])
    return { summary: output.trim() }
  }
  const output = await gitOrThrow(repositoryPath, ['submodule', 'update', '--init', '--remote', '--recursive'])
  return { summary: output.trim() }
}

/**
 * Read one file's unified diff.
 *
 * Three sources, in the order the request names them: a commit's own version of
 * the file (against that commit's first parent), the index against `HEAD`, or
 * the working tree — with an untracked path diffed against the empty file.
 *
 * @param {string} repositoryPath - absolute repository path.
 * @param {object} args - request arguments.
 * @returns {Promise<object>} the diff text.
 */
async function readDiff(repositoryPath, args) {
  const file = requireText(args.file)
  if (typeof args.commit === 'string' && args.commit !== '') {
    const commit = args.commit
    const parent = await firstParentOf(repositoryPath, commit)
    const committed = await runGit(repositoryPath, commitDiffArgs(parent, commit, file))
    if (!committed.ok) throw new Error(committed.stderr.trim() || `git exited with ${committed.code}`)
    return { diff: committed.stdout, untracked: false, commit, parent }
  }
  const argv = ['diff']
  if (args.staged === true) argv.push('--cached')
  argv.push('--', file)
  const tracked = await runGit(repositoryPath, argv)
  if (tracked.ok && tracked.stdout.trim() !== '') return { diff: tracked.stdout, untracked: false }
  const statusResult = await runGit(repositoryPath, ['status', '--porcelain', '--', file])
  if (!statusResult.stdout.startsWith('??')) {
    if (!tracked.ok) throw new Error(tracked.stderr.trim() || `git diff exited with ${tracked.code}`)
    return { diff: '', untracked: false }
  }
  const untrackedDiff = await runGit(repositoryPath, ['diff', '--no-index', '--no-color', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file])
  return { diff: untrackedDiff.stdout, untracked: true }
}

/** Operations that only read repository state. */
const READ_OPERATIONS = {
  /**
   * Discover every repository under a workspace root.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the discovered repositories.
   */
  async repos(args) {
    const root = resolve(requireText(args.workspaceRoot))
    const info = await stat(root).catch(() => null)
    if (info === null || !info.isDirectory()) throw new Error(`the workspace root does not exist: ${root}`)
    const repositories = await discoverRepositories(root)
    return { workspaceRoot: root.replace(/\\/g, '/'), discoveryDepth: effectiveDepth(), repositories }
  },

  /**
   * Read one repository's branches, changes, and submodules.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the state.
   */
  async state(args) {
    const repositoryPath = resolveInside(args.workspaceRoot, args.path)
    return readState(repositoryPath)
  },

  /**
   * Read one repository's commit history.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the commit page.
   */
  async log(args) {
    const repositoryPath = resolveInside(args.workspaceRoot, args.path)
    return readLog(repositoryPath, args)
  },
  /**
   * Read the paths one commit changed.
   *
   * Named apart from the `commit` write operation: `dispatch` resolves a read
   * first, so a same-named read would shadow committing entirely.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the commit's file rows.
   */
  async commitFiles(args) {
    const repositoryPath = resolveInside(args.workspaceRoot, args.path)
    return readCommit(repositoryPath, args)
  },
  /**
   * Read one file's unified diff.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the diff.
   */
  async diff(args) {
    const repositoryPath = resolveInside(args.workspaceRoot, args.path)
    return readDiff(repositoryPath, args)
  },
}

/** Operations that mutate repository state. */
const WRITE_OPERATIONS = {
  /**
   * Stage paths, or every path when none is named.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} an empty success payload.
   */
  stage: (args) => writeStage(resolveInside(args.workspaceRoot, args.path), { ...args, staged: false }),
  /**
   * Unstage paths, or every staged path when none is named.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} an empty success payload.
   */
  unstage: (args) => writeStage(resolveInside(args.workspaceRoot, args.path), { ...args, staged: true }),
  /**
   * Create one commit.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the new commit.
   */
  commit: (args) => writeCommit(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Publish a branch to its remote.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} git's report.
   */
  push: (args) => writePush(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Switch to or create a branch.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the checked-out branch.
   */
  checkout: (args) => writeCheckout(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Delete a local branch.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} git's report.
   */
  deleteBranch: (args) => writeDeleteBranch(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Move HEAD to another commit.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} git's report.
   */
  reset: (args) => writeReset(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Apply one commit onto the current branch.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} git's report.
   */
  cherryPick: (args) => writeCherryPick(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Revert one commit with a new commit.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} git's report.
   */
  revert: (args) => writeRevert(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Rewrite the newest commit's message.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} the rewritten commit.
   */
  amend: (args) => writeAmend(resolveInside(args.workspaceRoot, args.path), args),
  /**
   * Initialize, update, or synchronize submodules.
   *
   * @param {object} args - request arguments.
   * @returns {Promise<object>} git's report.
   */
  submodule: (args) => writeSubmodule(resolveInside(args.workspaceRoot, args.path), args),
}

/**
 * Dispatch one operation request.
 *
 * @param {unknown} payload - the decoded JSON body.
 * @returns {Promise<object>} the JSON response envelope.
 */
async function dispatch(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'the request body must be a JSON object' }
  }
  const operation = payload.op
  if (typeof operation !== 'string' || operation === '') return { ok: false, error: 'the request needs an `op`' }
  const args = payload.args === null || typeof payload.args !== 'object' || Array.isArray(payload.args) ? {} : payload.args
  const handler = READ_OPERATIONS[operation] ?? WRITE_OPERATIONS[operation]
  if (handler === undefined) return { ok: false, error: `unknown operation "${operation}"` }
  try {
    const data = await handler(args)
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ---- configuration ----------------------------------------------------------
//
// The bundle declares its plugin Config without importing schemastery: the
// Host's config pipeline only needs the schemastery graph markers (the
// `schemastery` symbol, `type`/`meta`/`dict` fields, a `toJSON` in the
// `{ uid, refs }` wire format, and a Standard Schema `~standard.validate`),
// so a small compatible node keeps the zero-dependency rule while the Host
// validates values and renders a native settings form.

/** The graph marker the Host's schema projection recognises. */
const SCHEMA_MARKER = Symbol.for('schemastery')

/** Shared behaviour of every hand-built schema node. */
const SCHEMA_PROTOTYPE = {
  [SCHEMA_MARKER]: true,
}

Object.defineProperty(SCHEMA_PROTOTYPE, '~standard', {
  /**
   * The Standard Schema face cordis resolves configuration through.
   *
   * @returns {object} the validate face.
   */
  get() {
    const node = this
    return {
      version: 1,
      vendor: 'GitPanel',
      /**
       * Validate and normalise one raw configuration value.
       *
       * @param {unknown} value - the raw user configuration.
       * @returns {object} `{ value }`, or `{ issues }` per the Standard Schema contract.
       */
      validate(value) {
        try {
          return { value: resolveNode(value, node) }
        } catch (error) {
          return { issues: [{ message: error instanceof Error ? error.message : String(error), path: error.path ?? [] }] }
        }
      },
    }
  },
})

/**
 * Serialize one node exactly the way schemastery does: `{ uid, refs }`, each
 * ref holding the node's own enumerable props with child nodes replaced by
 * their uids, so Host and form renderer rebuild native graphs unchanged.
 *
 * @returns {object|number} the root descriptor, or this node's uid while nested.
 */
SCHEMA_PROTOTYPE.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__ !== undefined) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }))
    return this.uid
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } }
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }))
  const result = { uid: this.uid, refs: globalThis.__schemastery_refs__ }
  globalThis.__schemastery_refs__ = undefined
  return result
}

/** Next node uid; uniqueness inside one graph is all the wire format needs. */
let schemaUid = 0

/**
 * Build one schema node.
 *
 * @param {object} options - node fields: `type`, `meta`, and `dict` children.
 * @returns {Function} the node, callable as a validator.
 */
function makeSchemaNode(options) {
  const node = (value) => resolveNode(value, node)
  Object.assign(node, options)
  Object.defineProperty(node, 'uid', { value: schemaUid++ })
  Object.setPrototypeOf(node, SCHEMA_PROTOTYPE)
  return node
}

/**
 * Build one validation failure carrying its location path.
 *
 * @param {string} message - what did not match.
 * @returns {TypeError} the tagged error.
 */
function schemaError(message) {
  const error = new TypeError(message)
  error.path = []
  return error
}

/**
 * Resolve one value against a node, applying defaults and bounds.
 *
 * @param {unknown} value - the raw value.
 * @param {Function} node - the schema node.
 * @returns {unknown} the normalised value.
 * @throws {TypeError} when the value does not match the node.
 */
function resolveNode(value, node) {
  if (node.type === 'object') {
    if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) {
      throw schemaError('expected an object')
    }
    const source = value === null || value === undefined ? {} : value
    const result = {}
    for (const [key, child] of Object.entries(node.dict ?? {})) {
      try {
        const resolved = resolveNode(source[key], child)
        if (resolved !== undefined) result[key] = resolved
      } catch (error) {
        error.path = [key, ...error.path]
        throw error
      }
    }
    return result
  }
  if (node.type === 'number') {
    const meta = node.meta ?? {}
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (meta.default === undefined) throw schemaError('a number is required')
      return meta.default
    }
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed)) throw schemaError('a finite number is required')
    if (meta.min !== undefined && parsed < meta.min) throw schemaError(`must be ${meta.min} or more`)
    if (meta.max !== undefined && parsed > meta.max) throw schemaError(`must be ${meta.max} or less`)
    return parsed
  }
  return value
}

/** The `discoveryDepth` field: editable live, bounded by the discovery guardrails. */
const DISCOVERY_DEPTH_NODE = makeSchemaNode({
  type: 'number',
  meta: {
    default: DEFAULT_DISCOVERY_DEPTH,
    min: 1,
    max: MAX_DISCOVERY_DEPTH,
    volatile: true,
    description: {
      '': `Directory levels repository discovery descends to below the workspace root (1-${MAX_DISCOVERY_DEPTH}).`,
      zh: `仓库发现向下递归的目录层数(1-${MAX_DISCOVERY_DEPTH} 层)。`,
    },
  },
})

/**
 * The plugin configuration schema: one live-edited discovery depth.
 *
 * Hand-built to stay dependency-free; the shape mirrors schemastery's own wire
 * protocol so the Host treats it as a native graph.
 */
export const Config = makeSchemaNode({
  type: 'object',
  meta: {},
  dict: { discoveryDepth: DISCOVERY_DEPTH_NODE },
})

/**
 * Register the operation route and apply the plugin configuration.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ discoveryDepth?: number }} [config] - the validated plugin configuration.
 */
export function apply(ctx, config) {
  settings.config = config ?? null
  ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    /**
     * Answer one operation request.
     *
     * @param {Request} request - the admitted request, already authenticated.
     * @returns {Promise<Response>} the JSON envelope.
     */
    async fetch(request) {
      const declared = Number(request.headers.get('content-length') ?? '0')
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return Response.json({ ok: false, error: 'the request body is too large' }, { status: 413 })
      }
      let payload
      try {
        payload = await request.json()
      } catch {
        return Response.json({ ok: false, error: 'the request body is not JSON' }, { status: 400 })
      }
      const body = await dispatch(payload)
      return Response.json(body, { headers: { 'cache-control': 'no-store' } })
    },
  })
}
