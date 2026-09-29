/**
 * End-to-end harness for the Git manager Host half.
 *
 * Builds a throwaway workspace holding two independent repositories plus a real
 * Git submodule, mounts the Host plugin with a fake Connection service, and
 * exercises every operation through the registered Fetch route.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../index.js'

/** Isolated global git config, so the harness never reads the operator's identity. */
const GIT_CONFIG = join(tmpdir(), `git-panel-e2e-config-${process.pid}`)
writeFileSync(GIT_CONFIG, '[user]\n\tname = Test\n\temail = test@example.com\n[protocol "file"]\n\tallow = always\n')

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: GIT_CONFIG,
  GIT_CONFIG_SYSTEM: GIT_CONFIG,
  GIT_TERMINAL_PROMPT: '0',
}

// The Host half spawns `git` with the process environment, so the identity and
// transport this fixture relies on must also reach the plugin's own children.
process.env.GIT_CONFIG_GLOBAL = GIT_CONFIG
process.env.GIT_CONFIG_SYSTEM = GIT_CONFIG

/**
 * The fixture's remote transports. A submodule clone is spawned by `git` itself
 * rather than by the plugin, so only the environment can widen this.
 */
process.env.GIT_ALLOW_PROTOCOL = 'file:git:http:https'

let failures = 0
let checks = 0

/**
 * Assert one condition.
 * @param {boolean} condition - condition to assert.
 * @param {string} label - what was asserted.
 * @param {unknown} detail - extra detail on failure.
 */
function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

/**
 * Run one git command in a directory.
 * @param {string} cwd - directory.
 * @param {string[]} args - argv.
 * @returns {string} stdout.
 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' })
}

/**
 * Build a forward-slash relative path from one directory to another.
 * @param {string} from - absolute source directory.
 * @param {string} to - absolute target path.
 * @returns {string} the relative path.
 */
function relative(from, to) {
  const fromParts = from.replace(/\\/g, '/').split('/')
  const toParts = to.replace(/\\/g, '/').split('/')
  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift()
    toParts.shift()
  }
  return [...fromParts.map(() => '..'), ...toParts].join('/')
}

/** Capture the route the plugin registers. */
let route = null
const ctx = {
  effect: (callback) => callback(),
  connection: {
    fetch: {
      register: (registered) => {
        route = registered
        return async () => {}
      },
    },
  },
}

apply(ctx)
check(route !== null, 'the plugin registers one Fetch route')
check(route?.path === '/api/local-git', 'the route lives under /api', route?.path)
check(Array.isArray(route?.methods) && route.methods.includes('POST'), 'the route answers POST')

// ---- manifest and locales --------------------------------------------------------
// Display metadata has exactly one home. `readPluginMeta` reads locale/*.json and
// falls back to package.json name/description — never to a package.json `meta`, so a
// second copy there could only drift from the strings DSH actually shows.
console.log('\nmanifest and locales')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const englishLocale = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
const chineseLocale = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'))
check(manifest.meta === undefined, 'the plugin card text lives in locale/*.json, not package.json meta', manifest.meta)
check(
  Object.keys(englishLocale).join() === 'meta' && Object.keys(chineseLocale).join() === 'meta',
  'each locale file carries only meta, the one key DSH reads',
  { en: Object.keys(englishLocale), zh: Object.keys(chineseLocale) },
)
const metaFields = Object.keys(englishLocale.meta ?? {}).sort().join()
check(metaFields === 'description,title', 'a locale file declares exactly the two display fields', metaFields)
check(
  JSON.stringify(Object.keys(englishLocale.meta ?? {}).sort()) === JSON.stringify(Object.keys(chineseLocale.meta ?? {}).sort()),
  'en and zh declare the same display fields',
  { en: Object.keys(englishLocale.meta ?? {}), zh: Object.keys(chineseLocale.meta ?? {}) },
)
check(
  manifest.files?.includes('locale/*.json') === true && manifest.exports?.['./locale/*.json'] === './locale/*.json',
  'the locale files ship and resolve through the export map',
  { files: manifest.files, exports: manifest.exports },
)

/**
 * Call one operation through the registered route.
 * @param {string} op - operation name.
 * @param {object} args - operation arguments.
 * @returns {Promise<object>} the decoded envelope.
 */
async function call(op, args) {
  const request = new Request('http://127.0.0.1/api/local-git', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, args }),
  })
  const response = await route.fetch(request)
  return { status: response.status, body: await response.json() }
}

const root = mkdtempSync(join(tmpdir(), 'git-panel-e2e-'))
console.log(`workspace: ${root}`)

try {
  // ---- fixture -----------------------------------------------------------------
  const alpha = join(root, 'alpha')
  mkdirSync(alpha, { recursive: true })
  git(alpha, ['init', '-b', 'main'])
  writeFileSync(join(alpha, 'readme.md'), 'hello\n')
  git(alpha, ['add', '-A'])
  git(alpha, ['commit', '-m', 'initial commit'])
  git(alpha, ['checkout', '-b', 'feature/x'])
  writeFileSync(join(alpha, 'feature.txt'), 'feature\n')
  git(alpha, ['add', '-A'])
  git(alpha, ['commit', '-m', 'add feature'])
  git(alpha, ['checkout', 'main'])
  git(alpha, ['branch', 'topic'])

  const beta = join(root, 'nested', 'deep', 'beta')
  mkdirSync(beta, { recursive: true })
  git(beta, ['init', '-b', 'main'])
  writeFileSync(join(beta, 'b.txt'), 'beta\n')
  git(beta, ['add', '-A'])
  git(beta, ['commit', '-m', 'beta initial'])

  // a real submodule: a third repository referenced by beta
  const libSource = join(root, 'libsource')
  mkdirSync(libSource, { recursive: true })
  git(libSource, ['init', '-b', 'main'])
  writeFileSync(join(libSource, 'lib.txt'), 'lib\n')
  git(libSource, ['add', '-A'])
  git(libSource, ['commit', '-m', 'lib initial'])
  git(beta, ['-c', 'protocol.file.allow=always', 'submodule', 'add', relative(beta, libSource), 'vendor/lib'])
  writeFileSync(join(beta, '.gitmodules'), `[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = ${relative(beta, libSource)}\n`)
  git(beta, ['add', '.gitmodules'])
  git(beta, ['commit', '-m', 'add submodule'])

  // ---- repos -------------------------------------------------------------------
  console.log('\nrepos')
  const repos = await call('repos', { workspaceRoot: root })
  check(repos.body.ok === true, 'repos succeeds', repos.body)
  const paths = (repos.body.data?.repositories ?? []).map((entry) => entry.relative).sort()
  check(paths.includes('alpha'), 'discovers alpha', paths)
  check(paths.includes('nested/deep/beta'), 'discovers a nested repository', paths)
  check(paths.includes('libsource'), 'discovers a sibling repository', paths)
  check(paths.includes('nested/deep/beta/vendor/lib'), 'discovers a submodule working tree', paths)
  check((repos.body.data?.repositories ?? []).some((entry) => entry.relative === 'nested/deep/beta/vendor/lib' && entry.isSubmodule === true), 'marks the submodule as one')

  await call('repos', { workspaceRoot: join(root, '..') })
  const outside = await call('repos', { workspaceRoot: join(root, 'does-not-exist') })
  check(outside.body.ok === false, 'a missing workspace root is refused', outside.body)

  // ---- discovery depth -----------------------------------------------------------
  console.log('\ndiscovery depth')
  const deepRepo = join(root, 'nested', 'deep', 'very', 'repo4')
  mkdirSync(deepRepo, { recursive: true })
  git(deepRepo, ['init', '-b', 'main'])
  writeFileSync(join(deepRepo, 'deep.txt'), 'deep\n')
  git(deepRepo, ['add', '-A'])
  git(deepRepo, ['commit', '-m', 'deep initial'])
  const shallowPaths = (await call('repos', { workspaceRoot: root })).body.data?.repositories?.map((entry) => entry.relative) ?? []
  check(!shallowPaths.includes('nested/deep/very/repo4'), 'the default depth stops at three levels', shallowPaths)
  apply(ctx, { discoveryDepth: 6 })
  const deeperPaths = (await call('repos', { workspaceRoot: root })).body.data?.repositories?.map((entry) => entry.relative) ?? []
  check(deeperPaths.includes('nested/deep/very/repo4'), 'a deeper configuration reaches the fourth level', deeperPaths)
  apply(ctx, { discoveryDepth: 2 })
  const narrowPaths = (await call('repos', { workspaceRoot: root })).body.data?.repositories?.map((entry) => entry.relative) ?? []
  check(!narrowPaths.includes('nested/deep/beta'), 'a shallower configuration stops at two levels', narrowPaths)
  apply(ctx, { discoveryDepth: 99 })
  const clampedPaths = (await call('repos', { workspaceRoot: root })).body.data?.repositories?.map((entry) => entry.relative) ?? []
  check(clampedPaths.includes('nested/deep/very/repo4'), 'an out-of-range depth clamps to the guardrail cap', clampedPaths)
  apply(ctx)

  // ---- depth as a live field --------------------------------------------------------
  console.log('\ndepth as a live configuration field')
  const defaultRepos = (await call('repos', { workspaceRoot: root })).body.data ?? {}
  check(defaultRepos.discoveryDepth === 3, 'the repos answer carries the depth in force', defaultRepos.discoveryDepth)
  apply(ctx, { discoveryDepth: 4 })
  const writtenRepos = (await call('repos', { workspaceRoot: root })).body.data ?? {}
  check(writtenRepos.discoveryDepth === 4, 'a configured depth is the one reported', writtenRepos.discoveryDepth)
  check((writtenRepos.repositories ?? []).some((entry) => entry.relative === 'nested/deep/very/repo4'), 'the configured depth reaches the fourth level', (writtenRepos.repositories ?? []).map((entry) => entry.relative))
  apply(ctx, { discoveryDepth: 99 })
  const clampedRepos = (await call('repos', { workspaceRoot: root })).body.data ?? {}
  check(clampedRepos.discoveryDepth === 8, 'an out-of-range configuration is clamped at runtime', clampedRepos.discoveryDepth)
  // A volatile field reaches the plugin as a live reference the Loader updates in
  // place, so the depth must be read per call rather than captured at apply time.
  const live = { value: 2 }
  apply(ctx, { discoveryDepth: { get: () => live.value } })
  const narrow = (await call('repos', { workspaceRoot: root })).body.data ?? {}
  check(narrow.discoveryDepth === 2 && !(narrow.repositories ?? []).some((entry) => entry.relative === 'nested/deep/beta'), 'a volatile reference is read when discovery runs', { depth: narrow.discoveryDepth, repos: (narrow.repositories ?? []).map((entry) => entry.relative) })
  live.value = 6
  const widened = (await call('repos', { workspaceRoot: root })).body.data ?? {}
  check(widened.discoveryDepth === 6 && (widened.repositories ?? []).some((entry) => entry.relative === 'nested/deep/very/repo4'), 'a live settings edit applies without re-applying the plugin', { depth: widened.discoveryDepth, repos: (widened.repositories ?? []).map((entry) => entry.relative) })
  const liveSwitch = { value: true }
  apply(ctx, { wholeFileDiff: { get: () => liveSwitch.value } })
  const switchOn = (await call('repos', { workspaceRoot: root })).body.data ?? {}
  check(switchOn.wholeFileDiff === true, 'the repos answer carries the whole-file switch in force', switchOn.wholeFileDiff)
  liveSwitch.value = false
  const switchOff = (await call('repos', { workspaceRoot: root })).body.data ?? {}
  check(switchOff.wholeFileDiff === false, 'a live switch edit applies without re-applying the plugin', switchOff.wholeFileDiff)
  apply(ctx)

  // ---- configuration ---------------------------------------------------------------
  console.log('\nconfiguration')
  const filled = Config['~standard'].validate({})
  check(filled.value?.discoveryDepth === 3, 'the configuration default is three levels', filled)
  const coerced = Config['~standard'].validate({ discoveryDepth: '5' })
  check(coerced.value?.discoveryDepth === 5, 'numeric strings are accepted', coerced)
  const over = Config['~standard'].validate({ discoveryDepth: 99 })
  check(Array.isArray(over.issues) && over.issues.length > 0, 'a depth over the cap is refused', over)
  const under = Config['~standard'].validate({ discoveryDepth: 0 })
  check(Array.isArray(under.issues) && under.issues.length > 0, 'a depth under one is refused', under)
  check(typeof Config.toJSON === 'function' && Config.type === 'object' && Config.dict?.discoveryDepth?.type === 'number', 'the schema projects as a native graph')
  check(Config.dict?.wholeFileDiff?.type === 'boolean', 'the schema carries the whole-file switch', Config.dict)
  check(filled.value?.wholeFileDiff === false, 'the whole-file switch defaults to off', filled)
  const wholeOn = Config['~standard'].validate({ wholeFileDiff: true })
  check(wholeOn.value?.wholeFileDiff === true, 'the whole-file switch accepts a boolean', wholeOn)
  const wholeString = Config['~standard'].validate({ wholeFileDiff: 'true' })
  check(wholeString.value?.wholeFileDiff === true, 'a boolean string is accepted', wholeString)
  const wholeBogus = Config['~standard'].validate({ wholeFileDiff: 'maybe' })
  check(Array.isArray(wholeBogus.issues) && wholeBogus.issues.length > 0, 'a non-boolean switch is refused', wholeBogus)
  check(Config.dict?.filePreviewFix?.type === 'boolean', 'the schema carries the file-preview repair', Config.dict)
  check(filled.value?.filePreviewFix === true, 'the file-preview repair defaults to on', filled)
  check(Config.dict?.filePreviewFix?.meta?.volatile === true, 'the file-preview repair is editable without re-applying the plugin', Config.dict?.filePreviewFix?.meta)
  const previewOff = Config['~standard'].validate({ filePreviewFix: false })
  check(previewOff.value?.filePreviewFix === false, 'the file-preview repair accepts being turned off', previewOff)
  const previewString = Config['~standard'].validate({ filePreviewFix: 'false' })
  check(previewString.value?.filePreviewFix === false, 'a boolean string turns the repair off too', previewString)
  const previewBogus = Config['~standard'].validate({ filePreviewFix: 'maybe' })
  check(Array.isArray(previewBogus.issues) && previewBogus.issues.length > 0, 'a non-boolean repair value is refused', previewBogus)
  const projected = Config.toJSON()
  check(
    projected?.refs !== undefined && Object.values(projected.refs).some((node) => node?.dict?.filePreviewFix !== undefined),
    'the serialized graph carries the repair field for the settings page',
    Object.keys(projected?.refs ?? {}).length,
  )

  // ---- state -------------------------------------------------------------------
  console.log('\nstate')
  const state = await call('state', { workspaceRoot: root, path: 'alpha' })
  check(state.body.ok === true, 'state succeeds', state.body)
  const alphaState = state.body.data
  check(alphaState?.branch === 'main', 'reports the current branch', alphaState?.branch)
  check(alphaState?.branches?.some((entry) => entry.name === 'feature/x'), 'lists local branches', alphaState?.branches?.map((entry) => entry.name))
  check(alphaState?.branches?.find((entry) => entry.name === 'main')?.current === true, 'marks the current branch')
  check(alphaState?.files?.length === 0, 'a clean tree reports no changes', alphaState?.files)
  check(alphaState?.submodules?.length === 0, 'a repository without submodule declarations reports none', alphaState?.submodules)

  writeFileSync(join(alpha, 'readme.md'), 'hello\nworld\n')
  writeFileSync(join(alpha, 'brand-new.txt'), 'new\n')
  const dirty = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  const modified = dirty.files.find((entry) => entry.path === 'readme.md')
  const untracked = dirty.files.find((entry) => entry.path === 'brand-new.txt')
  check(modified !== undefined && modified.status === 'M', 'reports a modified path', modified)
  check(modified?.added === 1 && modified?.removed === 0, 'counts modified lines', modified)
  check(untracked !== undefined && untracked.untracked === true, 'reports an untracked path', untracked)
  check(modified?.staged === false, 'an unstaged modification is not staged', modified)

  const betaState = (await call('state', { workspaceRoot: root, path: 'nested/deep/beta' })).body.data
  check((betaState?.submodules?.length ?? 0) === 1, 'reports the submodule', betaState?.submodules)
  check(betaState?.submodules?.[0]?.path === 'vendor/lib', 'names the submodule path', betaState?.submodules?.[0])
  check(betaState?.submodules?.[0]?.state === 'initialized', 'reports the submodule as initialized', betaState?.submodules?.[0])

  // ---- diff --------------------------------------------------------------------
  console.log('\ndiff')
  const diff = await call('diff', { workspaceRoot: root, path: 'alpha', file: 'readme.md', staged: false })
  check(diff.body.ok === true, 'diff succeeds', diff.body)
  check(typeof diff.body.data?.diff === 'string' && diff.body.data.diff.includes('+world'), 'diff carries the added line', diff.body.data?.diff)
  const untrackedDiff = await call('diff', { workspaceRoot: root, path: 'alpha', file: 'brand-new.txt', staged: false })
  check(untrackedDiff.body.ok === true, 'diff of an untracked file succeeds', untrackedDiff.body)
  check(String(untrackedDiff.body.data?.diff ?? '').includes('+new'), 'untracked diff carries the content')

  // ---- stage / unstage ---------------------------------------------------------
  console.log('\nstage and unstage')
  const staged = await call('stage', { workspaceRoot: root, path: 'alpha', paths: ['readme.md'] })
  check(staged.body.ok === true, 'stage succeeds', staged.body)
  const afterStage = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(afterStage.files.find((entry) => entry.path === 'readme.md')?.staged === true, 'the path reports as staged')
  const unstaged = await call('unstage', { workspaceRoot: root, path: 'alpha', paths: ['readme.md'] })
  check(unstaged.body.ok === true, 'unstage succeeds', unstaged.body)
  const afterUnstage = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(afterUnstage.files.find((entry) => entry.path === 'readme.md')?.staged === false, 'the path reports as unstaged')

  await call('stage', { workspaceRoot: root, path: 'alpha' })
  const allStaged = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(allStaged.files.every((entry) => entry.staged === true), 'stage with no paths stages everything', allStaged.files)

  // ---- commit ------------------------------------------------------------------
  console.log('\ncommit')
  const committed = await call('commit', { workspaceRoot: root, path: 'alpha', message: 'test: commit from the panel' })
  check(committed.body.ok === true, 'commit succeeds', committed.body)
  check(typeof committed.body.data?.hash === 'string' && committed.body.data.hash.length === 40, 'commit returns a full hash', committed.body.data?.hash)
  const cleanState = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(cleanState.files.length === 0, 'the tree is clean after committing', cleanState.files)

  const emptyCommit = await call('commit', { workspaceRoot: root, path: 'alpha', message: '   ' })
  check(emptyCommit.body.ok === false, 'an empty commit message is refused', emptyCommit.body)

  // ---- log ---------------------------------------------------------------------
  console.log('\nlog')
  const log = await call('log', { workspaceRoot: root, path: 'alpha', limit: 10 })
  check(log.body.ok === true, 'log succeeds', JSON.stringify(log.body).slice(0, 500))
  const commits = log.body.data?.commits ?? []
  check(commits.length === 2, 'log returns the commits reachable from HEAD', commits.map((entry) => entry.subject))
  check(commits[0]?.subject === 'test: commit from the panel', 'the newest commit is first', commits[0]?.subject)
  check(commits[0]?.author === 'Test', 'the author is parsed', commits[0]?.author)
  check(Number.isFinite(commits[0]?.timestamp) && commits[0].timestamp > 0, 'the timestamp is parsed', commits[0]?.timestamp)
  check(commits[0]?.files === undefined, 'the log page carries no per-commit file list', commits[0]?.files)
  check(commits[0]?.refs?.some((entry) => entry.includes('main')), 'ref decorations are parsed', commits[0]?.refs)

  // ---- per-commit files ----------------------------------------------------------
  console.log('\ncommit files')
  const newestFiles = await call('commitFiles', { workspaceRoot: root, path: 'alpha', commit: commits[0].hash })
  check(newestFiles.body.ok === true, 'commitFiles succeeds', newestFiles.body)
  const newestRows = newestFiles.body.data?.files ?? []
  check(newestRows.some((entry) => entry.path === 'readme.md' && entry.added === 1), 'commitFiles reports the changed path', newestRows)
  check(newestRows.some((entry) => entry.path === 'brand-new.txt'), 'commitFiles reports every path of the commit', newestRows)
  check(newestFiles.body.data?.parent === commits[0].parents[0], 'commitFiles names the diff base', newestFiles.body.data)
  const rootFiles = await call('commitFiles', { workspaceRoot: root, path: 'alpha', commit: commits[commits.length - 1].hash })
  check(rootFiles.body.ok === true, 'commitFiles answers for a root commit', rootFiles.body)
  check(rootFiles.body.data?.parent === null, 'a root commit has no parent', rootFiles.body.data)
  check((rootFiles.body.data?.files ?? []).some((entry) => entry.path === 'readme.md'), 'a root commit lists its whole tree', rootFiles.body.data?.files)
  const missingCommit = await call('commitFiles', { workspaceRoot: root, path: 'alpha' })
  check(missingCommit.body.ok === false, 'commitFiles without a commit is refused', missingCommit.body)

  const commitDiff = await call('diff', { workspaceRoot: root, path: 'alpha', file: 'readme.md', commit: commits[0].hash })
  check(commitDiff.body.ok === true, 'a commit diff succeeds', commitDiff.body)
  check(String(commitDiff.body.data?.diff ?? '').includes('+world'), 'a commit diff carries what that commit changed', commitDiff.body.data?.diff)
  const untouchedCommitDiff = await call('diff', { workspaceRoot: root, path: 'alpha', file: 'readme.md', commit: commits[commits.length - 1].hash })
  check(String(untouchedCommitDiff.body.data?.diff ?? '').includes('+hello'), 'a commit that did not touch a file still answers for it', untouchedCommitDiff.body.data?.diff)

  const featureLog = await call('log', { workspaceRoot: root, path: 'alpha', limit: 10, branch: 'feature/x' })
  check(
    (featureLog.body.data?.commits ?? []).some((entry) => entry.subject === 'add feature'),
    'log can read another branch',
    (featureLog.body.data?.commits ?? []).map((entry) => entry.subject),
  )

  // ---- amend -------------------------------------------------------------------
  console.log('\namend')
  const amended = await call('amend', { workspaceRoot: root, path: 'alpha', message: 'test: amended subject' })
  check(amended.body.ok === true, 'amend succeeds', amended.body)
  check(amended.body.data?.hash !== committed.body.data?.hash, 'amend rewrites the hash')
  const afterAmend = (await call('log', { workspaceRoot: root, path: 'alpha', limit: 1 })).body.data.commits[0]
  check(afterAmend.subject === 'test: amended subject', 'amend replaces the message', afterAmend.subject)

  // ---- branches ----------------------------------------------------------------
  console.log('\nbranches')
  const checkout = await call('checkout', { workspaceRoot: root, path: 'alpha', name: 'feature/x' })
  check(checkout.body.ok === true, 'checkout succeeds', checkout.body)
  check(checkout.body.data?.branch === 'feature/x', 'checkout reports the new branch', checkout.body.data?.branch)
  const created = await call('checkout', { workspaceRoot: root, path: 'alpha', name: 'from-main', create: true, startPoint: 'main' })
  check(created.body.ok === true, 'checkout -b succeeds', created.body)
  const branchList = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data.branches.map((entry) => entry.name)
  check(branchList.includes('from-main'), 'the created branch is listed', branchList)
  const deleted = await call('deleteBranch', { workspaceRoot: root, path: 'alpha', name: 'from-main' })
  check(deleted.body.ok === false, 'a branch checked out in a worktree cannot be deleted', deleted.body)
  await call('checkout', { workspaceRoot: root, path: 'alpha', name: 'main' })
  const deletedNow = await call('deleteBranch', { workspaceRoot: root, path: 'alpha', name: 'from-main' })
  check(deletedNow.body.ok === true, 'deleteBranch succeeds once the branch is not checked out', deletedNow.body)

  // ---- cherry-pick --------------------------------------------------------------
  console.log('\ncherry-pick')
  const featureHash = (await call('log', { workspaceRoot: root, path: 'alpha', limit: 10, branch: 'feature/x' })).body.data.commits.find(
    (entry) => entry.subject === 'add feature',
  ).hash
  const picked = await call('cherryPick', { workspaceRoot: root, path: 'alpha', commit: featureHash })
  check(picked.body.ok === true, 'cherry-pick succeeds', picked.body)
  check((await call('state', { workspaceRoot: root, path: 'alpha' })).body.data.files.length === 0, 'cherry-pick leaves a clean tree')

  // ---- revert ------------------------------------------------------------------
  console.log('\nrevert')
  const reverted = await call('revert', { workspaceRoot: root, path: 'alpha', commit: featureHash })
  check(reverted.body.ok === true, 'revert succeeds', reverted.body)
  const revertLog = (await call('log', { workspaceRoot: root, path: 'alpha', limit: 1 })).body.data.commits[0]
  check(revertLog.subject.startsWith('Revert'), 'revert created a revert commit', revertLog.subject)

  // ---- reset -------------------------------------------------------------------
  console.log('\nreset')
  const resetSoft = await call('reset', { workspaceRoot: root, path: 'alpha', commit: 'HEAD~1', mode: 'soft' })
  check(resetSoft.body.ok === true, 'reset --soft succeeds', resetSoft.body)
  const afterSoft = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(afterSoft.files.length > 0 && afterSoft.files.every((entry) => entry.staged === true), 'reset --soft keeps changes staged', afterSoft.files)
  const resetHard = await call('reset', { workspaceRoot: root, path: 'alpha', commit: 'HEAD', mode: 'hard' })
  check(resetHard.body.ok === true, 'reset --hard succeeds', resetHard.body)
  check((await call('state', { workspaceRoot: root, path: 'alpha' })).body.data.files.length === 0, 'reset --hard clears the tree')

  // ---- push --------------------------------------------------------------------
  console.log('\npush')
  const bare = join(root, 'alpha-remote.git')
  mkdirSync(bare, { recursive: true })
  git(bare, ['init', '--bare', '-b', 'main'])
  git(alpha, ['remote', 'add', 'origin', bare.replace(/\\/g, '/')])
  const withRemote = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(withRemote.remoteNames.includes('origin'), 'the remote is listed', withRemote.remoteNames)
  check(withRemote.upstream === null, 'the branch starts without an upstream', withRemote.upstream)
  const pushed = await call('push', { workspaceRoot: root, path: 'alpha', remote: 'origin', branch: 'main', setUpstream: true })
  check(pushed.body.ok === true, 'push succeeds', pushed.body)
  const afterPush = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(afterPush.upstream === 'origin/main', 'push -u records the upstream', afterPush.upstream)
  check(afterPush.remotes.some((entry) => entry.name === 'origin/main'), 'the remote-tracking branch is listed', afterPush.remotes.map((entry) => entry.name))
  check(afterPush.ahead === 0 && afterPush.behind === 0, 'ahead/behind are in sync', { ahead: afterPush.ahead, behind: afterPush.behind })

  // ---- fetch and pull ----------------------------------------------------------
  console.log('\nfetch and pull')
  const peer = join(root, 'alpha-peer')
  git(root, ['clone', '--quiet', bare.replace(/\\/g, '/'), peer.replace(/\\/g, '/')])
  writeFileSync(join(peer, 'peer.txt'), 'from the peer\n')
  git(peer, ['add', '-A'])
  git(peer, ['commit', '-m', 'peer: add a file'])
  git(peer, ['push', '--quiet', 'origin', 'main'])
  const beforeFetch = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(beforeFetch.behind === 0, 'the local branch is in sync before fetching', beforeFetch.behind)
  const fetched = await call('fetch', { workspaceRoot: root, path: 'alpha' })
  check(fetched.body.ok === true, 'fetch succeeds', fetched.body)
  const afterFetch = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(afterFetch.behind === 1, 'fetch advances the behind count', afterFetch.behind)
  check(afterFetch.files.length === 0, 'fetch leaves the working tree alone', afterFetch.files)
  const pulled = await call('pull', { workspaceRoot: root, path: 'alpha' })
  check(pulled.body.ok === true, 'pull succeeds', pulled.body)
  const afterPull = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(afterPull.behind === 0 && afterPull.ahead === 0, 'pull integrates the upstream', { ahead: afterPull.ahead, behind: afterPull.behind })
  check(readFileSync(join(alpha, 'peer.txt'), 'utf8') === 'from the peer\n', 'pull brings the new file into the working tree')

  writeFileSync(join(alpha, 'extra.txt'), 'x\n')
  await call('stage', { workspaceRoot: root, path: 'alpha' })
  await call('commit', { workspaceRoot: root, path: 'alpha', message: 'ahead commit' })
  const aheadState = (await call('state', { workspaceRoot: root, path: 'alpha' })).body.data
  check(aheadState.ahead === 1, 'ahead counts unpublished commits', aheadState.ahead)

  // ---- submodule ---------------------------------------------------------------
  console.log('\nsubmodule')
  const updated = await call('submodule', { workspaceRoot: root, path: 'nested/deep/beta', action: 'update' })
  check(updated.body.ok === true, 'submodule update succeeds', updated.body)
  const synced = await call('submodule', { workspaceRoot: root, path: 'nested/deep/beta', action: 'sync' })
  check(synced.body.ok === true, 'submodule sync succeeds', synced.body)

  // a clone whose submodule is not initialized yet exercises the `--init` path
  const clone = join(root, 'beta-clone')
  git(root, ['clone', '--quiet', beta.replace(/\\/g, '/'), clone.replace(/\\/g, '/')])
  const beforeInit = (await call('state', { workspaceRoot: root, path: 'beta-clone' })).body.data
  check(beforeInit.submodules[0]?.state === 'uninitialized', 'a fresh clone reports an uninitialized submodule', beforeInit.submodules)
  const initialised = await call('submodule', { workspaceRoot: root, path: 'beta-clone', action: 'init' })
  check(initialised.body.ok === true, 'submodule init succeeds', initialised.body)
  const afterInit = (await call('state', { workspaceRoot: root, path: 'beta-clone' })).body.data
  check(afterInit.submodules[0]?.state === 'initialized', 'the submodule is initialized afterwards', afterInit.submodules)

  // ---- whole-file diff ---------------------------------------------------------
  console.log('\nwhole-file diff')
  const diffRepo = join(root, 'diffrepo')
  mkdirSync(diffRepo, { recursive: true })
  git(diffRepo, ['init', '-b', 'main'])
  const longLines = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`)
  writeFileSync(join(diffRepo, 'long.txt'), `${longLines.join('\n')}\n`)
  git(diffRepo, ['add', '-A'])
  git(diffRepo, ['commit', '-m', 'seed a long file'])
  const editedLines = [...longLines]
  editedLines[19] = 'line-20-changed'
  writeFileSync(join(diffRepo, 'long.txt'), `${editedLines.join('\n')}\n`)

  const compactDiff = (await call('diff', { workspaceRoot: root, path: 'diffrepo', file: 'long.txt' })).body.data?.diff ?? ''
  check(compactDiff.includes('-line-20') && compactDiff.includes('+line-20-changed'), 'the compact diff carries the change', compactDiff.slice(0, 200))
  check(!compactDiff.includes(' line-1\n'), 'the compact diff omits distant context', compactDiff.slice(0, 200))
  const wholeDiff = (await call('diff', { workspaceRoot: root, path: 'diffrepo', file: 'long.txt', wholeFile: true })).body.data?.diff ?? ''
  check(wholeDiff.includes('-line-20') && wholeDiff.includes('+line-20-changed'), 'the whole-file diff carries the change', wholeDiff.slice(0, 200))
  check(wholeDiff.includes(' line-1\n') && wholeDiff.includes(' line-40'), 'the whole-file diff carries the entire file')

  const seedHash = (await call('log', { workspaceRoot: root, path: 'diffrepo', limit: 1 })).body.data.commits[0].hash
  const wholeCommitDiff = (await call('diff', { workspaceRoot: root, path: 'diffrepo', file: 'long.txt', commit: seedHash, wholeFile: true })).body.data?.diff ?? ''
  check(wholeCommitDiff.includes('+line-1\n') && wholeCommitDiff.includes('+line-40'), 'a whole-file commit diff carries the entire file', wholeCommitDiff.slice(0, 200))

  // ---- failures ----------------------------------------------------------------
  console.log('\nfailures')
  const escape = await call('state', { workspaceRoot: alpha, path: '../libsource' })
  check(escape.body.ok === false, 'a path outside the workspace root is refused', escape.body)
  const unknown = await call('nope', {})
  check(unknown.body.ok === false, 'an unknown operation is refused', unknown.body)
  const badFetch = await call('fetch', { workspaceRoot: alpha, path: '../libsource' })
  check(badFetch.body.ok === false, 'fetch refuses a path outside the workspace root', badFetch.body)
  const badPull = await call('pull', { workspaceRoot: alpha, path: '../libsource' })
  check(badPull.body.ok === false, 'pull refuses a path outside the workspace root', badPull.body)
  const missingRoot = await call('state', { path: 'alpha' })
  check(missingRoot.body.ok === false, 'a missing workspaceRoot is refused', missingRoot.body)
  const normalised = await call('state', { workspaceRoot: root, path: 'libsource/../alpha' })
  check(normalised.body.ok === true, 'a normalised in-workspace path is accepted', normalised.body)
  check(String(normalised.body.data?.root ?? '').endsWith('/alpha'), 'the normalised path resolves to the real repository', normalised.body.data?.root)

  const rejected = await route.fetch(new Request('http://127.0.0.1/api/local-git', { method: 'POST', body: 'not json' }))
  check(rejected.status === 400, 'a non-JSON body is refused with 400', rejected.status)
} finally {
  console.log('\ncleanup')
  if (process.env.DSH_GIT_KEEP === '1') {
    console.log(`kept: ${root}`)
  } else {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    rmSync(GIT_CONFIG, { force: true })
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exitCode = 1
