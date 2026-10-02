mod client_pkg;
mod client_build;
mod commands;
mod mods;
mod probe;
mod props;
mod server;
mod snapshot;
mod world;

use std::sync::Mutex;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 必须注册 Mutex<ServerManager>：命令侧取的是 State<Mutex<ServerManager>>，
            // 类型不一致时 state() 会 panic 并带崩整个应用（且 cargo test 走不到这条路径）。
            app.manage(Mutex::new(server::ServerManager::new()));
            // 正在运行的游戏进程句柄（Arc 以便在命令之间共享）
            app.manage(std::sync::Arc::new(tokio::sync::Mutex::new(
                None::<tokio::process::Child>,
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::client_fetch_pack,
            commands::client_pack_inspect,
            commands::client_build_and_launch,
            commands::client_kill_game,
            commands::resolve_server_dir,
            commands::server_start,
            commands::server_stop,
            commands::server_status,
            commands::server_players,
            commands::server_player_names,
            commands::console_send,
            commands::probe_java,
            commands::probe_port,
            commands::probe_mc,
            commands::props_read,
            commands::props_write,
            commands::snapshot_list,
            commands::snapshot_create,
            commands::snapshot_delete,
            commands::snapshot_restore,
            commands::world_clear,
            commands::world_reset,
            commands::open_mc_launcher,
            commands::open_url,
            commands::pick_files,
            commands::pick_folder,
            commands::mods_list,
            commands::mods_import,
            commands::mods_delete,
            commands::mods_set_enabled,
            commands::download_client_package,
            commands::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}