# AGENTS.md —— GitPanel 开发规范

本文面向在本仓库工作的人类开发者与 AI 编码代理。动手前先读完:这里记录的不是通用风格偏好,而是本仓库**刻意做出的架构选择**。与这些约定相悖的改动需要在 PR 中明确说明理由,否则会被要求返工。

---

## 1. 这个仓库是什么

`GitPanel` 是一个 **DSH 插件 bundle**:给 DeepSeek Harness 的 Web 客户端添加一个 Git 管理工具(全页三栏面板;右侧边栏的 guide 只把它当门打开,不留标签页)。关键事实:

- **零运行时依赖、零构建步骤**:交付什么运行什么。Host 半是根目录的 `index.js` 一个文件;浏览器半在 `src/`(相当于上游包的 `lib/`),是 `src/client.js` 入口加若干**包内分片** `src/client.*.js`(见第 3 节第 9 条)。两者都不是打包产物。
- **一对"半"组成**:Host 半(Node,文件系统与 `git` 子进程)和浏览器半(React UI),通过唯一路由 `POST /api/local-git` 通信。
- 清单为 `dsh.manifestVersion: 1`,要求 DSH ≥ `0.1.7-rc.1`,client 平台 `web`。

## 2. 目录结构

```
dsh-GitPanel/           # 仓库根即包根(包名 GitPanel)
├─ package.json        # 清单:dsh.manifestVersion / client.inject / exports / files 白名单(含 src/client.*.js)
├─ cordis.patch.yml    # Host 半的插入补丁(服务 id: GitPanel)
├─ index.js            # Host 半:发现、git 子进程、解析器、路由 —— 唯一允许碰文件系统与进程的文件
├─ icon.svg            # 面板图标
├─ src/                # 浏览器半(相当于上游包的 lib/);目录名本身不是约定,改名要同步 exports["."]、exports["./client"] 与 files
│  ├─ client.js        # 浏览器半入口:模块词汇表、shared 接线表、Host 传输与文本助手、apply
│  └─ client.*.js      # 浏览器半的包内分片(见第 3 节第 9 条),必须与入口同级:
│                      #   i18n(词典)/ style(样式表)/ rows(行与菜单)/ diff(diff 引擎与弹层)
│                      #   branches(左栏)/ history(中栏与右栏)/ panel(整页面板)
│                      #   settings(配置卡片)/ preview-fix(资源地址修复)/ sidebar(右侧边栏门)
├─ README.md / LICENSE / AGENTS.md
├─ locale/{en,zh}.json # 仅插件卡片的 meta 标题与描述(Host 侧读取)
└─ test/
   ├─ module-loader.mjs # 包内分片契约的测试替身(浏览器侧测试共用)
   ├─ host.e2e.mjs     # Host 半端到端(真实 git、临时工作区)
   ├─ client.smoke.mjs # 浏览器半渲染冒烟(React 替身)
   ├─ preview-fix.mjs  # 资源地址修复(Node 契约 + 真实无头 Chromium 复现)
   └─ preview.mjs      # 双主题视觉稿生成器 → preview/git-panel.html
```

## 3. 架构不变量(违反即 bug)

1. **职责边界**。`index.js` 独占一切文件系统与子进程交互;`client.js` 只做 UI 与 `fetch`。`node:fs` / `node:child_process` 永远不许出现在 `client.js`;DOM / React 永远不许出现在 `index.js`。
2. **路由与认证**。Host 半只注册一条路由 `POST /api/local-git`,必须经 `ctx.connection.fetch.register`,从而继承 API 桥的 Host/Origin 围栏与浏览器会话认证。**禁止**把它改挂成裸 `webServer` 路由。
3. **路径围栏**。任何携带仓库路径参数的操作,该路径必须经 `resolveInside(workspaceRoot, path)` 解析,越界一律拒绝。Windows 的大小写折叠是围栏的一部分,不许移除。新增顶层路径类参数同样要过围栏。
4. **无 shell**。一切 `git` 调用走 `runGit`(`execFile` + argv 数组);用户可控的值只能作为独立 argv 元素传入,需要时保留 `--` 分隔符。禁止字符串拼接命令、禁止开启 shell。
5. **错误即数据**。`runGit` 从不 reject —— git 用退出码表达"正常答案"(如路径未跟踪);要求成功时才用 `gitOrThrow`。`dispatch` 对一切失败返回 `{ ok: false, error }` 信封;HTTP 400 只用于非 JSON 请求体,413 只用于超过 `MAX_BODY_BYTES`,其余错误一律 200 + `ok:false`。
6. **解析器与 git 输出一一对应**。`parsePorcelainV2`(`status --porcelain=v2 --branch -z`)、`parseNumstat`(`diff --numstat -z`)、`parseLog`(RS/US 记录分隔符,记录内不再按行解析)、`parseBranches`、`parseSubmodules` 都紧贴 git 的输出格式。改 git 参数就必须同步改解析器,并补 e2e 用例。
7. **限额护栏**。`MAX_BODY_BYTES`、`GIT_TIMEOUT_MS`、`GIT_MAX_BUFFER`、`MAX_DISCOVERY_DEPTH`、`MAX_REPOSITORIES`、`MAX_DISCOVERY_ENTRIES`、`SKIPPED_DIRECTORIES` 是防失控的护栏。上调上限需要谨慎并在 PR 里说明动机;它们的存在理由优先于便利性。发现深度是插件配置 `discoveryDepth`(默认 3,运行时夹取到 1–`MAX_DISCOVERY_DEPTH`),`MAX_DISCOVERY_DEPTH` 始终是硬上限。该字段声明为 `volatile`,Loader 因此把实时引用交给插件、就地提交编辑而不重新 apply:Host 必须**每次调用时**解开这个引用读值(`effectiveDepth()`),不许在 apply 时缓存成数字;编辑入口是插件页面里**本包自己的配置位**(客户端 `configForms` + 共享设置表单,注册进 `plugins.bundle.config` 并以包名作 key),不新增自定义写操作,也不占用"官方"分组的 `plugins.item` 位置。`wholeFileDiff` 与深度同性质:也声明为 `volatile`,也必须按调用解引用(`effectiveWholeFileDiff()`),不许在 apply 时求值缓存。卡片本身按内置设置页的写法绘制:分组用 `section` + `h3` 标题,控件一律用共享 primitives(数值 `SettingsValueField`、开关 `Switch`、覆盖徽标 `Tag`),字段说明放标签旁的 ⓘ(`SettingsValueField` 的 `help`;开关行没有对应 primitive,自绘的按钮与披露区必须逐条对齐 primitives 的 `.helpButton` / `.help` 数值),不许自绘下拉框或常驻提示行。`filePreviewFix`(默认 `true`)与它们同性质,但读值的是**浏览器半**:客户端资源模型用 `new URL(address).hostname` 命名协议提供方,而 Chromium 对非特殊 scheme 不解析 authority(`new URL('dsh-resource://file/x').hostname` 得到 `''`),于是每个资源地址都没有提供方、右侧边栏的文件预览只剩「文件资源服务不可用」。浏览器半因此把 `URL` 换成**只对 `dsh-resource://` 地址**生效的包装(其余地址,含 base 解析与非法地址的抛错,一律交回原生实现),并通过 `configForms` 订阅本命名空间:未知状态按默认(开)处理、明确的 `false` 立即卸下并还原原生 `URL`、插件 dispose 也还原。这条修复是上游缺陷的补偿而非替代,禁止把它扩大成"接管所有 URL 解析";包装的既有代价(资源地址不是 `instanceof URL`、就地改写部件不回写地址)必须保留在注释与 README 里。
8. **不做昂贵的投机调用**。`git submodule status` 在没有任何子模块的仓库上也要整树扫描(实测约 1 s),只有声明了子模块的仓库(存在 `submodule.*.path` 配置或索引中的 mode-160000 gitlink)才允许执行它;请求页面时不得读取尚未被选中的提交的文件统计(历史读操作 `log` 不带 `--numstat`,单提交文件由 `commitFiles` 承担)。新增 `git` 调用前先量一次它的固定开销。
9. **浏览器半保持零构建**。`client.js` 必须始终是可直接 `new Function(...)` 求值的纯脚本:经 `window.__ModuleLoader__.load({ id, factory(require) })` 注册,React 经 `require('react')` 获取。禁止 `import` 语句、JSX、TypeScript、任何打包器指令。多文件的唯一通道是**包内分片**:文件与**客户端入口**(`exports["./client"]` 指向的那个文件,现在是 `src/client.js`)同级、名字匹配 `client.<名字>.js`,自己 `window.__ModuleLoader__.load({ id: 'GitPanel', chunk: '<文件名>', factory })` 注册,入口用 `await require.async('./<文件名>')` 取回(documentpreview 的 Excel 表格就是这么加载的)。分片只认客户端入口的**目录**,与 Host 半放哪里无关 —— Host 半由 `exports["."]` 单独定位,把它挪去别处只改那一行。由此产生四条硬约束:(a) `apply` 是 `async`,且必须在注册任何席位之前把分片全部取回;(b) 分片之间不许互相依赖,依赖只能由 `client.js` 的 `shared` 表**单向**接出去,分片在 `create(shared)` 的解构行里声明自己要什么,读了没接线的名字就是 `ReferenceError`;(c) 分片必须登记进 `package.json` 的 `files`(`src/client.*.js`);(d) 三个浏览器侧测试都经 `test/module-loader.mjs` 按真实契约加载,**不许**退化成直接把 `client.js` 读成字符串求值 —— 那样分片不会被请求,只能在测试里跑通的 bundle 会悄悄通过;(e) 分片的 URL 只带**包级 rev**(DSH 按客户端入口的 mtime/ctime/size 算),所以只改分片时 URL 不变、浏览器会拿住那份 `immutable` 缓存:调试与验收要么硬刷新(Ctrl+Shift+R),要么顺手动一下入口文件,要么重启 DSH。
10. **环境安全**。git 子进程环境保持 `GIT_TERMINAL_PROMPT=0` 与 `GIT_OPTIONAL_LOCKS=0`;不许添加会引入交互提示或仓库锁的设置。
11. **配置声明零依赖**。插件 `Config` 是手写的 schemastery 兼容图(`Symbol.for('schemastery')` 标记 + `~standard.validate` + `{uid, refs}` 协议的 `toJSON`),不导入 schemastery 包;形状必须与 schemastery 的线协议保持一致,Host 才能把配置投影为原生设置表单。
12. **右侧边栏只当门**。Git 的工具是全页面板,右侧边栏的标签页**不许留下记录**:正文一旦挂载就用自己的 `info.tab.actions.close()` 关掉自己(不要用 `ctx.sidebarRight.close(tabId)` —— 那是面向已发布席位绑定的命令,正文首次 effect 跑在绑定发布之前)。并且**每个导航只许开一次面板**:按 tabId 记住已处理过的 `navigation.revision`,只有 revision 增大、且正文可见时才 `selectPanel`;记录仅被恢复(revision 0)、或因切会话 / 展开列 / 面板重挂载而重新挂载时,**只关自己、绝不抢主区域**(各会话各存布局,抢一次就把用户刚点开的会话顶掉)。关闭被拒时只许渲染一张**不读 Host 数据**的兜底卡片。

## 4. 代码风格(与现状保持一致)

- **语言与格式**:ESM(`"type": "module"`);2 空格缩进;单引号;有分号;行宽以现状为准(约 100–120)。
- **JSDoc 全覆盖**:每个函数(包括测试里的辅助函数)写 JSDoc —— `@param`、`@returns`,抛错的函数加 `@throws`。注释解释**为什么**,不复述代码做什么。
- **常量**:模块级语义常量放顶部,`UPPER_SNAKE_CASE`,各带一行 `/** ... */` 说明。
- **布尔表达可读性**:条件写成 `args.staged === true`、`file.staged !== true` 这类完整比较。
- **Host 半分层**:`parseXxx` 是纯函数、不碰 IO;`readXxx` / `writeXxx` 做 IO、不解析;对外操作名就是 `READ_OPERATIONS` / `WRITE_OPERATIONS` 的键,签名统一为 `(args) => Promise<object>`。
- **浏览器半**:`const h = React.createElement`,一律用 `h()` 不用 JSX;组件是纯函数;上下文菜单数据驱动(`items` 数组)。组件按功能落在分片里:整页面板与它的状态在 `client.panel.js`,左栏在 `client.branches.js`,中栏与右栏在 `client.history.js`,行/菜单/对话框在 `client.rows.js`,diff 在 `client.diff.js`,配置卡片在 `client.settings.js`,右侧边栏门在 `client.sidebar.js`;分片只接 `shared` 上的东西,状态一律留在面板里、子组件只收 props。
- **UI 文案与国际化**:面向用户的字符串全部收在 `client.i18n.js` 分片的 `en` / `zh` 双语词典里(入口在 apply 里取回,经 `ctx.locale.register` 注册、`ctx.locale.bind` 绑定),渲染代码一律通过 `t('key')` 取词,不许散落字面量;带参数的文案用 `{name}` 占位符 + `fill()` 填充;槽位组件经注册项 `locale: LOCALE_NS` 接收框架注入的 `t` prop,guide 条目等框架外读取用 apply 作用域绑定的 `t`,分片组件把它当默认值(`boundTranslate`)使用。新增文案时 en/zh 两词典必须成对补齐。**两处文案服务两个不同的消费者,不是重复实现国际化**:`locale/*.json` 由 **Host** 在插件被加载/激活**之前**读取(`dsh-app-boot` 的 `readPluginMeta` → `PluginPackages.metaOf`),只有插件列表与清单里的「包名 / 描述」两个字段,**且只认 `meta.title` / `meta.description`** —— `dictionariesOf` 不读任何其它键,别的文案写进去等于没写;此时浏览器半根本没运行,它交不出这两个字段。`client.i18n.js` 的 `en` / `zh` 是**渲染期**词典,经 `ctx.locale.register(ns, { en, zh })` 交给 locale 服务,而该服务只接受 `register` 传入的词典、**没有任何读文件的路径**,面板文案必须走这条路才能随语言设置实时切换。
- **样式**:全部内联在 `client.style.js` 分片的 `STYLES` 数组;类名前缀 `git-panel-`;只用 `--dsw-alias-*` 设计令牌,且**每个令牌必须带字面回退值**。禁止硬编码颜色/字体替代令牌。`<style>` 由渲染树里的 `StyleTag` 挂载,**每个会渲染 `git-panel-*` 类名的挂载点都必须渲染它**(目前是主面板、右侧边栏兜底卡、插件页配置卡片);漏掉一处不会报错,只会让该处的规则静默失效、退回页面默认排版 —— 配置卡片就踩过一次。
- **语言约定**:代码、注释、标识符、UI 文案用英文;README 与本文件用中文。

## 5. 如何新增一个操作(标准流程)

以"加一个 `stash` 操作"为例,完整流程如下,顺序固定:

1. **Host 半**(根目录的 `index.js`):实现 `writeStash(repositoryPath, args)`,注册进 `WRITE_OPERATIONS`,写全 JSDoc。需要新 git 参数时同步更新对应解析器。
2. **浏览器半**:按功能落进对应分片 —— 文案进 `client.i18n.js`,行/菜单进 `client.rows.js`,面板逻辑进 `client.panel.js`,栏位进 `client.branches.js` / `client.history.js`;需要新东西时先在 `client.js` 的 `shared` 表里接出去,再在分片的解构行里声明。操作通过 `mutate('stash', args, t('notice.xxx'))` 接入(读操作用 `callHost`);需要交互时用 `setDialog`(确认/单输入)或 `setMenu`(右键菜单)。
3. **Host e2e**(`test/host.e2e.mjs`):至少一条成功用例 + 一条拒绝用例(路径越界 / 缺参 / 非法参数值)。
4. **冒烟**(`test/client.smoke.mjs`):新 UI 有可断言的渲染状态时,补一条 `check()`。
5. **文档**:README 的操作表加一行;涉及安装面或清单的改动同步第 7 节。
6. **验证**:四个测试全部跑一遍(见第 6 节),全绿才算完成。

## 6. 测试规范

四个无框架 Node 脚本就是全部质量门槛,**禁止引入测试框架或新增任何依赖**:

```sh
node test/host.e2e.mjs      # 必跑
node test/client.smoke.mjs  # 必跑
node test/preview-fix.mjs   # 改动资源地址修复时必跑
node test/preview.mjs       # 改样式/布局后必跑,肉眼检查明暗两版
```

- **通用**:断言一律走 `check(condition, label, detail)` 风格;测试自报进度(`ok` / `FAIL`),失败置 `process.exitCode = 1`;必须可离线运行,不许访问网络。
- **host.e2e.mjs**:用 `mkdtempSync` 建一次性工作区,`GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` 指向隔离配置(绝不读操作者身份),`finally` 里清理(除非 `DSH_GIT_KEEP=1`)。每个安全约束都要有对抗用例:路径越界、未知 `op`、缺失 `workspaceRoot`、非 JSON 请求体(400)。文件协议 submodule 等依赖 `protocol.file.allow=always` 的设置只写在测试环境里。清单部分同时守住文案的唯一来源:插件卡片文案只在 `locale/*.json`(`package.json` 里出现 `meta` 即失败)、两个 locale 只含 `meta` 且声明同一组字段、locale 文件在 `files` 与 `exports` 里可见。
- **client.smoke.mjs**:必须通过真实的 `window.__ModuleLoader__` 契约加载 `client.js`(经 `test/module-loader.mjs`,它会要求入口请求每一个分片);React 替身维护每位置 hook 表,`useMemo`/`useCallback` 的依赖比较语义不许削弱;用 `settle()`/`drain()` 等 effect 与定时器落定后再断言。替身中的 primitives 必须照官方契约实现(`SettingsValueField` 的 `help` 默认收起、点击展开;`Switch` 以 `aria-checked` 表达状态;`Tag` 只渲染文字),不许简化成恒真或永远展开。另注意该替身的 hook 表按"父元素 + 组件类型"缓存,**深层嵌套组件的 `useState` 不会跨渲染保留**,需要保留的折叠状态用测试作用域的集合模拟(见 `openedHelp`)。新增或改动挂载点时,断言注入的 CSS 里含该挂载点用到的规则。另有一条**分片图**断言:目录里每个 `client.*.js` 都必须被入口请求并注册 —— 没被请求的分片是死代码,漏登记的分片会让面板某个席位空白。
- **preview.mjs**:是视觉回归的产物生成器,不设断言;它输出的 `preview/git-panel.html` 不进版本库。
- **preview-fix.mjs**:资源地址修复的回归测试。第一半在 Node 里跑真实 `client.js`,校验地址解析契约与包装器的行为(资源地址的主机、普通地址照旧交给原生 URL、被拒绝的地址仍抛错、开关与 dispose 的装卸);第二半把同一段修复放进**真实无头 Chromium** 跑一遍 —— 那个缺陷只在 Chromium 的解析器上出现,只有它能证明"修复前无效、修复后有效"。找不到浏览器时第二半 `skip`(不是失败),第一半始终运行;不得把它改写成只依赖 Node 解析器的测试,那样的测试对缺陷本身恒真。

## 7. 清单与文档同步

- **`files` 白名单**:`package.json` 的 `files` 决定随包交付的文件;新增源文件、locale、资源必须登记,否则不会发布。浏览器半的分片由 `src/client.*.js` 一次性覆盖 —— 新增分片时确认它在该 glob 里,但**不要**把配置/测试文件塞进来。
- **`client.inject`**:仅在确需新的官方 client 服务时追加;`engines.dsh` 只随真正用到的宿主能力上调,不许预防性抬升。
- **exports 映射**:新增对外入口必须同时登记 `exports` 与 `files`。
- **README**:操作表(`op` 一览)、架构图、限额数字与代码保持一致;行为变更必须同步,文档漂移按 bug 处理。
- **locale**:`locale/*.json` 是插件卡片(插件列表与清单)显示文案的**唯一来源**,只许出现 `meta` 下的 `title` / `description`,改动时 `en.json` 与 `zh.json` 成对更新。**禁止在 `package.json` 里再写 `meta`**:`readPluginMeta` 只回退到 `name` / `description`,该字段无人读取,写上去只会与 locale 文案漂移(上游 bundle 也一律不写)。

## 8. 红线(禁止事项)

- 禁止让任何仓库路径绕过 `resolveInside`。
- 禁止给用户输入任何被 shell 解释的机会(argv 数组是唯一通道)。
- 禁止把路由注册到 `connection.fetch` 之外(尤其禁止裸 webserver 公网路由)。
- 禁止在 `client.js` 引入 Node API,或在 `index.js` 引入 DOM/React。
- 禁止新增 npm 运行时依赖、devDependency 或构建/转译步骤。
- 禁止移除或绕过第 3 节第 7 条的任何限额护栏。
- 禁止使用无回退值的裸颜色/字体字面量替代设计令牌。
- 禁止让仓库发现无上限递归或跟随符号链接。

## 9. 提交信息与 PR 约定

- 格式:`type(scope): subject`,全部小写、祈使语气、不带句号。
  - `type`:`feat` | `fix` | `test` | `docs` | `refactor` | `chore`
  - `scope`:`host` | `client` | `test` | `manifest` | `docs`(跨半改动用 `host+client`)
  - 例:`feat(host): add stash operation`、`fix(client): keep branch filter across refresh`
- 一个 PR 只做一件事;行为变更必须附带对应测试与 README 更新。
- PR 描述里写清:动机、行为变化、测试证据(粘贴关键 `ok` 行)。
