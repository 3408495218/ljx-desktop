use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::client_pkg;
use crate::mods;
use crate::probe;
use crate::props::{self, PropertyLine};
use crate::server::{self, process, ServerStartConfig, StatePayload};
use crate::snapshot;
use crate::world;

/// 解析生效的服务端工作目录（快照 / 配置编辑 / 危险区共用同一目录）
#[tauri::command]
pub fn resolve_server_dir(
    app: AppHandle,
    manager: State<'_, Mutex<server::ServerManager>>,
    jar_path: String,
    work_dir: String,
) -> Result<String, String> {
    let resolved = server::resolve_work_dir(&jar_path, &work_dir)?;
    // 用户在这里确定了服务端目录 —— 立刻记为"允许文件操作的根目录"，
    // 后续 props/snapshot/world/mods 等命令的路径都必须落在它之内
    manager
        .lock()
        .map_err(|_| "内部状态异常".to_string())?
        .set_root(&resolved)?;
    let _ = app;
    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
pub fn server_start(app: AppHandle, config: ServerStartConfig) -> Result<(), String> {
    // 启动即确定服务端目录：即使没走过 resolve_server_dir，这里也会把根设好
    if !config.work_dir.trim().is_empty() {
        app.state::<Mutex<server::ServerManager>>()
            .lock()
            .map_err(|_| "内部状态异常".to_string())?
            .set_root(std::path::Path::new(config.work_dir.trim()))?;
    }
    process::spawn_server(&app, &config)
}

// ---------- 客户端整合包（mrpack）：解析 / 一键构建并启动 ----------
//
// 注意：这几个命令**不接"目标目录"参数**，写入位置由 Rust 侧固定为
// {app_data}/ljx-client/{packId}/，避免开放任意路径写入。

/// 把房主的整合包下载到平台管理的固定目录（供「一键启动」使用），返回本地路径
#[tauri::command]
pub async fn client_fetch_pack(
    app: AppHandle,
    base_url: String,
    room_id: i64,
    token: String,
    file_name: String,
) -> Result<String, String> {
    crate::client_build::fetch_pack(&app, base_url, room_id, token, file_name).await
}

#[tauri::command]
pub fn client_pack_inspect(pack_path: String) -> Result<crate::client_build::MrpackInfo, String> {
    crate::client_build::inspect(std::path::Path::new(pack_path.trim()))
}

#[tauri::command]
pub async fn client_build_and_launch(
    app: AppHandle,
    guard: State<'_, std::sync::Arc<tokio::sync::Mutex<Option<tokio::process::Child>>>>,
    request: crate::client_build::ClientBuildRequest,
) -> Result<String, String> {
    let guard = guard.inner().clone();
    crate::client_build::build_and_launch(app, guard, request).await
}

#[tauri::command]
pub async fn client_kill_game(
    guard: State<'_, std::sync::Arc<tokio::sync::Mutex<Option<tokio::process::Child>>>>,
) -> Result<(), String> {
    let guard = guard.inner().clone();
    crate::client_build::kill_running(&guard).await
}

/// 校验并规范化一个前端传入的路径：必须落在服务端目录之内（见 ServerManager::ensure_within_root）
fn guard_path(manager: &State<'_, Mutex<server::ServerManager>>, raw: &str) -> Result<String, String> {
    let resolved = manager
        .lock()
        .map_err(|_| "内部状态异常".to_string())?
        .ensure_within_root(raw)?;
    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
pub fn server_stop(app: AppHandle) -> Result<(), String> {
    process::stop_server(&app)
}

#[tauri::command]
pub fn server_status(manager: State<'_, Mutex<server::ServerManager>>) -> StatePayload {
    let m = server::lock_manager(&manager);
    StatePayload {
        phase: m.phase,
        detail: m.detail.clone(),
    }
}

/// 本机服务端当前在线人数：房间心跳上报的就是这个值
#[tauri::command]
pub fn server_players(manager: State<'_, Mutex<server::ServerManager>>) -> usize {
    server::lock_manager(&manager).player_count()
}

/// 本机服务端当前在线名单：随心跳整体上报，供「当前加入」页显示真实玩家
#[tauri::command]
pub fn server_player_names(manager: State<'_, Mutex<server::ServerManager>>) -> Vec<String> {
    server::lock_manager(&manager).player_names()
}

#[tauri::command]
pub fn console_send(app: AppHandle, cmd: String) -> Result<(), String> {
    process::send_command(&app, &cmd)
}

#[tauri::command]
pub fn probe_java() -> Vec<probe::JavaInstall> {
    probe::find_java()
}

#[tauri::command]
pub fn probe_port(port: u16) -> bool {
    probe::is_port_occupied(port)
}

#[tauri::command]
pub fn probe_mc() -> probe::McEnv {
    probe::probe_mc()
}

#[tauri::command]
pub fn props_read(manager: State<'_, Mutex<server::ServerManager>>, path: String)
    -> Result<Vec<PropertyLine>, String> {
    props::read_properties(&guard_path(&manager, &path)?)
}

#[tauri::command]
pub fn props_write(manager: State<'_, Mutex<server::ServerManager>>, path: String, entries: Vec<PropertyLine>)
    -> Result<(), String> {
    props::write_properties(&guard_path(&manager, &path)?, &entries)
}

// ---------- 快照：打包可能耗时较久，走 spawn_blocking 避免阻塞 UI ----------

#[tauri::command]
pub async fn snapshot_list(manager: State<'_, Mutex<server::ServerManager>>, work_dir: String)
    -> Result<Vec<snapshot::SnapshotMeta>, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    tauri::async_runtime::spawn_blocking(move || snapshot::list_snapshots(&work_dir))
        .await
        .map_err(|e| format!("快照任务失败：{e}"))?
}

#[tauri::command]
pub async fn snapshot_create(manager: State<'_, Mutex<server::ServerManager>>, work_dir: String, name: String)
    -> Result<snapshot::SnapshotMeta, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    tauri::async_runtime::spawn_blocking(move || snapshot::create_snapshot(&work_dir, &name))
        .await
        .map_err(|e| format!("快照任务失败：{e}"))?
}

#[tauri::command]
pub async fn snapshot_delete(manager: State<'_, Mutex<server::ServerManager>>, work_dir: String, name: String)
    -> Result<(), String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    tauri::async_runtime::spawn_blocking(move || snapshot::delete_snapshot(&work_dir, &name))
        .await
        .map_err(|e| format!("快照任务失败：{e}"))?
}

#[tauri::command]
pub async fn snapshot_restore(manager: State<'_, Mutex<server::ServerManager>>, work_dir: String, name: String)
    -> Result<Vec<String>, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    tauri::async_runtime::spawn_blocking(move || snapshot::restore_snapshot(&work_dir, &name))
        .await
        .map_err(|e| format!("快照任务失败：{e}"))?
}

// ---------- 危险区 ----------

#[tauri::command]
pub async fn world_clear(manager: State<'_, Mutex<server::ServerManager>>, work_dir: String)
    -> Result<Vec<String>, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    tauri::async_runtime::spawn_blocking(move || world::clear_world(&work_dir))
        .await
        .map_err(|e| format!("危险操作失败：{e}"))?
}

#[tauri::command]
pub async fn world_reset(manager: State<'_, Mutex<server::ServerManager>>, work_dir: String)
    -> Result<Vec<String>, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    tauri::async_runtime::spawn_blocking(move || world::reset_all(&work_dir))
        .await
        .map_err(|e| format!("危险操作失败：{e}"))?
}

// ---------- 本地插件 / Mod：以服务端 plugins、mods 目录为准，平台只做展示镜像 ----------

#[tauri::command]
pub async fn mods_list(manager: State<'_, Mutex<server::ServerManager>>, work_dir: String, kind: String)
    -> Result<Vec<mods::ContentEntry>, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    let kind = mods::ContentKind::parse(&kind)?;
    tauri::async_runtime::spawn_blocking(move || mods::list_contents(&work_dir, kind))
        .await
        .map_err(|e| format!("扫描本地文件失败：{e}"))?
}

#[tauri::command]
pub async fn mods_import(
    manager: State<'_, Mutex<server::ServerManager>>,
    work_dir: String,
    kind: String,
    sources: Vec<String>,
) -> Result<Vec<mods::ContentEntry>, String> {
    // 目标目录必须在服务端目录内；来源文件（用户从任意位置挑的 jar）不做限制是合理的，
    // 真正落地时文件名会被 mods::sanitize_file_name 压成纯文件名，不会穿越
    let work_dir = guard_path(&manager, &work_dir)?;
    let kind = mods::ContentKind::parse(&kind)?;
    tauri::async_runtime::spawn_blocking(move || mods::import_contents(&work_dir, kind, &sources))
        .await
        .map_err(|e| format!("导入任务失败：{e}"))?
}

#[tauri::command]
pub async fn mods_delete(
    manager: State<'_, Mutex<server::ServerManager>>,
    work_dir: String,
    kind: String,
    file_name: String,
) -> Result<Vec<mods::ContentEntry>, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    let kind = mods::ContentKind::parse(&kind)?;
    tauri::async_runtime::spawn_blocking(move || mods::delete_content(&work_dir, kind, &file_name))
        .await
        .map_err(|e| format!("删除任务失败：{e}"))?
}

#[tauri::command]
pub async fn mods_set_enabled(
    manager: State<'_, Mutex<server::ServerManager>>,
    work_dir: String,
    kind: String,
    file_name: String,
    enabled: bool,
) -> Result<Vec<mods::ContentEntry>, String> {
    let work_dir = guard_path(&manager, &work_dir)?;
    let kind = mods::ContentKind::parse(&kind)?;
    tauri::async_runtime::spawn_blocking(move || {
        mods::set_content_enabled(&work_dir, kind, &file_name, enabled)
    })
    .await
    .map_err(|e| format!("切换状态任务失败：{e}"))?
}

/// 选择本地 jar（可多选），用于导入插件 / Mod
#[tauri::command]
pub async fn pick_files(app: AppHandle, title: String) -> Option<Vec<String>> {
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("Minecraft 扩展", &["jar"])
        .blocking_pick_files()
        .map(|picked| {
            picked
                .into_iter()
                .filter_map(|path| path.simplified().into_path().ok())
                .map(|path| path.to_string_lossy().to_string())
                .collect()
        })
}

/// 选择目录（客户端压缩包的下载位置）；取消时返回 null
#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String, start_dir: Option<String>) -> Option<String> {
    let mut builder = app.dialog().file().set_title(title);
    if let Some(dir) = start_dir.filter(|dir| !dir.trim().is_empty()) {
        builder = builder.set_directory(dir);
    }
    builder
        .blocking_pick_folder()
        .and_then(|path| path.simplified().into_path().ok())
        .map(|path| path.to_string_lossy().to_string())
}

/// 下载房主上传的客户端压缩包到指定目录，返回落盘路径
#[tauri::command]
pub async fn download_client_package(
    base_url: String,
    room_id: i64,
    token: String,
    dest_dir: String,
    file_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        client_pkg::download(&base_url, room_id, &token, &dest_dir, &file_name)
    })
    .await
    .map_err(|e| format!("下载任务失败：{e}"))?
}

/// 在资源管理器中打开目录，便于玩家把压缩包交给 PCL 导入
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    // 这里**刻意不做根目录校验**：调用方是「下载完客户端包后打开目录」，
    // 路径来自用户用系统对话框自选的下载文件夹（通常在桌面/下载），本来就在服务端目录之外。
    // 而且它只是"用文件管理器打开一个文件夹"，不读不写，风险可忽略 ——
    // 若强行校验，玩家下载完点「打开目录」会直接报错（这个回归在实测中被发现）。
    tauri::async_runtime::spawn_blocking(move || client_pkg::open_folder(&path))
        .await
        .map_err(|e| format!("打开目录任务失败：{e}"))?
}

/// 用系统默认浏览器打开 http/https 链接（加群网页、官方文档等）
/// 只放行 http(s) 且拒绝空白字符，避免把任意字符串喂给 cmd
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let scheme_ok = trimmed.starts_with("https://") || trimmed.starts_with("http://");
    if !scheme_ok || trimmed.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("仅支持打开 http/https 链接".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("打开链接失败：{e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("当前平台暂不支持打开外部链接".into())
    }
}

/// 打开系统默认的 Minecraft 启动器（注册表关联的 minecraft:// 协议）
#[tauri::command]
pub fn open_mc_launcher() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "minecraft://"])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("打开 Minecraft 启动器失败：{e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("当前平台暂不支持直接打开启动器".into())
    }
}
