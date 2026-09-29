# AGENTS.md —— GitPanel 开发规范

`GitPanel` 是给 DSH Web 客户端加 Git 管理工具的**插件 bundle**:Host 半 `index.js`(独占文件系统与 `git` 子进程)与浏览器半 `src/client.js` + 包内分片(React UI)通过唯一路由 `POST /api/local-git` 通信。**零依赖、零构建**:禁止引入依赖、构建 / 转译步骤或测试框架(目录树见 README)。

README 面向使用者,**本文件面向改代码的人**:下面是本仓库刻意做出的架构选择,相悖的改动要在 PR 里说明理由。

## 1. 常用命令

只需 Node ≥ 18 与 `git`;四个测试互相独立、不访问网络,全绿时退出码 0。

| 命令 | 用途 |
| --- | --- |
| `node test/host.e2e.mjs` | **必跑**。Host 半端到端:临时工作区 + 真实 git + 裸远程仓库,含全部操作与安全拒绝 |
| `node test/client.smoke.mjs` | **必跑**。浏览器半冒烟:真实 `__ModuleLoader__` 契约 + React 替身 + 假 fetch |
| `node test/preview-fix.mjs` | 改 `filePreviewFix` 时必跑:Node 契约 + 真实无头 Chromium 复现 |
| `node test/preview.mjs` | 改样式 / 布局后必跑:生成 `preview/git-panel.html`(明暗双主题),肉眼检查 |
| `dsh plugin --profile <name> update GitPanel` | 重新解析已装的拷贝(按目录链接开发时不需要) |
| 刷新页面 / 重启 `dsh web` | 让改动生效:浏览器半刷新即取新代码,Host 半只在进程启动时导入一次 |

收尾固定为:按需跑完前四条 → 全绿 → 按第 7 节提交。

## 2. 硬约束(违反即 bug)

1. **职责边界**:`index.js` 独占文件系统与子进程,浏览器半只做 UI 与 `fetch`。`node:fs` / `node:child_process` 不许进浏览器半,DOM / React 不许进 `index.js`。
2. **路由与认证**:只注册一条 `POST /api/local-git`,必须经 `ctx.connection.fetch.register`(继承 Host/Origin 围栏与会话认证);禁止改挂成裸 `webServer` 路由。
3. **路径围栏**:带仓库路径的操作一律经 `resolveInside(workspaceRoot, path)`,越界拒绝;Windows 的大小写折叠是围栏的一部分,新增顶层路径参数同样要过。
4. **无 shell**:`git` 一律走 `runGit`(`execFile` + argv 数组);用户可控值只作独立 argv 元素,必要处保留 `--`;禁止拼接命令、禁止开 shell。
5. **错误即数据**:`runGit` 从不 reject(git 用退出码表达正常答案),`gitOrThrow` 只在要求成功时用;失败一律 200 + `{ ok: false, error }`,400 只给非 JSON 请求体,413 只给超过 `MAX_BODY_BYTES`。
6. **解析器与 git 输出一一对应**:改 git 参数必须同步改 `parseXxx` 并补 e2e 用例;`parseLog` 用 RS / US 记录分隔,记录内不再按行解析。
7. **限额与配置护栏**。`MAX_BODY_BYTES`、`GIT_TIMEOUT_MS`、`GIT_MAX_BUFFER`、`MAX_DISCOVERY_DEPTH`、`MAX_REPOSITORIES`、`MAX_DISCOVERY_ENTRIES`、`SKIPPED_DIRECTORIES` 是护栏,上调要在 PR 说明动机;发现不许无上限递归或跟随符号链接。三个配置字段都是 `volatile`,必须**每次调用解引用**,不许在 apply 时缓存:
   - `discoveryDepth`(默认 3,夹取到 1–`MAX_DISCOVERY_DEPTH`,后者始终是硬上限)→ `effectiveDepth()`;`wholeFileDiff` → `effectiveWholeFileDiff()`。
   - 配置位是本包自己的:`configForms` + 共享设置表单注册进 `plugins.bundle.config`(包名作 key),不新增写操作、不占官方分组的 `plugins.item`。
   - 卡片按内置设置页画:`section` + `h3` 分组,只用共享 primitives(数值 `SettingsValueField`、开关 `Switch`、覆盖徽标 `Tag`),说明走 `help`(开关行没有对应 primitive 时,自绘披露区要逐条对齐 `.helpButton` / `.help` 数值);不许自绘下拉框或常驻提示行。
   - `filePreviewFix`(默认 `true`)由浏览器半读:Chromium 不把非特殊 scheme 的 authority 当主机(`new URL('dsh-resource://file/x').hostname` 得 `''`),右侧边栏文件预览因此只剩「文件资源服务不可用」。包装**只对 `dsh-resource://` 地址**生效(其余地址、base 解析、非法地址抛错全交回原生),未知状态按开、明确的 `false` 立即还原、dispose 也还原;禁止扩大成「接管所有 URL 解析」,代价(这类地址不是 `instanceof URL`、就地改写不回写整条地址)要留在注释与 README 里。
8. **不做昂贵的投机调用**:新增 `git` 调用前先量固定开销;`git submodule status` 在无子模块的仓库上也整树扫描(约 1 s),只有声明了子模块的仓库才跑;历史列表不带 `--numstat`,单提交文件由 `commitFiles` 承担。
9. **浏览器半保持零构建**:`client.js` 必须能被 `new Function(...)` 求值,经 `window.__ModuleLoader__.load({ id, factory })` 注册,React 走 `require('react')`;禁止 `import` / JSX / TypeScript / 打包器指令。多文件只能走**包内分片**:与客户端入口(`exports["./client"]`)同级、名 `client.<名>.js`、自注册 `{ id: 'GitPanel', chunk: '<文件名>', factory }`,入口用 `await require.async('./<文件名>')` 取回(与 Host 半放哪里无关)。
   - (a) `apply` 是 `async`,必须在注册任何席位前取回全部分片;(b) 分片之间不许互相依赖,依赖只经 `client.js` 的 `shared` 表**单向**接出,读了没接线的名字就是 `ReferenceError`;(c) 分片要落在 `files` 的 `src/client.*.js` 里;(d) 三个浏览器侧测试都经 `test/module-loader.mjs` 加载,不许退化成把 `client.js` 读成字符串求值;(e) 分片 URL 只带包级 rev(按客户端入口 mtime/ctime/size 算),只改分片要硬刷新、动入口文件或重启 DSH。
10. **环境安全**:git 子进程保持 `GIT_TERMINAL_PROMPT=0` 与 `GIT_OPTIONAL_LOCKS=0`,不加会引发交互提示或仓库锁的设置。
11. **配置声明零依赖**:插件 `Config` 是手写的 schemastery 兼容图(不导入 schemastery),形状必须与线协议一致,Host 才能投影出原生设置表单。
12. **右侧边栏只当门**:正文挂载后用自己的 `info.tab.actions.close()` 关掉自己(不用 `ctx.sidebarRight.close`,它面向已发布席位、正文首次 effect 跑在发布之前);每个导航只开一次面板(按 tabId 记 `navigation.revision`,只在 revision 增大且正文可见时 `selectPanel`;记录被恢复或重挂载时只关自己、绝不抢主区域);关闭被拒时只渲染不读 Host 数据的兜底卡片。

## 3. 代码风格

- **格式**:ESM(`"type": "module"`);2 空格缩进;单引号;有分号;行宽约 100–120。
- **注释与常量**:每个函数(含测试辅助函数)写全 JSDoc(`@param` / `@returns`,抛错加 `@throws`),注释讲**为什么**;常量放顶部、`UPPER_SNAKE_CASE`、各带一行说明。
- **布尔表达**:写 `args.staged === true` 这类完整比较。
- **Host 半**:`parseXxx` 纯函数不碰 IO,`readXxx` / `writeXxx` 只做 IO;操作名就是 `READ_OPERATIONS` / `WRITE_OPERATIONS` 的键,签名统一 `(args) => Promise<object>`。
- **浏览器半**:`const h = React.createElement`,一律 `h()` 不用 JSX;组件是纯函数;菜单数据驱动(`items` 数组);分片只接 `shared` 上的东西,状态留在面板里、子组件只收 props。
- **文案**:用户可见字符串全收在 `client.i18n.js` 的 en / zh 词典,渲染代码一律 `t('key')`,带参数的用 `{name}` + `fill()`,两词典成对补齐;槽位组件用注册项注入的 `t`,框架外读取用 apply 绑定的 `t`(`boundTranslate`)当默认值。两处文案服务两个消费者:`locale/*.json` 由 Host 在插件激活**前**读取,只认 `meta.title` / `meta.description`(其它键没人读);渲染期文案只能经 `ctx.locale.register(ns, { en, zh })`,locale 服务没有任何读文件的路径。
- **样式**:全在 `client.style.js` 的 `STYLES` 数组;类名前缀 `git-panel-`;只用 `--dsw-alias-*` 令牌且**每处带字面回退值**,禁止硬编码颜色 / 字体;每个会渲染 `git-panel-*` 类名的挂载点都要渲染 `StyleTag`(主面板、侧边栏兜底卡、配置卡片),漏一处只会在该处静默失效。
- **语言**:代码、注释、标识符、UI 文案用英文;README 与本文件用中文。

## 4. 标准流程

### 4.1 新增一个操作

顺序固定:① `index.js` 实现 `writeXxx(repositoryPath, args)` 并注册进 `WRITE_OPERATIONS`,改 git 参数就同步解析器 → ② 浏览器半按 4.2 落位,新依赖先在 `client.js` 的 `shared` 表接出去再在分片的解构行声明,写操作走 `mutate('op', args, t('notice.x'))`、读操作走 `callHost`,交互用 `setDialog` / `setMenu` → ③ `host.e2e.mjs` 补一条成功 + 一条拒绝用例(越界 / 缺参 / 非法值)→ ④ 有可断言状态就给 `client.smoke.mjs` 补 `check()` → ⑤ README 操作表加一行 → ⑥ 第 5 节的测试全绿。

### 4.2 改什么、动哪里

| 要改的东西 | 落在哪 |
| --- | --- |
| git 调用、解析器、路由、操作、配置图 | `index.js` |
| 面板状态、Host 调用编排、工具栏、三栏组装 | `src/client.panel.js` |
| 左栏(分支 / 远程 / 子模块 / 提交框) | `src/client.branches.js` |
| 中栏历史、右栏提交详情 | `src/client.history.js` |
| 行、右键菜单、对话框 | `src/client.rows.js` |
| diff 解析、改动导航、并排视图与弹层 | `src/client.diff.js` |
| 插件页配置卡片 | `src/client.settings.js` |
| 右侧边栏的门与标题 | `src/client.sidebar.js` |
| 资源地址修复 | `src/client.preview-fix.js` |
| 文案(en / zh 成对) | `src/client.i18n.js` |
| 样式 | `src/client.style.js` |
| 入口词汇表 / `shared` 接线 / `apply` | `src/client.js` |
| 插件卡片文案(只 `meta.title` / `description`) | `locale/{en,zh}.json` |
| 交付面、`exports`、`client.inject` | `package.json`(见第 6 节) |

## 5. 测试

- **通用**:禁止测试框架或任何新依赖;断言用 `check(condition, label, detail)`,自报 `ok` / `FAIL`,失败置 `process.exitCode = 1`;必须可离线运行。
- **host.e2e.mjs**:`mkdtempSync` 建一次性工作区,`GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` 指向隔离配置(绝不读操作者身份),`finally` 清理(除非 `DSH_GIT_KEEP=1`);每个安全约束都要有对抗用例(路径越界、未知 `op`、缺 `workspaceRoot`、非 JSON 请求体 400);同时守住文案唯一来源:插件卡片文案只在 `locale/*.json`(`package.json` 出现 `meta` 即失败)、两 locale 只含同组字段、都在 `files` 与 `exports` 里。
- **client.smoke.mjs**:必须经 `test/module-loader.mjs` 按真实 `__ModuleLoader__` 契约加载(它会要求入口请求每个分片);React 替身的 hook 表按「父元素 + 组件类型」缓存 —— **深层嵌套组件的 `useState` 不跨渲染保留**,要保留的折叠状态用测试作用域集合模拟(见 `openedHelp`);`useMemo` / `useCallback` 依赖比较不许削弱,primitives 按官方契约(`help` 默认收起、`Switch` 用 `aria-checked`、`Tag` 只渲染文字),用 `settle()` / `drain()` 落定后再断言;新增或改动挂载点要断言 CSS;另有一条**分片图**断言(每个 `client.*.js` 都必须被请求并注册)。
- **preview.mjs**:只生成 `preview/git-panel.html`(不进版本库),不设断言。
- **preview-fix.mjs**:两半都要留 —— Node 契约 + **真实无头 Chromium**(缺陷只在 Chromium 解析器上出现,缺浏览器时第二半 `skip`);不许改成只依赖 Node 解析器的测试。

## 6. 清单、文案与文档同步

- **`files`**:新增源文件、locale、资源必须登记,否则不会发布;分片由 `src/client.*.js` 一次覆盖 —— 新增分片确认在该 glob 里,但别把配置 / 测试文件塞进来。
- **`exports`**:新增对外入口必须同时登记 `exports` 与 `files`。
- **`client.inject` / `engines.dsh`**:只随真正用到的新能力追加,不许预防性抬升。
- **`locale`**:`locale/*.json` 是插件卡片文案的唯一来源,只许 `meta.title` / `description`,en / zh 成对更新;**禁止在 `package.json` 里再写 `meta`**(`readPluginMeta` 只回退到 `name` / `description`,该字段无人读取)。
- **README**:操作表、架构图、限额数字与代码一致;行为变更必须同步,文档漂移按 bug 处理。

## 7. 提交与 PR

- 格式:`type(scope): subject`,全小写、祈使语气、不带句号;`type` 取 `feat` / `fix` / `test` / `docs` / `refactor` / `chore`,`scope` 取 `host` / `client` / `test` / `manifest` / `docs`(跨半用 `host+client`)。例:`feat(host): add stash operation`。
- 一个提交(PR)只做一件事;行为变更必须附带测试与 README 更新;PR 描述写清动机、行为变化与测试证据(粘贴关键 `ok` 行)。

---

拿不准别猜:先跑第 1 节确认基线,再按第 2 节逐条对照改动。
