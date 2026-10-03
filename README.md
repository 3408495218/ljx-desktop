# 垃圾侠桌面端

我的世界多人联机平台的桌面客户端。既是**开服器**（在本机起 Paper / NeoForge 服务端、管理插件与 Mod、打客户端包），也是**大厅客户端**（浏览房间、加入别人的游戏、与房主同步状态）。

- 语言：界面文案全中文
- 许可：[MIT](LICENSE)

## 依赖的后端

桌面端**不自带后端**，需要一个 `lajixia-server` 实例：

- 仓库：`lajixia-server`（同系列项目，单独开源）
- 默认地址 `127.0.0.1:8080`，可在「设置 → 服务器地址」改（支持 IP / 域名 / 完整 URL，只填 IP 会自动补 `http://` 与端口 8080）
- **未登录也能浏览大厅**（访客模式），创建 / 加入房间时才需要账号
- 接口契约见后端仓库的 `openapi.json` 与 `/swagger-ui.html`

> **版本对应**：本客户端 `0.1.0` 对应 `lajixia-server 0.1.0`。两者通过 HTTP + WebSocket 通信，无编译期依赖，可分别独立构建。

## 技术栈

- Tauri 2 + Rust（进程编排 / 文件操作 / 环境探测 / 客户端包构建）
- React 18 + TypeScript + Tailwind CSS 4
- zustand（状态）+ react-virtuoso（控制台日志虚拟列表）
- STOMP over WebSocket（大厅实时推送）

## 开发

```bash
npm install
npm run tauri dev
```

需要 **Rust 1.98+**、**Node 20+**。前端单独跑（不带 Tauri 外壳）：

```bash
npm run dev        # Vite，默认 http://localhost:5173
```

### 联调后端

后端不在本仓库。启动方式见 `lajixia-server` 的 README：

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=local   # 落盘，重启不丢账号
```

开发期邮箱验证码不发真实邮件，直接打在后端日志里（搜 `[MAIL][dev]`）。

## 构建

```bash
npm run tauri build   # 产出 NSIS 安装包
```

### 指定安装包的默认服务器地址

默认连 `127.0.0.1`（本地开发）。打包自建服务器专用的安装包时用构建期环境变量覆盖，
这样具体地址不必写进源码仓库：

```bash
# Windows (PowerShell)
$env:VITE_DEFAULT_SERVER_ADDRESS="123.108.110.52:49858"; npm run tauri build

# Git Bash / Linux / macOS
VITE_DEFAULT_SERVER_ADDRESS=123.108.110.52:49858 npm run tauri build
```

取值形态与「设置 → 服务器地址」输入框一致（见 `shared/serverConfig.ts`）：

| 写法 | 解析结果 |
|---|---|
| `123.108.110.52` | `http://123.108.110.52:8080`（自动补默认端口） |
| `123.108.110.52:49858` | `http://123.108.110.52:49858` |
| `https://api.example.com` | 原样使用 |

用户装完即可直接连上，也可随时在设置里改。

## 目录结构

```
src/
  App.tsx              应用外壳与三页签（国服大厅 / 创建游戏 / 当前加入）
  features/
    lobby/             房间卡片、三视图、筛选、搜索、分页
    create/            创建说明页 + 七字段表单
    account/           登录注册弹窗
    join/              当前加入、玩家准备状态、客户端包下载与启动游戏
    room-manage/       我的游戏六页签（基本信息 / 控制台 / 服务端设置 / 插件 / Mod / 快照）
    mall/              道具商城弹窗
    settings/          服务器地址等设置
  stores/              account / lobby / console / serverProc / preferences / diagnostics
  shared/              类型、常量、API 封装、WebSocket、日志翻译、Tauri 调用封装
  assets/              图标与商城图（见下）
src-tauri/src/
  server/              服务端进程状态机（idle→starting→running→stopping→failed）
  props.rs             server.properties 注释保留读写
  probe.rs             Java / 端口 / .minecraft 探测
  client_pkg.rs        客户端包下载（临时文件 + 原子改名）
  client_build.rs      mrpack 解析与客户端实例构建
  mods.rs              插件 / Mod 目录扫描
  snapshot.rs          世界快照
  world.rs             存档管理
  commands.rs          Tauri 命令入口
```

## 视觉与资产

UI 对齐原版 2.0.10（Qt4）视觉：深暖棕基底（#4a3f35 / #5c4f44 / #3d342c / #2a221c）+ 珊瑚橙强调（#e8664a）+ 草绿人数标签（#4a9b4a）+ 金色 VIP（#e8c44a）+ 金棕卡片描边（#c4a574），无边框自定义标题栏。

`src/assets/icons/`（28 个）与 `src/assets/shop/`（7 个）中的图标图片**打包在本仓库内**，出处为原版「垃圾侠」客户端拆包，按语义重命名后使用：房子 logo、网格 / 星星 / 脚印三视图、放大镜、刷新、翻页三角、「开 / 关」汉字开关、草方块封面（同时用作应用图标）、VIP 徽章、拼图、齿轮、锁、置顶卡、铁块 / 金块 / 钻石 VIP 徽章与房间边框、「快速注册，现在就玩」横幅、「加入 QQ 群」横幅等。

> 这些图片的版权归属原软件作者。本项目仅作界面还原用途；若要商用或再分发，请先确认授权，或替换为自绘 / 开源图标集。

## 功能状态

已实现：

- **大厅**：真数据接入（WebSocket 推送人数变化 + 轮询兜底）、三视图切换、按核心 / MC 版本 / 关键词筛选、搜索、分页
- **账号**：注册即登录、登录、JWT 静默续期、邮箱绑定、**访客模式**（免登录浏览大厅与开服）
- **创建游戏**：七字段表单、等级与配额校验、房间级插件 / Mod 清单可见性开关
- **我的游戏**：控制台为真实功能（本地服务端启停、日志流、命令输入含历史、日志翻译开关）；服务端设置页支持 `server.properties` 注释保留读写；插件 / Mod 页扫描本地目录；世界快照
- **当前加入**：成员准备状态、房主地址下发、客户端包下载、一键启动游戏（含 mrpack 客户端实例构建）
- **商城**：「道具商城」展示置顶卡与 VIP 档位；置顶卡图标渲染在房间左上角；VIP 房间边框按档位区分
- **Rust 侧**：进程编排状态机、Java 探测（JAVA_HOME + 常见安装目录）、端口占用探测、`server.properties` 注释保留读写、客户端包断点式下载

设计文档与历史决策见 `plans/`：

- `plans/desktop-plan.md` —— 总体设计与里程碑
- `plans/frontend-code-review.md` —— 前端代码审查与修复记录
- `plans/pcl-modpack-client-build.md` —— PCL / mrpack 客户端构建集成

## 运行期数据位置

客户端**不把状态写在安装目录**，全部落在用户目录，升级 / 重装不丢：

| 内容 | 位置 |
|---|---|
| 偏好设置（含服务器地址） | `com.ljx.desktop/preferences.json` |
| 登录会话 | `com.ljx.desktop/session.json` |
| 服务端实例与 `servers.json` | `.lianjixia/instances` |

## 第三方组件

`src-tauri/vendor/crust_core` 内联了 [crust_core](https://crates.io/crates/crust_core) `1.0.3`（MIT）并附带其原始 LICENSE，用于 Minecraft 客户端资源下载；通过 `Cargo.toml` 的 `[patch.crates-io]` 指向本地目录，便于在其之上加镜像源回退逻辑。
