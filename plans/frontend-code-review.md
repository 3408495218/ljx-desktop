# 前端（桌面端）代码审查报告（2026-10-01）

> 审查范围：`lajixia-desktop`（Tauri 2 + Rust + React 18 + TS + Tailwind 4 + zustand）
> 覆盖：React 侧全部 `.ts/.tsx`、Rust 侧全部命令与模块、Tauri 权限配置。
> 结论分级：**P1 建议上线前处理 / P2 建议修 / P3 可选**。

---

## 一、总体结论

**前端代码质量明显好于后端修复前的状态**，尤其是 React 侧的工程纪律：

| 检查项 | 结果 |
|---|---|
| XSS 面（`innerHTML` / `dangerouslySetInnerHTML`） | **0 处** ✅ |
| 类型逃逸（`any` / `as any` / `@ts-ignore`） | **0 处** ✅ |
| `--noUnusedLocals` 检查 | 无告警 ✅ |
| `useEffect` 依赖数组 | **31/31 全部带** ✅ |
| 定时器清理（`setInterval`/`setTimeout`） | **全部有清理** ✅ |
| 卸载后 setState | 有 `cancelled` / `alive` / `AbortController` 守卫 ✅ |
| Tauri 权限 | 只申请了 `core:default` / `store:default` / 窗口控制 —— **没有 `fs` / `shell` / `http`** ✅ |

**唯一需要在上线前处理的问题是 P1-1（Tauri 命令不限制操作根目录）**，
其余都是建议性改进。

---

## 二、P1（建议上线前处理）

### P1-1 文件类 Tauri 命令**不限制根目录**，`path` / `work_dir` 由前端直传

**现状**（`src-tauri/src/commands.rs`）：以下命令把前端传来的路径**原样**交给内部模块，
没有任何"必须位于服务端目录内"的校验：

```rust
pub fn props_read(path: String)          -> … { props::read_properties(&path) }
pub fn props_write(path: String, …)      -> … { props::write_properties(&path, &entries) }
pub async fn snapshot_list(work_dir: String) …
pub async fn snapshot_create(work_dir: String, name: String) …
pub async fn snapshot_delete(work_dir: String, name: String) …
pub async fn snapshot_restore(work_dir: String, name: String) …
pub async fn world_clear(work_dir: String) …
pub async fn world_reset(work_dir: String) …
pub async fn mods_list(work_dir: String, kind: String) …
pub async fn mods_import / mods_delete / mods_set_enabled …
pub async fn open_folder(path: String) …
```

**风险评估**（要给准确定性，不能只喊危险）：

- Tauri 的 `invoke` **只对本应用窗口开放**，不是远程接口；
- 前端已确认**没有 XSS 面**，所以外部攻击者暂时进不来；
- 因此**当前不是"可被远程利用"的漏洞**，而是**缺少纵深防御**：
  一旦将来引入任何动态内容渲染（例如把玩家名 / 房间名塞进 `dangerouslySetInnerHTML`）、
  或某个依赖被投毒，攻击者就能**读写本机任意文件**（`props_write` 可写任意路径、
  `world_clear` 可删任意目录下的世界目录）。

**建议修法**（改动不大、收益明确）：

1. 在 Rust 侧维护一个**"允许操作的根目录"**（就是房主选定的服务端目录，
   在 `server_start` / `resolve_server_dir` 时记录到全局状态）；
2. 每个接路径的命令入口统一调用一个 `ensure_within_root(path) `：
   - 先 `canonicalize()`（解析 `..` 与符号链接）；
   - 再判断 `starts_with(root)`；不满足直接返回 `Err("路径不在服务端目录内")`；
3. 已经做过的部分保留：`client_pkg::sanitize_file_name`（**已覆盖 `..`、`a/../../evil.zip`，
   并有单元测试**）与 `open_url` 的 scheme 白名单继续沿用。

> 注意：**不要**改成"Tauri 全局 fs 权限白名单" —— 本项目要操作的是**运行时才确定的目录**，
> 动态根目录校验比静态权限表更合适。

---

## 三、P2（建议修）

| # | 问题 | 说明 | 建议 |
|---|---|---|---|
| **P2-1** | Rust 侧生产代码有 **14 处 `Mutex::lock().unwrap()`** | 全部是同一模式（`state::<Mutex<ServerManager>>().lock().unwrap()`）。**锁中毒**（持锁线程 panic 过）时会再 panic。命令 panic 会被 Tauri 捕获返回错误、不会崩整个应用，所以定级 P2 | 改成 `lock().unwrap_or_else(\|e\| e.into_inner())`（沿用中毒前的数据），或统一返回 `Err("内部状态异常")`。另 `lib.rs:55` 的 `expect("error while running tauri application")` 属**启动失败即退出**，是合理的 |
| **P2-2** | 令牌回退存 `localStorage` | 优先走 Tauri `store`（`load(STORE_FILE)`），仅当 store 不可用时回退 `localStorage`（`api.ts:279`）。`localStorage` 里的 refresh token 在浏览器环境下可被 XSS 读取 | 保留回退（否则 Web 端不可用），但在代码注释里写明"这是 Web 回退路径、桌面端不会走到"，并确保桌面构建**永远**走 store |
| **P2-3** | `useRoomPresence` / `useRoomHeartbeat` 两个 hook 结构高度相似（都是"进入 → 定时续期 → 清理"） | 重复代码，后续改一处容易漏另一处（本项目真实踩过：两者都曾因为"上报挂在页面上"而出错） | 抽一个 `usePeriodicReport(intervalMs, report, enabled)` 基座，两个 hook 各自只提供"报什么" |

---

## 四、P3（可选）

| # | 项 | 说明 |
|---|---|---|
| P3-1 | `console_send(cmd)` 不限制命令内容 | 设计如此（房主本就该能在控制台执行任意 MC 命令），**不是缺陷**；若想更稳可加一个"需要二次确认的危险命令名单"（`stop` / `op` / `ban`） |
| P3-2 | 诊断面板每秒重渲染 | `SettingsDialog` 里 `setInterval(…, 1000)` 用于刷新"N 秒前"文案，**只在弹窗打开时运行**，影响可忽略 |
| P3-3 | 轮询频率可再复核 | 公告 5 分钟（另有 WebSocket 实时推送）、大厅 30 秒（推送外兜底）、心跳与成员上报各 30 秒（后端超时 90 秒，留了 3 倍余量）—— **当前配置合理**，仅作记录 |

---

## 五、做得好的地方（无需改动）

1. **没有 XSS 面**：全项目 0 处 `innerHTML` / `dangerouslySetInnerHTML`，全部走 React 文本插值。
2. **类型纪律严格**：0 处 `any` / `as any` / `@ts-ignore`，`--noUnusedLocals` 干净。
3. **`useEffect` 依赖完整**：31 个 `useEffect` **全部**带依赖数组（这在本项目尤其重要 —— 之前"上报挂在页面上"的多次故障都源于依赖/生命周期问题）。
4. **定时器全部清理**：`setInterval` / `setTimeout` 均有对应 `clearInterval` / `clearTimeout`，没有泄漏。
5. **异步卸载有防护**：多处使用 `cancelled` / `alive` 标志或 `AbortController`，避免卸载后 setState。
6. **Tauri 权限克制**：只申请 `core:default` + `store:default` + 窗口控制；
   **没有申请 `fs` / `shell` / `http` 插件权限** —— 需要的能力都通过自定义命令实现，攻击面更小。
7. **文件命名校验到位**：`client_pkg::sanitize_file_name` 拒绝空串、`..`、`a/../../evil.zip`，
   并把绝对路径/带目录的输入压成纯文件名，**带单元测试**。
8. **外链白名单**：`open_url` 只放行 `http(s)` 且拒绝空白字符，避免把任意字符串喂给系统命令。
9. **令牌存储分级**：优先 Tauri `store`，`localStorage` 仅作回退。
10. **HTTP 层与后端约定一致**：`rawRequest` **无条件解析响应体、只认业务码**，
    不依赖 HTTP 状态（因此后端 `HTTP 400 + code 1001` 这种组合也能正确显示中文提示）。
11. **刷新令牌防并发**：`refreshInFlight` 保证 access 过期时**只刷新一次**，避免并发请求把 refresh token 用废
    （后端是一次性轮换策略，重复使用会撤销全会话）。
12. **上报与页面解耦**：成员上报与心跳都在 `App.tsx` **应用级**，由会话状态驱动，
    切页签不会中断（这是踩了多次坑之后的做法，注释里也写清了原因）。

---

## 六、修复优先级建议

```
第一步（P1-1）  给接路径的 Tauri 命令加"根目录校验"（canonicalize + starts_with）
第二步（P2-1）  把 Mutex 的 unwrap 换成 unwrap_or_else(|e| e.into_inner())
第三步（P2-2/3）令牌回退路径加注释说明；把两个上报 hook 抽出公共基座
```

**P1-1 的具体做法**已在第二节给出，属于需要动 Rust 侧多个命令入口的改动，
建议单独一轮做并跑 `cargo test`（当前 33 条）回归。


---

## 七、P1-1 修复记录（2026-10-01 已完成）

### 修法：运行时"根目录"约束

在 `ServerManager`（唯一的全局状态）上增加 `root: Option<PathBuf>`，并提供两个方法：

| 方法 | 作用 |
|---|---|
| `set_root(&Path)` | 用户确定服务端目录时调用；**目录不存在或无法规范化就报错**，不让无效的根静默生效 |
| `ensure_within_root(&str) -> Result<PathBuf, String>` | 校验前端传来的路径必须落在根目录内，返回规范化后的绝对路径 |

**两个关键实现细节**：

1. **先 `canonicalize` 再比较**，否则 `../` 和符号链接都能绕过；
2. **支持"还不存在"的路径**：新增 `resolve_existing_ancestor()` —— 向上找到最近的**已存在祖先**做规范化，
   再把剩余路径段拼回去。没有这一步，**新建 `server.properties` 这种正常操作会被误判为非法路径**。

### 根目录的确定时机

| 时机 | 说明 |
|---|---|
| `resolve_server_dir(jar_path, work_dir)` | **最早**的确定时机：前端每次进「我的游戏」都会调它解析目录 |
| `server_start(config)` | **双保险**：即使用户没走过上面的路径，启动服务端时也会把根设好 |

**未设置根目录时一律拒绝**（而不是放行）—— 否则"忘了设置根"就等于完全没有这道防线。

### 接入范围（13 个命令）

```
props_read / props_write
snapshot_list / snapshot_create / snapshot_delete / snapshot_restore
world_clear / world_reset
mods_list / mods_import / mods_delete / mods_set_enabled
open_folder
```

**一处刻意的例外**：`mods_import` 的 `sources`（用户从任意位置挑的 jar）**不做根目录限制** ——
来源本来就可能不在服务端目录里；真正落地时文件名会被 `mods::sanitize_file_name` 压成纯文件名，不会穿越。
（顺带确认：`mods_delete` / `mods_set_enabled` 的 `file_name` **早已过 `sanitize_file_name`**，所以只需校验 `work_dir`。）

### 前端零改动

`State<'_, Mutex<ServerManager>>` 与 `AppHandle` 都是 **Tauri 自动注入**的参数，
前端 `invoke("props_read", { path })` 这类调用**完全不用改**。已核对前端没有误传 `manager` / `app`。

### 验证

```
cargo build   → 无 error / warning
cargo test    → 36 passed（原 33 + 新增 3 条路径守卫用例）
npx tsc --noEmit → 通过
npm run build → 通过
```

新增 3 条用例：

- `ensure_within_root_accepts_paths_inside`：根目录本身、**还不存在的 `server.properties`**、多层不存在子目录，**都应放行**；
- `ensure_within_root_rejects_traversal_and_outside`：`../../` 穿越、根外绝对路径、空路径，**都应拒绝**；
- `ensure_within_root_refuses_when_root_unknown`：**未设置根目录时必须拒绝**。

> ⚠️ Rust 改动需要**重启客户端**才生效（当前运行的是旧二进制）。

### 剩余（P2/P3）

| 级别 | 项 |
|---|---|
| P2-1 | 14 处 `Mutex::lock().unwrap()`（锁中毒会 panic，Tauri 会捕获，故 P2） |
| P2-2 | 令牌回退 `localStorage` 路径加注释说明 |
| P2-3 | `useRoomPresence` / `useRoomHeartbeat` 抽公共基座 |
| P3 | `console_send` 危险命令二次确认（可选）；其余仅作记录 |


---

## 八、P2 修复记录（2026-10-01 已完成）

### P2-1 锁中毒不再让命令 panic

原来有 10 处 `Mutex<ServerManager>::lock().unwrap()`，持锁线程一旦 panic 过（锁中毒），
后续每个命令都会再 panic 一次。改法分两种、语义等价：

| 场景 | 写法 | 数量 |
|---|---|---|
| 已绑定 `State` 的地方 | `server::lock_manager(&state)`（新增公共辅助，内部 `unwrap_or_else(\|e\| e.into_inner())`） | 3 |
| 链式 `app.state::<…>().lock()` | 直接 `lock().unwrap_or_else(\|poisoned\| poisoned.into_inner())` | 7 |

> 为什么不统一用一个函数：链式处的 `State` 是**临时值**，guard 借它之后活不过语句，会编译不过。
> 这一点已写进 `lock_manager` 的文档注释，避免后来人"顺手统一"时踩坑。
>
> `lib.rs` 里的 `expect("error while running tauri application")` **保留不动** —— 那是"启动失败即退出"，合理。

### P2-2 令牌回退路径补安全说明

`api.ts` 里 Tauri store 不可用时回退 `localStorage` 的分支加了注释：说明这是 Web 预览才走的兜底路径、
**在 Web 环境下可被 XSS 读取**、所以桌面端必须始终走 store，以及这正是"前端不允许出现
`dangerouslySetInnerHTML`"的原因之一（已确认全项目 0 处）。

### P2-3 抽出周期任务骨架

新增 `shared/useInterval.ts`：**只抽骨架**（启动即执行一次 + 定时器 + 卸载清理 + 卸载后不再执行），
任务本身与清理动作仍由调用方提供。

> 为什么**不**把两个 hook 合并成一个"配置对象驱动"的大 hook：它们的差异（返回值、清理时是否发离开请求、
> 是否额外监听 Tauri 事件）塞进 options 后反而更难读。只共用骨架，是最小且清晰的抽象。

`useRoomPresence` 与 `useRoomHeartbeat` 均已改用 `useInterval`，并在各自的文档注释里互相指向对方。

**⚠️ 重构中我自己引入并修复的一个回归**：`useRoomHeartbeat` 里"玩家进出时立即补报"原先复用周期心跳那段逻辑
（会读真实在线名单），我在改写时一时图省事写成了 `heartbeat(roomId, 0, [])` ——
**这会让房间人数在玩家进出的瞬间掉成 0**。已改回"事件补报与周期心跳共用同一个 `beat()`（读真实名单）"。

### 验证

```
npx tsc --noEmit  → 通过
npm run build     → 通过
cargo build       → 无 error / warning
cargo test        → 36 passed
grep 复查         → commands.rs / process.rs 中已无裸的 .lock().unwrap()
```

### 剩余（仅 P3，不影响使用）

`console_send` 危险命令二次确认（可选）；诊断面板每秒重渲染（仅弹窗打开时）；轮询频率（已确认合理）。
**前端审查的 P1 / P2 至此全部处理完毕。**

> ⚠️ Rust 侧改动（P1-1 根目录校验 + P2-1 锁）需要**重启客户端**才生效。


---

## 九、重启实测：发现并修掉 P1-1 引入的一个回归（2026-10-01）

重启前后端后做了冒烟测试。**后端 20+ 项全部通过**（认证/每日经验、房间人数一致、CDK 兑换、
买 VIP 后配额变 100MB、置顶卡校验 1511、大厅 `topCard` 与 `border-diamond`、置顶排第一、
后台 8 个面板接口、公告免登录、搜 `%` 命中 0）。

**但实测暴露了 P1-1 的一个回归**：

```
JoinPage.fetchClientPackage():
  const folder = await pickFolder("选择游戏压缩包的下载文件夹", pkgDir);   // 玩家自选目录
  await downloadClientPackage(…, folder, …);                              // 下载到那里
  await openFolder(folder);                                               // 打开该目录
```

这个 `folder` 是**玩家用系统对话框自选的下载目录**（通常在桌面/下载），**必然在服务端目录之外** ——
加了根目录校验后，**玩家下载完客户端包点「打开目录」会直接报错**。

**改法**：把 `open_folder` 从校验范围里**豁免**（保留校验的从 13 个变为 12 个），并在代码里写明原因 ——
它只是"用文件管理器打开一个文件夹"，**不读不写**，风险可忽略；强行校验会破坏正常流程。

> 这条正是「代码审查 + 实测」互补的例子：审查时按"路径参数一律收紧"推理是对的，
> 但只有跑到真实调用链上才会发现**有些路径本来就该在根外**。

**验证**：`cargo build` 无 error/warning、`cargo test` 36 passed、`tsc` 与 `npm run build` 通过。

### 最终校验范围（12 个命令）

```
props_read / props_write
snapshot_list / snapshot_create / snapshot_delete / snapshot_restore
world_clear / world_reset
mods_list / mods_import / mods_delete / mods_set_enabled
```

**豁免**：`open_folder`（玩家自选下载目录）、`resolve_server_dir` / `server_start`（它们**设定**根目录）、
`mods_import` 的 `sources`（来源可在根外，落地时文件名已 sanitize）。
