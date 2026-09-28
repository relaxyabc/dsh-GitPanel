# dsh-git

**DSH Web 客户端的 Git 管理插件** —— 在右侧边栏与主面板中浏览工作区、分支、改动与提交历史,并直接完成提交、推送、分支与历史操作。类似 IntelliJ 的 Git 工具窗口,以 DSH 插件 bundle 的形式挂载。

- 包名:`sidebar-git`(v0.2.0,private)
- 运行平台:Web 客户端;要求 DSH ≥ `0.1.7-rc.1`,Host 机器装有 `git`
- 零运行时依赖、零构建步骤:两个源文件直接交付

---

## 功能特性

### 仓库与工作区
- **多仓库发现**:递归扫描工作区根(深度可配置,默认 3 层、上限 8;最多 64 个仓库、20 000 个目录项),自动跳过 `node_modules`、`.git`、`dist`、`vendor` 等目录;嵌套的独立仓库与子模块工作树(包括位于父仓库树之外的子模块)都会被发现并标记。
- **多工作区切换**:所有已打开工作区均可浏览;打开面板时自动选中**当前会话**所在的工作区(按会话的主视图保留关系识别,会话目录的优先级高于工作区列表顺序),工具栏下拉可随时切换。
- **扫描深度可配置**:递归层数(1–8)是插件配置项,在**插件页面「已安装」分组里打开 `sidebar-git`** 即为该配置(见[插件配置](#插件配置));切换仓库不会重新扫描工作区。

### 分支
- 本地 / 远程分支分组展示,可折叠、可按名称过滤;当前分支带 `HEAD` 标记。
- 显示每个分支的上游与最新提交说明;顶栏显示 ahead/behind 计数(`↑2 ↓1`)。
- 双击或右键菜单:切换分支、从远程分支建本地分支、删除分支(默认安全删除)、从任意提交新建分支。

### 提交历史
- 每页最多 200 条,含作者、相对时间与 ref 装饰(tag / HEAD);页面本身不携带每提交的文件统计,该提交的改动文件在**选中它时**才单独读取,所以历史列表始终是一次轻量调用。
- 点击提交查看完整详情:右栏上方为提交信息(哈希、作者、日期、父提交、正文;右键可修改提交信息,仅限最新提交),下方为该提交的文件改动列表(读取中显示载入提示)。
- **双击文件**在居中的弹窗中查看该文件的 diff,以**左右双栏**呈现(左「修改前」/ 右「修改后」,两侧带行号,替换行同排对照;二进制文件与无差异分别给出提示);弹窗一次只显示一个文件,切换选择时内容同步更新,Esc / 点击遮罩 / × 关闭。
- 右键菜单:复制哈希、**Amend**(仅限最新提交)、Checkout、Cherry-pick、从该提交建分支、**Reset(soft/mixed/hard)**、**Revert**;危险操作(hard reset、删除分支)有确认对话框。

### 工作区改动
- 基于 `git status --porcelain=v2 -z` 的完整改动列表:状态字母(M/A/D/R/U/?)+ 每文件 +/− 行数,二进制文件标注。
- 复选框逐文件或一键暂存 / 取消暂存;右键菜单提供单文件 stage/unstage、查看 diff、复制路径。
- **双击改动文件**在居中的弹窗中查看左右双栏 diff(未跟踪文件也能给出内容 diff);弹窗一次只显示一个文件,切换选择时内容同步更新,Esc / 点击遮罩 / × 关闭。

### 提交与推送
- 提交信息输入框,`Ctrl/Cmd+Enter` 快捷提交;三个按钮:**Commit**(提交已暂存)、**Commit all**(先暂存全部)、**Commit & push**。
- 一键 Push(取第一个 remote,必要时自动 `--set-upstream`);结果横幅反馈(成功 4 秒自动消失)。

### 子模块
- 列出全部子模块及状态(initialized / uninitialized / out-of-date / conflicted)。
- 一键 `submodule init` / `update` / `sync`(递归)。

### 界面形态
- **主面板**:左侧面板栏的 Git 图标进入,全页三栏布局 —— 左(分支 + 改动 + 提交框)、中(历史)、右(上:提交信息,下:该提交的文件改动)。
- **右侧边栏只当门,不留页**:右侧边栏 guide 里的 Git 胶囊、以及从上一会话恢复出来的 Git 标签页,一旦挂载就**用标签页自己的 `close()` 关掉** —— 因为布局按会话持久化,留下的标签页会跨刷新复活。并且**一次导航只开一次面板**:只被恢复、或因切会话 / 展开列而重新挂载的记录只关自己、绝不抢主区域(否则会把用户刚点开的会话顶掉)。若控制器拒绝关闭,标签页里只显示一张不读任何仓库数据的兜底卡片(标题、说明与「打开 Git 面板」按钮),不会停在一份过期的摘要上。
- **顶栏**:工作区目录与仓库字段常显(带小标签、悬停显示完整路径),当前分支以芯片展示,刷新 / 推送按钮右置;打开面板自动选中当前会话的工作区,切换会话后面板跟随;载入期间显示进度文案。
- **中英双语**:全部界面文案(含右侧边栏 guide 条目的标题与描述、菜单、对话框、操作提示)经 DSH locale 服务(`sidebarGit` 命名空间)输出,跟随客户端语言设置实时切换。
- 全部样式为内联的**设计令牌样式**(`--dsw-alias-*` 变量 + 回退值),自动适配明暗两套主题;主按钮与 `HEAD` 标签使用主色淡化配色,深色模式下文字同样清晰;类名统一 `dsh-git-` 前缀。

### 插件配置
<a id="插件配置"></a>
| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `discoveryDepth` | number(1–8) | `3` | 仓库发现向下递归的目录层数 |

配置项挂在**插件页面「已安装」分组中的 `sidebar-git`** 上:打开该包即看到「最大递归深度」表单(与官方插件把自己的配置放在自己页面上的做法一致,占用的是 bundle 自己的配置位 `plugins.bundle.config`,而不是"官方"分组里的卡片)。表单用 DSH 共享的设置表单渲染,输入后按「保存」才提交给 Host,文档只读时表单会说明。该字段声明为 `volatile`,因此 Host 侧**即时生效、无需重启**:插件按调用读取实时配置值,保存后下一次扫描就用新的深度。

配置声明是零依赖手写的 schemastery 兼容图(`~standard.validate` + `{uid, refs}` 的 `toJSON`),Host 与设置表单都把它当作原生 schemastery 图投影;越界值在配置期即被拒绝,运行时读到的值始终夹取到 1–8。

---

## 架构

插件是一个 DSH bundle,由两个对等的"半"组成,通过一条认证 Fetch 路由通信:

```
┌─ 浏览器半  client.js ──────────────────┐         ┌─ Host 半  index.js ──────────────────┐
│ window.__ModuleLoader__.load 注册      │  fetch  │ ctx.connection.fetch.register        │
│ 主面板 + 右侧边栏 launcher(React,     │ ──────▶ │ POST /api/local-git                  │
│ createElement,无 JSX、无构建)          │         │ (继承 Host/Origin 围栏 + 会话认证)    │
│ inject: slots/sidebarRightTabs/layout  │ ◀────── │ resolveInside 路径围栏 → execFile(git)│
└────────────────────────────────────────┘  JSON   └──────────────────────────────────────┘
```

| 文件 | 职责 |
|---|---|
| `index.js` | Host 半:仓库发现、`git` 子进程调用与全部解析器;注册唯一路由 `POST /api/local-git`;注入 `webServer`、`connection` |
| `client.js` | 浏览器半:Git 面板与 launcher UI,以及本包在插件页面上的配置入口(`plugins.bundle.config`);注入 `slots`、`sidebarRightTabs`、`layout`、`configForms`;仅通过 `/api/local-git` 与 Host 交互 |
| `cordis.patch.yml` | bundle 补丁层:把 Host 半以服务 id `sidebar-git` 插入组合 |
| `package.json` | `dsh.manifestVersion: 1`;client 平台 `web`,依赖 `@deepseek-ai/dsh-client-ui-sidebar-right`、`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-primitives`;导出映射与 `files` 白名单 |
| `locale/*.json` | `meta` 标题与描述的中英文案 |
| `test/*` | 三个无框架 Node 测试(见[开发](#开发)) |

### 通信协议

浏览器半对每个操作发一个 JSON 信封,Host 半返回统一结果信封:

```
POST /api/local-git
{ "op": "state", "args": { "workspaceRoot": "E:/ws", "path": "alpha" } }

→ 200 { "ok": true,  "data": { ... } }
→ 200 { "ok": false, "error": "the path is outside the workspace root" }
→ 400 非 JSON 请求体;  413 请求体超过 1 MiB
```

### 操作一览

**读操作**(只读仓库状态):

| `op` | 说明 | 关键参数 |
|---|---|---|
| `repos` | 发现工作区根下的全部仓库(含子模块);同时回报生效的扫描深度 | `workspaceRoot` |
| `state` | 当前分支、本地/远程分支、ahead/behind、子模块、全部改动文件 | `workspaceRoot`、`path` |
| `log` | 提交历史(不含每提交文件统计,见 `commitFiles`),可按分支/文件过滤 | `limit`(1–200,默认 30)、`branch`、`file` |
| `commitFiles` | 某一提交改动的文件与行数(`--no-renames`,以第一父提交为基准) | `commit` |
| `diff` | 单文件 unified diff:指定 `commit` 时给出该提交对该文件的改动,否则给出索引 / 工作区改动(未跟踪文件也能给出) | `file`、`staged`、`commit` |

**写操作**(变更仓库状态):

| `op` | 说明 | 关键参数 |
|---|---|---|
| `stage` / `unstage` | 暂存 / 取消暂存指定路径或全部 | `paths` |
| `commit` | 创建提交(可选 `--all` / `--amend`) | `message`、`paths`、`all`、`amend` |
| `push` | 推送当前或指定分支 | `remote`、`branch`、`setUpstream` |
| `checkout` | 切换分支 / 检出提交,可新建分支 | `name`、`create`、`startPoint` |
| `deleteBranch` | 删除本地分支(默认安全删除) | `name`、`force` |
| `reset` | soft / mixed / hard 重置到指定提交 | `commit`、`mode` |
| `cherryPick` | 摘取提交到当前分支 | `commit`、`record`、`noCommit` |
| `revert` | 用一个新提交还原指定提交 | `commit`、`noCommit` |
| `amend` | 改写最新提交的信息 | `message` |
| `submodule` | 子模块 init / update / sync | `action` |

---

## 安全模型

- **路径围栏**:每个携带 `path` 的操作都经 `resolveInside` 解析,解析结果必须落在 `workspaceRoot` 之内(Windows 下做大小写折叠),越界一律拒绝 —— 插件永远只操作会话已拥有的目录。
- **认证路由**:路由经 `ctx.connection.fetch.register` 注册,继承 API 桥的 Host/Origin 围栏与浏览器会话认证,不是裸 webserver 路由;未授权会话收到 401/403。
- **无 shell**:一切 `git` 调用走 `execFile` + argv 数组,调用方提供的任何值都不会被 shell 解析;路径参数前保留 `--` 分隔符。
- **限额护栏**:请求体 ≤ 1 MiB;单次 `git` 调用 60 s 超时、32 MiB 输出上限;发现扫描有深度 / 数量 / 目录项上限;差异弹窗最多渲染 3000 行两栏对照(超出时给出截断提示)。
- **不做昂贵的投机调用**:`git submodule status` 在无子模块的仓库上也要整树扫描(实测约 1 s),因此只有声明了子模块的仓库才会执行它 —— 判定方式是 `.gitmodules` 中存在 `submodule.*.path` 条目,或索引里有 gitlink(mode 160000)条目;两者都没有的仓库不可能报告子模块。每提交的文件统计同理,改为选中该提交时才读取。
- **不挂起**:`GIT_TERMINAL_PROMPT=0` 禁止交互式凭据提示,`GIT_OPTIONAL_LOCKS=0` 减少锁竞争;失败以数据形式返回,不阻塞面板。

---

## 安装与使用

### 前提

- DSH ≥ `0.1.7-rc.1`,使用 Web 客户端的 profile
- Host 机器的 `PATH` 中有 `git`

### 挂载到 profile

1. 把包安装进 profile 的依赖(`dsh plugin` 命令透传 pnpm 参数,或手动在 profile 的 `package.json` 记录依赖后安装),路径即本仓库根目录:

   ```sh
   dsh plugin --profile <name> add E:\owner\dsh-git
   ```

2. 在 profile 的 `cordis.patch.yml`(或以 `--patch` 叠加层)中加入插入块 —— 包内 `cordis.patch.yml` 即此内容:

   ```yaml
   - insert:
       - id: sidebar-git
         name: 'sidebar-git'
   ```

3. 重启 profile(启用 `dsh-hmr` 时自动重载)。

### 使用

打开 Web 客户端后:

- 左侧**面板栏**出现 Git 图标,进入全页三栏 Git 面板;
- **右侧边栏**的 guide 胶囊里也有 Git:点击即**打开全页面板并关掉那张标签页**,所以回到会话后右侧边栏不会残留 Git 标签页;
- 顶栏常显**工作区目录**与**仓库**字段(下拉可切换),当前分支以芯片展示;面板打开时自动选中当前会话所在的工作区。
- 插件页面「已安装」分组里的 **`sidebar-git`** 打开即见 **「最大递归深度」** 配置;输入后按保存写入 profile 配置,即时生效。

---

## 开发

无需安装任何依赖,Node(建议 ≥ 18,测试依赖内置 `fetch`/`Request`)与 `git` 即可。三个测试互相独立,全部通过退出码 0 报告:

```sh
node test/host.e2e.mjs      # Host 半端到端:临时工作区 + 真实 git 子进程 + 裸仓库远程,覆盖全部操作与安全拒绝
node test/client.smoke.mjs  # 浏览器半冒烟:真实 ModuleLoader 契约 + React 替身 + 假 fetch,驱动面板全部状态
node test/preview.mjs       # 视觉稿:在临时仓库上渲染真实组件,输出 preview/git-panel.html(明暗双主题 × 面板 / 差异弹窗两景)
```

调试用环境变量:

| 变量 | 作用 |
|---|---|
| `DSH_GIT_KEEP=1` | 保留 e2e 的临时工作区与隔离 git 配置,便于排查 |
| `DSH_SMOKE_TRACE=1` / `DSH_SMOKE_DEBUG=1` | 冒烟测试的追踪与文本转储 |
| `DSH_PREVIEW_DEBUG=1` | 打印 preview 的 Host 调用日志 |

修改样式后运行 `node test/preview.mjs`,打开 `preview/git-panel.html` 检查明暗两版效果。

### 两半的加载时机不同

浏览器半在**每次页面加载时重新取用** `client.js`,Host 半则只在 **DSH 进程启动时导入一次**。因此在长跑的 `dsh web` 进程上,刷新页面只会更新面板 UI:主机侧的新操作(`commitFiles`、`discoveryDepth`)仍不可用,直接调用会得到 `unknown operation`,而提交文件的差异会退化成"工作区 diff"因此为空。

面板会自己识别这种状态:当工作区读取没有回报 `discoveryDepth`(当前契约的一部分),或某个新操作被拒为 `unknown operation` 时,顶栏下方会出现一条橙色横幅说明 Host 半是旧版本,并给出可执行的修复方式;此时提交文件列表会退回使用旧版历史页里的文件统计,空差异也不会被读成"该提交没有改动"。

让改动生效有两种方式:

- **重启 DSH 进程**(始终有效);
- 或在 profile 的 `cordis.patch.yml` 里让 HMR 监听本包目录,Host 半随后在文件变化时热重载:

  ```yaml
  - id: hmr
    name: "@deepseek-ai/dsh-hmr"
    disabled: false
    config:
      root:
        - E:/owner/dsh-git      # 指向本仓库;删掉该条目即回到 root: []
  ```

---

## 目录结构

```
dsh-git/                                 # 插件包 sidebar-git(仓库根即包根)
├─ package.json                          # bundle 清单(manifestVersion 1、导出映射、files 白名单)
├─ cordis.patch.yml                      # Host 半的插入补丁
├─ index.js                              # Host 半:发现 / git 子进程 / 解析器 / 路由
├─ client.js                             # 浏览器半:面板 UI、菜单、对话框、样式
├─ icon.svg                              # 面板图标
├─ README.md / LICENSE / AGENTS.md
├─ locale/
│  ├─ en.json                            # meta 文案(英)
│  └─ zh.json                            # meta 文案(中)
└─ test/
   ├─ host.e2e.mjs                       # Host 端到端测试
   ├─ client.smoke.mjs                   # 浏览器半渲染冒烟测试
   └─ preview.mjs                        # 双主题视觉稿生成器
```

## 参与开发

提交代码前请阅读 [AGENTS.md](AGENTS.md) —— 它定义了本仓库的架构不变量、代码风格、测试要求与红线清单。修改行为时同步更新本 README 的操作表。

## License

[MIT](LICENSE) © 2026 relaxyabc
