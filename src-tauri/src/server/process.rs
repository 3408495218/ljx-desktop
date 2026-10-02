use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use super::{strip_ansi, PollOutcome, ServerManager, ServerPhase, ServerStartConfig, StatePayload};

const START_TIMEOUT_SECS: u64 = 120;
const STOP_TIMEOUT_SECS: u64 = 30;
const EXIT_POLL_MS: u64 = 500;

/// State 只能在单语句内使用（临时 State 在语句结束即释放），
/// 因此所有跨语句操作都收敛为 ServerManager 的方法，在此单语句调用。
fn set_phase(app: &AppHandle, phase: ServerPhase, detail: impl Into<String>) {
    let detail = detail.into();
    app.state::<Mutex<ServerManager>>()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .set_phase(phase, detail.clone());
    let _ = app.emit(
        "server://state",
        StatePayload {
            phase,
            detail,
        },
    );
}

/// 去掉 Paper 控制台的 JLine 输入提示符 `> `。
/// 服务端即使在管道下也会输出提示符，且它被顶在每一行行首（日志文件里没有这个）。
/// 留着它：控制台每行都会多一个 `> `，所有「行首锚定」的判据也会失手。
fn strip_console_prompt(line: &str) -> &str {
    line.trim_start_matches(|c: char| c == '>' || c == ' ' || c == '\t' || c == '\r')
}

/// 剥掉日志前缀，只留正文。
/// 就绪判定必须看正文：服务端的前缀有两种形态——
/// 控制台（stdout）是单括号 `[19:08:38 INFO]: Done (35.6s)! For help, type "help"`，
/// 日志文件是双括号 `[18:55:24] [Server thread/INFO]: Done (32.8s)! ...`，
/// 且控制台行首还多一个 JLine 提示符 `> `。
/// 只按其中一种实现，`starts_with("Done (")` 就一条也匹配不上，
/// phase 会永远停在 starting（与日志翻译踩过的是同一个坑）。
fn strip_log_prefix(line: &str) -> &str {
    let line = strip_console_prompt(line);
    let Some(rest) = line.strip_prefix('[') else {
        return line;
    };
    match rest.split_once("]: ") {
        Some((_, body)) => body,
        None => line,
    }
}

/// 服务端就绪信号：正文为 `Done (X.XXXs)! For help, type "help"`。
/// 两种前缀形态都要能认，故先剥前缀再匹配；再剥一次 ANSI 兜底——
/// 调用方虽已剥过颜色，但版本间着色行为可能变，而判定失手的代价是
/// phase 永远停在 starting（与日志翻译踩过的是同一个坑）。
fn is_ready_line(line: &str) -> bool {
    strip_ansi(strip_log_prefix(line)).starts_with("Done (")
}

/// 逐行转发子进程输出。
/// 不能用 `BufRead::lines()`：服务端在中文 Windows 上按 GBK 输出，
/// 一旦某行含非法 UTF-8，`lines()` 会返回 Err 被 break 掉，整段日志凭空消失
/// （表现为控制台一片空白，只剩一句「服务端意外退出」）。故按字节读、宽容解码。
/// `watch_state` 为真时（仅 stdout）额外跟踪就绪信号与玩家进出。
fn pump_lines(app: AppHandle, stream: impl Read, watch_state: bool) {
    let mut reader = BufReader::new(stream);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
            buf.pop();
        }
        // 顺手剥掉 JLine 提示符：控制台不该每行都顶着 `> `
        // （decoded 必须先绑定：from_utf8_lossy 返回临时 Cow，直接取引用会被提前释放）
        let decoded = String::from_utf8_lossy(&buf);
        let raw = strip_console_prompt(&decoded);
        // 再剥 ANSI 颜色。Paper 的玩家进出 / 聊天是 Component，控制台会带颜色渲染
        // （`\x1b[38;5;11m…\x1b[0m`），而前端控制台按纯文本显示、日志解析也要求正文无转义码；
        // 不剥就会同时踩两个坑：控制台显示 `[38;5;11m`、行尾 `[0m` 乱码，且人数恒为 0。
        let line = strip_ansi(raw).into_owned();
        let _ = app.emit("console://line", serde_json::json!({ "raw": line }));
        if !watch_state {
            continue;
        }
        let body = strip_log_prefix(&line);
        if is_ready_line(&line) {
            set_phase(&app, ServerPhase::Running, "");
        }
        // 人数变化立刻广播：等下一次 30 秒心跳太慢，玩家进来后房间卡片要立刻动
        let changed = app
            .state::<Mutex<ServerManager>>()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .apply_player_line(body);
        if changed {
            let count = app
                .state::<Mutex<ServerManager>>()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .player_count();
            let _ = app.emit("server://players", serde_json::json!({ "count": count }));
        }
    }
}

pub fn spawn_server(app: &AppHandle, config: &ServerStartConfig) -> Result<(), String> {
    // State 是临时值，必须绑定后再 lock，否则借用活不过语句
    let state = app.state::<Mutex<ServerManager>>();
    let mut manager = super::lock_manager(&state);
    match manager.phase {
        ServerPhase::Idle | ServerPhase::Failed => {}
        _ => return Err("服务端已在运行或正在启停".into()),
    }
    // 启动超时被判 Failed 时进程可能仍在，此时再拉一个会漏掉旧进程
    // （旧 java.exe 变成孤儿并继续占端口），故按句柄再挡一次。
    if manager.has_live_child() {
        return Err("服务端已在运行".into());
    }
    drop(manager);

    let jar_abs = super::jar_absolute(&config.jar_path)?;
    let work_dir = super::resolve_work_dir(&config.jar_path, &config.work_dir)?;
    if !config.java_path.is_empty() && !std::path::Path::new(&config.java_path).is_file() {
        return Err(format!("找不到 Java：{}", config.java_path));
    }

    let mut cmd = Command::new(&config.java_path);
    cmd.arg(format!("-Xmx{}M", config.xmx_mb))
        // 让 JVM 按 UTF-8 输出，避免中文提示在管道里变成 GBK 乱码
        .arg("-Dstdout.encoding=UTF-8")
        .arg("-Dstderr.encoding=UTF-8")
        .arg("-jar")
        .arg(&jar_abs)
        .arg("nogui")
        .current_dir(&work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("启动失败：{e}"))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // 本轮启动代次：后面的看门狗与退出轮询都只对本代次生效
    let run_id = app
        .state::<Mutex<ServerManager>>()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .install(child, stdin);
    set_phase(app, ServerPhase::Starting, "");

    // 回显实际执行的命令与工作目录：服务端秒退时日志可能来不及产出，
    // 有了这行就能直接看出是路径、内存还是目录不对。
    let _ = app.emit(
        "console://line",
        serde_json::json!({
            "raw": format!(
                "[启动] {} -Xmx{}M -jar {} nogui",
                config.java_path,
                config.xmx_mb,
                jar_abs.display()
            )
        }),
    );
    let _ = app.emit(
        "console://line",
        serde_json::json!({ "raw": format!("[启动] 工作目录 {}", work_dir.display()) }),
    );

    if let Some(out) = stdout {
        let app2 = app.clone();
        thread::spawn(move || pump_lines(app2, out, true));
    }
    if let Some(err) = stderr {
        let app2 = app.clone();
        thread::spawn(move || pump_lines(app2, err, false));
    }

    // 启动超时看门狗：120 秒内未出现 Done 则判失败
    let app3 = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(START_TIMEOUT_SECS));
        // 必须同时满足「仍是本代次」+「仍停在 Starting」才判超时。
        // 上一轮启动遗留的看门狗会在 120 秒后醒来，不管代次的话，
        // 它会把刚起步的新一轮启动直接判成失败——服务端明明正常启动却显示「异常」
        let timed_out = {
            // State 是临时值，必须绑定后再 lock，否则借用活不过语句
            let state3 = app3.state::<Mutex<ServerManager>>();
            let manager = super::lock_manager(&state3);
            manager.run_id() == run_id && manager.phase == ServerPhase::Starting
        };
        if timed_out {
            set_phase(&app3, ServerPhase::Failed, "启动超时（120 秒内未就绪）");
        }
    });

    // 退出轮询：区分主动停止与意外退出
    let app4 = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(EXIT_POLL_MS));
        let outcome = {
            // State 是临时值，必须绑定后再 lock，否则借用活不过语句
            let state4 = app4.state::<Mutex<ServerManager>>();
            let mut manager = super::lock_manager(&state4);
            // 本轮已被新一次启动取代：立刻退场，否则会去轮询新进程并误报「意外退出」
            if manager.run_id() != run_id {
                return;
            }
            manager.poll_exit()
        };
        match outcome {
            PollOutcome::Running => continue,
            PollOutcome::Exited { was_stopping, status } => {
                if was_stopping {
                    set_phase(&app4, ServerPhase::Idle, "");
                } else {
                    set_phase(&app4, ServerPhase::Failed, format!("服务端意外退出：{status}"));
                }
                return;
            }
            PollOutcome::WaitFailed(msg) => {
                set_phase(&app4, ServerPhase::Failed, msg);
                return;
            }
        }
    });

    Ok(())
}

pub fn stop_server(app: &AppHandle) -> Result<(), String> {
    app.state::<Mutex<ServerManager>>()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .request_stop()?;
    set_phase(app, ServerPhase::Stopping, "");

    // 30 秒未退出则强制 kill，退出轮询线程会收尾置 Idle
    let app2 = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(STOP_TIMEOUT_SECS));
        app2.state::<Mutex<ServerManager>>()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .kill_if_stopping();
    });
    Ok(())
}

pub fn send_command(app: &AppHandle, cmd: &str) -> Result<(), String> {
    app.state::<Mutex<ServerManager>>()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .send_command(cmd)
}

#[cfg(test)]
mod tests {
    use super::{is_ready_line, strip_console_prompt, strip_log_prefix};

    #[test]
    fn strip_log_prefix_unwraps_server_log_line() {
        assert_eq!(
            strip_log_prefix(r#"[18:55:24] [Server thread/INFO]: Done (32.838s)! For help, type "help""#),
            r#"Done (32.838s)! For help, type "help""#
        );
    }

    #[test]
    fn strip_log_prefix_unwraps_paper_console_line() {
        // Paper 1.21 控制台（stdout）是单括号 `[HH:mm:ss LEVEL]: `，
        // 与日志文件的双括号形态不同；只按双括号实现会让就绪判定永远匹配不上
        assert_eq!(
            strip_log_prefix(r#"[19:08:38 INFO]: Done (35.624s)! For help, type "help""#),
            r#"Done (35.624s)! For help, type "help""#
        );
    }

    #[test]
    fn ready_line_recognizes_both_prefix_formats() {
        assert!(is_ready_line(
            r#"[19:08:38 INFO]: Done (35.624s)! For help, type "help""#
        ));
        assert!(is_ready_line(
            r#"[18:55:24] [Server thread/INFO]: Done (32.838s)! For help, type "help""#
        ));
        assert!(is_ready_line(r#"Done (1.0s)!"#));
        // 普通启动日志与插件里的「Done (」都不能当成就绪
        assert!(!is_ready_line(r#"[19:08:38 INFO]: Preparing level "world""#));
        assert!(!is_ready_line(r#"[19:08:38 INFO]: Loaded Done (fast)"#));
    }

    #[test]
    fn ready_line_ignores_console_colors() {
        // Paper 会用 ANSI 给 Component 消息着色；就绪行一旦被着色，
        // starts_with("Done (") 就会失手，phase 永远停在 starting
        assert!(is_ready_line(
            "[19:08:38 INFO]: \u{1b}[32mDone (35.624s)! For help, type \"help\"\u{1b}[0m"
        ));
    }

    #[test]
    fn strip_log_prefix_drops_console_prompt() {
        // Paper 在管道下仍会输出 JLine 提示符 `> `，且被顶到每一行行首
        assert_eq!(
            strip_console_prompt(r#"> [19:08:38 INFO]: Done (35.624s)! For help, type "help""#),
            r#"[19:08:38 INFO]: Done (35.624s)! For help, type "help""#
        );
        assert!(is_ready_line(
            r#"> [19:08:38 INFO]: Done (35.624s)! For help, type "help""#
        ));
        assert_eq!(
            strip_log_prefix(r#"> [19:08:38 INFO]: Drbiaodi joined the game"#),
            "Drbiaodi joined the game"
        );
    }

    #[test]
    fn strip_log_prefix_keeps_plain_line() {
        // [启动] 回显行没有 `]: ` 前缀，必须原样保留，否则日志会被截断
        assert_eq!(strip_log_prefix("[启动] 工作目录 D:\\srv"), "[启动] 工作目录 D:\\srv");
        assert_eq!(strip_log_prefix("Done (1.0s)!"), "Done (1.0s)!");
    }
}
