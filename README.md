# GitPanel

**DSH Web 客户端的 Git 管理插件** —— 在左侧面板栏打开一个全页三栏 Git 工具(分支 / 历史 / 提交详情),右侧边栏的 Git 胶囊只负责把面板打开。类似 IntelliJ 的 Git 工具窗口,以 DSH 插件 bundle 形式挂载。

## 1. 这是什么、跑在哪、怎么用

### 是什么

| 项 | 值 |
|---|---|
| 包名 / 版本 | `GitPanel` / `0.2.0`(private,仓库根即包根) |
| 挂载方式 | DSH 插件 bundle(`dsh.manifestVersion: 1`,client 平台 `web`) |
| 运行要求 | DSH ≥ `0.1.7-rc.1`;使用 Web 客户端的 profile;Host 机器的 `PATH` 里有 `git` |
| 依赖 | 无运行时依赖、无构建步骤:Host 半一个文件 + 浏览器半若干分片,交付什么运行什么 |

### 安装

1. 装进 profile —— `dsh plugin` 把参数原样转给 pnpm:

   ```sh
   dsh plugin --profile <name> add github:relaxyabc/dsh-GitPanel    # 从 GitHub(公开仓库,默认分支 main)
   ```

   GitHub 形式装的是**拷贝**,升级用 `dsh plugin --profile <name> update GitPanel` 重新解析(要固定版本就写 `github:relaxyabc/dsh-GitPanel#v0.2.0` 或 `#<commit>`);本地路径形式装的是**指向仓库的链接**,改完代码重启即生效,适合边改边用。

2. 在 profile 的 `cordis.patch.yml`(或以 `--patch` 叠加层)里插入下面的块 —— 包内 `cordis.patch.yml` 即此内容:

   ```yaml
   - insert:
       - id: GitPanel
         name: 'GitPanel'
   ```

3. **重启 profile**(启用 `dsh-hmr` 时自动重载)。

### 使用

- **左侧面板栏**的 Git 图标 → 全页三栏面板:左(分支 + 改动 + 提交框)、中(历史)、右(上:提交信息,下:该提交的文件改动)。
- **右侧边栏**的 guide 胶囊里也有 Git:点击即打开全页面板**并关掉那张标签页**(布局按会话持久化,留下的标签页会跨刷新复活)。若控制器拒绝关闭,标签页里只显示一张不读仓库数据的兜底卡片。
- **顶栏**常显工作区目录与仓库字段(下拉可切换,悬停见完整路径),当前分支以芯片展示并带 ahead/behind 计数;面板打开时自动选中当前会话所在的工作区,切换会话后面板跟随。
- 提交信息框里 `Ctrl/Cmd+Enter` 直接提交。危险操作(hard reset、删除分支)有确认对话框;成功提示 4 秒后自动消失。

### 配置

配置在**插件页面「已安装」分组里的 `GitPanel`** 上(本包自己的配置位,不占官方分组),分「仓库发现」「差异显示」「文件预览」三组;输入后按「保存」写入 profile,三个字段都即时生效、无需重启。

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `discoveryDepth` | number(1–8) | `3` | 仓库发现向下递归的目录层数;运行时始终夹取在该区间内 |
| `wholeFileDiff` | boolean | `false` | 开启后 diff 左右两栏显示整个文件而不只是改动片段 |
| `filePreviewFix` | boolean | `true` | 修复 Chromium 上「文件资源服务不可用」的文件预览,见下 |

`filePreviewFix` 补偿的是 DSH 上游的一个缺陷([discussion #6437](https://github.com/deepseek-ai/deepseek-harness/discussions/6437)):`dsh-client-resources` 用 `new URL(address).hostname` 取协议键,而 Chromium 不把非特殊 scheme 的 authority 当作主机(`new URL('dsh-resource://file/x').hostname` 在 Node 上是 `file`、在 Chromium 上是 `''`),于是每个资源地址都解析不出提供方,右侧边栏的文件预览只剩那句报错。本插件的修复**只改 `dsh-resource://` 这一类地址**(其余地址、相对地址解析、非法地址抛错全部交回浏览器),代价是这类地址**不是 `instanceof URL`**、就地改写部件不回写整条地址(面板只读不改)。上游修好后可以关闭本项。

## 2. 功能清单

**仓库与工作区**
- 递归发现工作区下的全部仓库与子模块工作树(含位于父仓库树之外的子模块),自动跳过 `node_modules`、`.git`、`dist`、`vendor` 等目录。
- 多工作区浏览;打开面板自动选中当前会话所在的工作区,顶栏下拉显示与左侧列表一致的名称与完整路径。
- 深度可配置,切换仓库不重新扫描。

**分支**
- 本地 / 远程分组、可折叠、可按名称过滤;当前分支带 `HEAD` 标记,显示上游与最新提交说明。
- 右键或双击:切换分支、从远程分支建本地分支、删除分支(默认安全删除)、从任意提交新建分支。

**提交历史与 diff**
- 每页最多 200 条(作者、相对时间、ref 装饰);每提交的文件统计在**选中该提交时**才单独读取,历史列表始终是一次轻量调用。
- 选中提交后右栏显示完整信息(哈希、作者、日期、父提交、正文;可改写最新提交的信息)与该提交的文件列表。
- 双击文件弹出**左右双栏 diff**(两侧行号、替换行同排对照;二进制与无差异分别提示);未跟踪文件也能给出内容 diff。
- diff 弹窗自带两条**改动导航**:左侧改动列表(逐条 + 上一处/下一处),右侧概览条(按位置比例高亮、显示可见范围、点击跳转);开启 `wholeFileDiff` 后两栏改为整文件对照。
- 提交右键菜单:复制哈希、Amend(仅最新提交)、Checkout、Cherry-pick、从该提交建分支、Reset(soft/mixed/hard)、Revert。

**工作区改动与提交**
- 基于 `git status --porcelain=v2 -z` 的改动列表:状态字母 + 每文件 +/− 行数,二进制标注。
- 复选框只表示**选中**(纯本地、不触发 Host 调用):表头全选(部分选中显示半选态)+「暂存选中 / 取消暂存选中」按钮;右键仍可单文件 stage/unstage、看 diff、复制路径。
- **Commit** / **Commit all**(先暂存全部)/ **Commit & push** 三个按钮,`Ctrl/Cmd+Enter` 快捷提交;提交信息框的高度随窗口自适应(约 `clamp(150px, 26vh, 380px)`,即 8–16 行),也可拖拽下边缘自行调整。
- 提交框顶部是占满整行的 **Amend** 开关;勾选即进入改写模式:信息框自动填入最新提交的信息,该行高亮,按钮变为 **Amend** / **Amend all**,`git commit --amend` 会把已暂存(或全部)内容并入最新提交、并替换其信息;取消勾选会把改写前的草稿还给信息框。改写期间 **Commit & push** 被禁用 —— 改写后的提交需要强制推送才能发布,面板不提供。
- 提交右键菜单 / 提交信息右键菜单里的「修改提交信息」弹出的改写对话框,其多行输入框同样自适应高度(`clamp(150px, 26vh, 360px)`),不再是单行小框。这两处既有菜单的文案保持不变 —— 只有提交框里的 amend 控件在中文界面下也用英文 **Amend**。
- **Push**(必要时自动 `--set-upstream`)、**Fetch**(只下载对象与远程跟踪引用)、**Pull**(仅当前分支有上游时可用)。
- 暂存、提交、推送只重载相关数据:暂存不会重新扫描工作区或重读历史,因此不会出现整面板「载入中」。

**子模块**
- 列出全部子模块与状态(initialized / uninitialized / out-of-date / conflicted),一键 init / update / sync(递归)。

**界面与语言**
- 中英双语:面板内全部文案(含 guide 条目、菜单、对话框、提示)经 DSH locale 服务输出,跟随客户端语言设置实时切换;插件卡片上的包名与描述来自 `locale/{en,zh}.json`。
- 全部样式为内联设计令牌(`--dsw-alias-*` + 字面回退值),自动适配明暗主题。

## 3. 架构与目录结构

两半对等,通过一条认证 Fetch 路由通信:

```
┌─ 浏览器半  src/client.js + src/client.*.js ─┐     ┌─ Host 半  index.js ─────────────────┐
│ client.js:注册入口 + 接线 + apply          │ fetch│ ctx.connection.fetch.register        │
│ client.*.js:包内分片(词典 / 样式 /        │ ────▶│ POST /api/local-git                  │
│ 面板 / 三栏 / diff / 设置卡 / 修复)        │      │ (继承 Host/Origin 围栏 + 会话认证)    │
│ React,createElement,无 JSX、无构建         │ ◀────│ resolveInside 路径围栏 → execFile(git)│
│ inject: slots/sidebarRightTabs/layout       │      └──────────────────────────────────────┘
└─────────────────────────────────────────────┘ JSON
```

Host 半在仓库根(`index.js`),浏览器半在 `src/`(相当于上游包的 `lib/`)。两半的定位互不相干:Host 半由 `exports["."]` 决定,浏览器入口由 `exports["./client"]` 决定 —— 只有**分片**必须与浏览器入口同级。

### 通信与操作

```jsonc
// 一个请求一个操作;错误一律 200 + ok:false,400 只用于非 JSON 请求体,413 只用于超过 1 MiB
POST /api/local-git
{ "op": "state", "args": { "workspaceRoot": "E:/ws", "path": "alpha" } }
→ { "ok": true,  "data": { … } }
→ { "ok": false, "error": "the path is outside the workspace root" }
```

| op | 类型 | 作用 |
|---|---|---|
| `repos` | 读 | 发现工作区下的全部仓库(含子模块),并回报生效的扫描深度 |
| `state` | 读 | 当前分支、本地/远程分支、ahead/behind、子模块、全部改动文件 |
| `log` | 读 | 提交历史(可按分支 / 文件过滤,1–200 条;不含每提交文件统计) |
| `commitFiles` | 读 | 某一个提交改动的文件与行数 |
| `diff` | 读 | 单文件 unified diff(可指定 `commit`、`wholeFile`;未跟踪文件也能给出) |
| `stage` / `unstage` | 写 | 暂存 / 取消暂存指定路径或全部 |
| `commit` | 写 | 创建提交(`--all` / `--amend`) |
| `push` / `fetch` / `pull` | 写 | 推送 / 只下载对象与远程跟踪引用 / 把上游整合进工作区 |
| `checkout` | 写 | 切换分支、检出提交,可顺带新建分支 |
| `deleteBranch` | 写 | 删除本地分支(默认安全删除) |
| `reset` / `cherryPick` / `revert` | 写 | soft/mixed/hard 重置 / 摘取提交 / 用新提交还原 |
| `amend` | 写 | 改写最新提交的信息 |
| `submodule` | 写 | 子模块 init / update / sync |

参数与语义以 `index.js` 的 `READ_OPERATIONS` / `WRITE_OPERATIONS` 为准(两者合起来就是上表)。

### 安全与限额

- **路径围栏**:所有带 `path` 的操作都经 `resolveInside` 解析(Windows 下大小写折叠),越界一律拒绝。
- **认证路由**:经 `ctx.connection.fetch.register` 注册,继承 API 桥的 Host/Origin 围栏与会话认证,不是裸 webserver 路由。
- **无 shell**:`git` 一律 `execFile` + argv 数组,路径前保留 `--`。
- **限额**:请求体 ≤ 1 MiB;单次 `git` 60 s 超时、32 MiB 输出上限;发现扫描 ≤ 8 层 / 64 个仓库 / 20 000 个目录项;diff 弹窗最多渲染 3000 行两栏对照(超出给出截断提示)。
- **不做昂贵的投机调用**:`git submodule status`(无子模块的仓库上约 1 s)只在仓库声明了子模块时才执行;每提交的文件统计改为选中时才读。
- **不挂起**:`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`,失败以数据形式返回。

### 浏览器半为什么分片

浏览器半没有打包器:DSH 把它当普通脚本加载,`client.js` 自己调 `window.__ModuleLoader__.load({ id, factory })` 注册工厂 —— `import` 不被允许,DSH 的 `require` 也只认平台种子与清单里 `inject` 的包。官方给零构建包留的通道是**包内分片**:与浏览器入口同级、名字匹配 `client.<名字>.js`,自己注册成 `{ id: 'GitPanel', chunk: 'client.panel.js', factory }`,再由入口 `await require.async('./client.panel.js')` 取回。

- 因此 `apply` 是 `async` 的,且必须在注册任何席位之前把分片取回来。
- 分片之间不互相依赖,依赖全部由 `client.js` 的 `shared` 接线表单向接出去。
- **只改分片时要硬刷新**:分片 URL 只带包级版本(DSH 按浏览器入口的 mtime/ctime/size 算),只改分片不会换 URL,浏览器会拿住那份 `immutable` 缓存。改入口文件本身则会换掉全部版本。

### 目录结构

```
dsh-GitPanel/                             # 插件包 GitPanel(仓库根即包根)
├─ package.json                          # 清单:导出映射 / client.inject / files 白名单
├─ cordis.patch.yml                      # Host 半的插入补丁
├─ index.js                              # Host 半:发现 / git 子进程 / 解析器 / 路由 / 配置图
├─ icon.svg                              # 面板图标
├─ src/                                  # 浏览器半(分片必须与 client.js 同级)
│  ├─ client.js                          #   入口:词汇表 / shared 接线 / Host 传输 / apply
│  ├─ client.panel.js                    #   整页面板:状态、Host 调用、工具栏、三栏组装
│  ├─ client.branches.js                 #   左栏:分支、远程、子模块、工作树与提交框
│  ├─ client.history.js                  #   中栏(历史)与右栏(提交信息与文件)
│  ├─ client.rows.js                     #   变更 / 分支 / 提交行,右键菜单,对话框
│  ├─ client.diff.js                     #   unified diff 解析、改动导航、并排视图与弹层
│  ├─ client.settings.js                 #   插件页面上的配置卡片
│  ├─ client.preview-fix.js              #   资源地址修复及其地址读取
│  ├─ client.sidebar.js                  #   右侧边栏的门与标题
│  ├─ client.i18n.js                     #   中英词典
│  └─ client.style.js                    #   设计令牌样式表与 Git 图标路径
├─ locale/{en,zh}.json                   # 插件卡片(插件列表与清单)的包名与描述
├─ test/                                 # 四个无框架 Node 测试 + 分片契约替身
└─ README.md / LICENSE / AGENTS.md
```

### 开发与测试

无需安装依赖,Node(≥ 18)与 `git` 即可;四个测试互相独立,全部通过时退出码 0:

```sh
node test/host.e2e.mjs      # Host 半端到端:临时工作区 + 真实 git + 裸仓库远程,覆盖全部操作与安全拒绝
node test/client.smoke.mjs  # 浏览器半冒烟:真实 ModuleLoader 契约 + React 替身 + 假 fetch,驱动面板全部状态
node test/preview-fix.mjs   # 文件预览修复:Node 契约 + 真实无头 Chromium 复现(无浏览器时该半 skip)
node test/preview.mjs       # 视觉稿:输出 preview/git-panel.html(明暗双主题共 6 幅)
```

浏览器半在每次页面加载时重新取用,Host 半只在 DSH 进程启动时导入一次:长跑的 `dsh web` 上刷新页面只更新面板 UI,Host 侧的新操作要重启进程(或让 `dsh-hmr` 监听本包目录)才生效;面板会识别出旧 Host 并显示橙色横幅。改动前请读 [AGENTS.md](AGENTS.md)(架构不变量、代码风格、测试要求与红线)。

## License

[MIT](LICENSE) © 2026 relaxyabc
