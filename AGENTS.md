# AGENTS.md —— GitPanel 开发规范

本文面向在本仓库工作的人类开发者与 AI 编码代理。动手前先读完:这里记录的不是通用风格偏好,而是本仓库**刻意做出的架构选择**。与这些约定相悖的改动需要在 PR 中明确说明理由,否则会被要求返工。

---

## 1. 这个仓库是什么

`GitPanel` 是一个 **DSH 插件 bundle**:给 DeepSeek Harness 的 Web 客户端添加一个 Git 管理工具(全页三栏面板;右侧边栏的 guide 只把它当门打开,不留标签页)。关键事实:

- **零运行时依赖、零构建步骤**:全部代码就是 `index.js` + `client.js` 两个文件,交付什么运行什么。
- **一对"半"组成**:Host 半(Node,文件系统与 `git` 子进程)和浏览器半(React UI),通过唯一路由 `POST /api/local-git` 通信。
- 清单为 `dsh.manifestVersion: 1`,要求 DSH ≥ `0.1.7-rc.1`,client 平台 `web`。

## 2. 目录结构

```
dsh-git-panel/         # 仓库根即包根(包名 GitPanel)
├─ package.json        # 清单:dsh.manifestVersion / client.inject / exports / files 白名单
├─ cordis.patch.yml    # Host 半的插入补丁(服务 id: GitPanel)
├─ index.js            # Host 半:发现、git 子进程、解析器、路由 —— 唯一允许碰文件系统与进程的文件
├─ client.js           # 浏览器半:面板 UI(右侧边栏只当门)、插件页面配置表单、菜单、对话框、内联样式
├─ icon.svg            # 面板图标
├─ README.md / LICENSE / AGENTS.md
├─ locale/{en,zh}.json # 仅 meta 标题与描述
└─ test/
   ├─ host.e2e.mjs     # Host 半端到端(真实 git、临时工作区)
   ├─ client.smoke.mjs # 浏览器半渲染冒烟(React 替身)
   └─ preview.mjs      # 双主题视觉稿生成器 → preview/git-panel.html
```

## 3. 架构不变量(违反即 bug)

1. **职责边界**。`index.js` 独占一切文件系统与子进程交互;`client.js` 只做 UI 与 `fetch`。`node:fs` / `node:child_process` 永远不许出现在 `client.js`;DOM / React 永远不许出现在 `index.js`。
2. **路由与认证**。Host 半只注册一条路由 `POST /api/local-git`,必须经 `ctx.connection.fetch.register`,从而继承 API 桥的 Host/Origin 围栏与浏览器会话认证。**禁止**把它改挂成裸 `webServer` 路由。
3. **路径围栏**。任何携带仓库路径参数的操作,该路径必须经 `resolveInside(workspaceRoot, path)` 解析,越界一律拒绝。Windows 的大小写折叠是围栏的一部分,不许移除。新增顶层路径类参数同样要过围栏。
4. **无 shell**。一切 `git` 调用走 `runGit`(`execFile` + argv 数组);用户可控的值只能作为独立 argv 元素传入,需要时保留 `--` 分隔符。禁止字符串拼接命令、禁止开启 shell。
5. **错误即数据**。`runGit` 从不 reject —— git 用退出码表达"正常答案"(如路径未跟踪);要求成功时才用 `gitOrThrow`。`dispatch` 对一切失败返回 `{ ok: false, error }` 信封;HTTP 400 只用于非 JSON 请求体,413 只用于超过 `MAX_BODY_BYTES`,其余错误一律 200 + `ok:false`。
6. **解析器与 git 输出一一对应**。`parsePorcelainV2`(`status --porcelain=v2 --branch -z`)、`parseNumstat`(`diff --numstat -z`)、`parseLog`(RS/US 记录分隔符,记录内不再按行解析)、`parseBranches`、`parseSubmodules` 都紧贴 git 的输出格式。改 git 参数就必须同步改解析器,并补 e2e 用例。
7. **限额护栏**。`MAX_BODY_BYTES`、`GIT_TIMEOUT_MS`、`GIT_MAX_BUFFER`、`MAX_DISCOVERY_DEPTH`、`MAX_REPOSITORIES`、`MAX_DISCOVERY_ENTRIES`、`SKIPPED_DIRECTORIES` 是防失控的护栏。上调上限需要谨慎并在 PR 里说明动机;它们的存在理由优先于便利性。发现深度是插件配置 `discoveryDepth`(默认 3,运行时夹取到 1–`MAX_DISCOVERY_DEPTH`),`MAX_DISCOVERY_DEPTH` 始终是硬上限。该字段声明为 `volatile`,Loader 因此把实时引用交给插件、就地提交编辑而不重新 apply:Host 必须**每次调用时**解开这个引用读值(`effectiveDepth()`),不许在 apply 时缓存成数字;编辑入口是插件页面里**本包自己的配置位**(客户端 `configForms` + 共享设置表单,注册进 `plugins.bundle.config` 并以包名作 key),不新增自定义写操作,也不占用"官方"分组的 `plugins.item` 位置。
8. **不做昂贵的投机调用**。`git submodule status` 在没有任何子模块的仓库上也要整树扫描(实测约 1 s),只有声明了子模块的仓库(存在 `submodule.*.path` 配置或索引中的 mode-160000 gitlink)才允许执行它;请求页面时不得读取尚未被选中的提交的文件统计(历史读操作 `log` 不带 `--numstat`,单提交文件由 `commitFiles` 承担)。新增 `git` 调用前先量一次它的固定开销。
9. **浏览器半保持零构建**。`client.js` 必须始终是可直接 `new Function(...)` 求值的纯脚本:经 `window.__ModuleLoader__.load({ id, factory(require) })` 注册,React 经 `require('react')` 获取。禁止 `import` 语句、JSX、TypeScript、任何打包器指令。
10. **环境安全**。git 子进程环境保持 `GIT_TERMINAL_PROMPT=0` 与 `GIT_OPTIONAL_LOCKS=0`;不许添加会引入交互提示或仓库锁的设置。
11. **配置声明零依赖**。插件 `Config` 是手写的 schemastery 兼容图(`Symbol.for('schemastery')` 标记 + `~standard.validate` + `{uid, refs}` 协议的 `toJSON`),不导入 schemastery 包;形状必须与 schemastery 的线协议保持一致,Host 才能把配置投影为原生设置表单。
12. **右侧边栏只当门**。Git 的工具是全页面板,右侧边栏的标签页**不许留下记录**:正文一旦挂载就用自己的 `info.tab.actions.close()` 关掉自己(不要用 `ctx.sidebarRight.close(tabId)` —— 那是面向已发布席位绑定的命令,正文首次 effect 跑在绑定发布之前)。并且**每个导航只许开一次面板**:按 tabId 记住已处理过的 `navigation.revision`,只有 revision 增大、且正文可见时才 `selectPanel`;记录仅被恢复(revision 0)、或因切会话 / 展开列 / 面板重挂载而重新挂载时,**只关自己、绝不抢主区域**(各会话各存布局,抢一次就把用户刚点开的会话顶掉)。关闭被拒时只许渲染一张**不读 Host 数据**的兜底卡片。

## 4. 代码风格(与现状保持一致)

- **语言与格式**:ESM(`"type": "module"`);2 空格缩进;单引号;有分号;行宽以现状为准(约 100–120)。
- **JSDoc 全覆盖**:每个函数(包括测试里的辅助函数)写 JSDoc —— `@param`、`@returns`,抛错的函数加 `@throws`。注释解释**为什么**,不复述代码做什么。
- **常量**:模块级语义常量放顶部,`UPPER_SNAKE_CASE`,各带一行 `/** ... */` 说明。
- **布尔表达可读性**:条件写成 `args.staged === true`、`file.staged !== true` 这类完整比较。
- **Host 半分层**:`parseXxx` 是纯函数、不碰 IO;`readXxx` / `writeXxx` 做 IO、不解析;对外操作名就是 `READ_OPERATIONS` / `WRITE_OPERATIONS` 的键,签名统一为 `(args) => Promise<object>`。
- **浏览器半**:`const h = React.createElement`,一律用 `h()` 不用 JSX;组件是纯函数;上下文菜单数据驱动(`items` 数组)。
- **UI 文案与国际化**:面向用户的字符串全部收在 `client.js` 顶部的 `en` / `zh` 双语词典里(命名空间 `gitPanel`,经 `ctx.locale.register` 注册、`ctx.locale.bind` 绑定),渲染代码一律通过 `t('key')` 取词,不许散落字面量;带参数的文案用 `{name}` 占位符 + `fill()` 填充;槽位组件经注册项 `locale: LOCALE_NS` 接收框架注入的 `t` prop,guide 条目等框架外读取用 apply 作用域绑定的 `t`。新增文案时 en/zh 两词典必须成对补齐;`locale/*.json` 只承载 `meta` 标题/描述,改动 meta 时 en/zh 同步。
- **样式**:全部内联在 `STYLES` 数组;类名前缀 `git-panel-`;只用 `--dsw-alias-*` 设计令牌,且**每个令牌必须带字面回退值**。禁止硬编码颜色/字体替代令牌。
- **语言约定**:代码、注释、标识符、UI 文案用英文;README 与本文件用中文。

## 5. 如何新增一个操作(标准流程)

以"加一个 `stash` 操作"为例,完整流程如下,顺序固定:

1. **Host 半**(`index.js`):实现 `writeStash(repositoryPath, args)`,注册进 `WRITE_OPERATIONS`,写全 JSDoc。需要新 git 参数时同步更新对应解析器。
2. **浏览器半**(`client.js`):在 `en` / `zh` 词典各加一个键(成对);通过 `mutate('stash', args, t('notice.xxx'))` 接入(读操作用 `callHost`);需要交互时用 `setDialog`(确认/单输入)或 `setMenu`(右键菜单)。
3. **Host e2e**(`test/host.e2e.mjs`):至少一条成功用例 + 一条拒绝用例(路径越界 / 缺参 / 非法参数值)。
4. **冒烟**(`test/client.smoke.mjs`):新 UI 有可断言的渲染状态时,补一条 `check()`。
5. **文档**:README 的操作表加一行;涉及安装面或清单的改动同步第 7 节。
6. **验证**:三个测试全部跑一遍(见第 6 节),全绿才算完成。

## 6. 测试规范

三个无框架 Node 脚本就是全部质量门槛,**禁止引入测试框架或新增任何依赖**:

```sh
node test/host.e2e.mjs      # 必跑
node test/client.smoke.mjs  # 必跑
node test/preview.mjs       # 改样式/布局后必跑,肉眼检查明暗两版
```

- **通用**:断言一律走 `check(condition, label, detail)` 风格;测试自报进度(`ok` / `FAIL`),失败置 `process.exitCode = 1`;必须可离线运行,不许访问网络。
- **host.e2e.mjs**:用 `mkdtempSync` 建一次性工作区,`GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` 指向隔离配置(绝不读操作者身份),`finally` 里清理(除非 `DSH_GIT_KEEP=1`)。每个安全约束都要有对抗用例:路径越界、未知 `op`、缺失 `workspaceRoot`、非 JSON 请求体(400)。文件协议 submodule 等依赖 `protocol.file.allow=always` 的设置只写在测试环境里。
- **client.smoke.mjs**:必须通过真实的 `window.__ModuleLoader__` 契约加载 `client.js`;React 替身维护每位置 hook 表,`useMemo`/`useCallback` 的依赖比较语义不许削弱;用 `settle()`/`drain()` 等 effect 与定时器落定后再断言。
- **preview.mjs**:是视觉回归的产物生成器,不设断言;它输出的 `preview/git-panel.html` 不进版本库。

## 7. 清单与文档同步

- **`files` 白名单**:`package.json` 的 `files` 决定随包交付的文件;新增源文件、locale、资源必须登记,否则不会发布。
- **`client.inject`**:仅在确需新的官方 client 服务时追加;`engines.dsh` 只随真正用到的宿主能力上调,不许预防性抬升。
- **exports 映射**:新增对外入口必须同时登记 `exports` 与 `files`。
- **README**:操作表(`op` 一览)、架构图、限额数字与代码保持一致;行为变更必须同步,文档漂移按 bug 处理。
- **locale**:`meta.title` / `meta.description` 改动时 `en.json` 与 `zh.json` 成对更新。

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
