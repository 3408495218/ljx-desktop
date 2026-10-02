use std::sync::{Mutex, MutexGuard};
pub mod process;

use std::borrow::Cow;
use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ExitStatus};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerPhase {
    Idle,
    Starting,
    Running,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStartConfig {
    pub java_path: String,
    pub jar_path: String,
    pub xmx_mb: u32,
    pub work_dir: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub phase: ServerPhase,
    pub detail: String,
}

/// 生效工作目录：显式 work_dir 优先，否则取 jar 所在目录。
/// 快照、server.properties 编辑与危险区操作都必须落在同一目录，故单点收敛。
pub fn resolve_work_dir(jar_path: &str, work_dir: &str) -> Result<PathBuf, String> {
    if !work_dir.trim().is_empty() {
        return Ok(PathBuf::from(work_dir));
    }
    jar_absolute(jar_path)?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "无法推断服务端工作目录".to_string())
}

/// jar 的绝对路径。必须剥掉 Windows verbatim 前缀：`canonicalize` 会产出 `\\?\D:\...`，
/// Java 的 `-jar` 不认这种形式（直接报 ClassNotFoundException 退出），
/// 且该路径还会回显到界面的「工作目录」输入框里。
pub fn jar_absolute(jar_path: &str) -> Result<PathBuf, String> {
    let abs = PathBuf::from(jar_path)
        .canonicalize()
        .map_err(|e| format!("找不到服务端 jar：{e}"))?;
    Ok(strip_verbatim(abs))
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().into_owned();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path,
    }
}

pub enum PollOutcome {
    Running,
    Exited { was_stopping: bool, status: ExitStatus },
    WaitFailed(String),
}

/// ANSI 转义引导符（ESC）
const ESC: char = '\u{1b}';

/// 剥掉 ANSI 转义序列（CSI，形如 `\x1b[38;5;11m` 与复位 `\x1b[0m`）。
///
/// 控制台（stdout）里的玩家加入 / 退出消息是 Adventure Component，Paper 会带颜色渲染：
/// `[20:45:33 INFO]: \x1b[38;5;11mProbeBot joined the game\x1b[0m`；
/// 同一行写进 `logs/latest.log` 时却不带颜色。
/// 不剥掉，正文就以 `\x1b[0m` 结尾，`strip_suffix(" joined the game")` 永远失配，
/// 在线人数恒为 0——服务端里明明有人，房间卡片却一直是 0。
///
/// 不含 ESC 时按借用返回，老版本（Spigot 1.8.8）与日志文件形态的行为完全不变。
pub(crate) fn strip_ansi(input: &str) -> Cow<'_, str> {
    if !input.contains(ESC) {
        return Cow::Borrowed(input);
    }
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c != ESC {
            out.push(c);
            continue;
        }
        // CSI 序列：ESC '[' 参数字节(0x30..=0x3F) 中间字节(0x20..=0x2F) 终止字节(0x40..=0x7E)
        if chars.clone().next() != Some('[') {
            continue; // 非 CSI 的裸 ESC 直接丢弃
        }
        chars.next();
        for n in chars.by_ref() {
            if ('\u{40}'..='\u{7e}').contains(&n) {
                break;
            }
        }
    }
    Cow::Owned(out)
}

/// 一行日志对在线名单的影响
enum PlayerChange {
    Joined(String),
    Left(String),
    /// `/list` 输出，含完整名单，用于整体校正
    Synced(Vec<String>),
}

/// 从日志正文（已剥前缀）解析玩家进出。
/// 服务端跑在房主本机，平台看不到它，房间人数只能由房主端自己数。
fn parse_player_line(body: &str) -> Option<PlayerChange> {
    if let Some(rest) = body.strip_prefix("There are ") {
        let (_, names) = rest.split_once(" players online:")?;
        return Some(PlayerChange::Synced(
            names
                .split(',')
                .map(str::trim)
                .filter(|n| is_plausible_name(n))
                .map(str::to_string)
                .collect(),
        ));
    }
    if let Some(name) = player_name_of(body, " joined the game") {
        return Some(PlayerChange::Joined(name));
    }
    if let Some(name) = player_name_of(body, " left the game") {
        return Some(PlayerChange::Left(name));
    }
    // 超时 / 崩溃掉线不会打 left the game，只有 lost connection，不数就会永久虚高
    if let Some(idx) = body.find(" lost connection: ") {
        let name = &body[..idx];
        if is_plausible_name(name) {
            return Some(PlayerChange::Left(name.to_string()));
        }
    }
    None
}

fn player_name_of(body: &str, suffix: &str) -> Option<String> {
    let name = body.strip_suffix(suffix)?;
    is_plausible_name(name).then(|| name.to_string())
}

/// 玩家名只允许字母数字下划线，且不含空白——借此排除聊天内容里
/// 恰好出现「 joined the game」之类的误判（聊天行以 `<` 开头）。
fn is_plausible_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 16
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 把"可能还不存在"的路径规范化：向上找到最近的已存在祖先并规范化，再拼回剩余部分。
///
/// 直接用 `Path::canonicalize` 对不存在的路径会报错，而本项目大量场景是"要新建文件/目录"，
/// 所以必须支持这种部分存在的路径。
fn resolve_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut current = path.to_path_buf();
    let mut tails: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(canonical) = current.canonicalize() {
            let mut result = canonical;
            for tail in tails.iter().rev() {
                result.push(tail);
            }
            return Ok(result);
        }
        match current.file_name() {
            Some(name) => tails.push(name.to_os_string()),
            None => return Err(format!("无法解析路径：{}", path.display())),
        }
        if !current.pop() {
            return Err(format!("无法解析路径：{}", path.display()));
        }
    }
}

pub struct ServerManager {
    pub phase: ServerPhase,
    pub detail: String,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    /// 在线玩家名。房间人数由心跳上报，来源就是这里
    players: BTreeSet<String>,
    /// 启动代次：每次 install 自增。看门狗与退出轮询靠它判断
    /// 「我这一轮是否已被新一次启动取代」——上一轮遗留的线程若不管代次，
    /// 会在 120 秒后醒来把刚起步的新一轮启动判成失败（服务端明明在启动却显示「异常」）
    run_id: u64,
    /// **允许文件操作的根目录**（房主选定的服务端目录，规范化后的绝对路径）。
    ///
    /// 存在的意义：`props_read/write`、`snapshot_*`、`world_clear/reset`、`mods_*`、`open_folder`
    /// 这些命令的路径参数由前端传入，原先**没有任何约束** —— 一旦前端被注入（或将来引入动态渲染），
    /// 就能读写本机任意文件。这里把可操作范围收紧到"服务端目录之内"。
    ///
    /// 由 `resolve_server_dir` 与 `server_start` 设置（两者都是"用户确定了服务端目录"的时机）。
    root: Option<PathBuf>,
}

/// 取 `ServerManager` 的锁，**即使锁已中毒也沿用其中的数据**。
///
/// 中毒意味着过去某个持锁线程 panic 过；对"读/写运行状态"这类操作，
/// 沿用旧数据（并继续工作）比让每个命令都再 panic 一次更合理 ——
/// 用户看到的是可读的错误提示，而不是一串莫名其妙的失败。
/// （Tauri 会捕获命令 panic，但那样会丢掉具体原因，排查体验很差。）
///
/// 说明：**链式调用处**（`app.state::<…>().lock()`）直接写
/// `lock().unwrap_or_else(|poisoned| poisoned.into_inner())` 即可，与调用本函数等价 ——
/// 那里若改用本函数，`State` 是临时值、guard 活不过语句，反而编译不过。
pub fn lock_manager(mutex: &Mutex<ServerManager>) -> MutexGuard<'_, ServerManager> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl ServerManager {

    /// 设置允许操作的根目录（用户选定服务端目录时调用）。
    /// 目录不存在或无法规范化时返回错误 —— 宁可拒绝，也不要让一个无效的根静默生效。
    pub fn set_root(&mut self, dir: &Path) -> Result<(), String> {
        let canonical = dir
            .canonicalize()
            .map_err(|e| format!("服务端目录无法解析：{}（{e}）", dir.display()))?;
        self.root = Some(canonical);
        Ok(())
    }

    /// 校验某个前端传入的路径**必须位于服务端目录之内**，返回规范化后的绝对路径。
    ///
    /// 要点：
    /// - 先 `canonicalize` 再比较，才能挡住 `../` 与符号链接这类绕过；
    /// - 目标**可能还不存在**（例如要新建 `server.properties`），所以先找到最近的已存在祖先
    ///   做规范化，再把剩余路径段拼回去 —— 否则新建文件会被误判为"路径非法"；
    /// - 未设置根目录时直接拒绝（而不是放行），避免出现"忘了设置就完全不受限"。
    pub fn ensure_within_root(&self, raw: &str) -> Result<PathBuf, String> {
        let root = self
            .root
            .as_ref()
            .ok_or("尚未确定服务端目录：请先在「我的游戏」里选择服务端目录")?;
        let candidate = PathBuf::from(raw.trim());
        if candidate.as_os_str().is_empty() {
            return Err("路径不能为空".to_string());
        }
        let resolved = resolve_existing_ancestor(&candidate)?;
        if resolved.starts_with(root) {
            Ok(resolved)
        } else {
            Err(format!(
                "路径不在服务端目录内，已拒绝：{}（允许范围：{}）",
                resolved.display(),
                root.display()
            ))
        }
    }
    pub fn new() -> Self {
        Self {
            phase: ServerPhase::Idle,
            detail: String::new(),
            child: None,
            stdin: None,
            players: BTreeSet::new(),
            run_id: 0,
            root: None,
        }
    }

    pub fn set_phase(&mut self, phase: ServerPhase, detail: String) {
        self.phase = phase;
        self.detail = detail;
    }

    /// 装载新子进程并开启新一轮，返回本轮代次，供看门狗 / 退出轮询比对
    pub fn install(&mut self, child: Child, stdin: Option<ChildStdin>) -> u64 {
        self.child = Some(child);
        self.stdin = stdin;
        // 新进程从零开始，旧名单必须丢掉
        self.players.clear();
        self.run_id += 1;
        self.run_id
    }

    pub fn run_id(&self) -> u64 {
        self.run_id
    }

    /// 按一行日志正文更新在线名单，返回名单是否变化
    pub fn apply_player_line(&mut self, body: &str) -> bool {
        match parse_player_line(body) {
            Some(PlayerChange::Joined(name)) => self.players.insert(name),
            Some(PlayerChange::Left(name)) => self.players.remove(&name),
            Some(PlayerChange::Synced(names)) => {
                let next: BTreeSet<String> = names.into_iter().collect();
                let changed = next != self.players;
                self.players = next;
                changed
            }
            None => false,
        }
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    /// 在线玩家名快照。BTreeSet 已按字典序排好，上报顺序稳定，后端不必再排
    pub fn player_names(&self) -> Vec<String> {
        self.players.iter().cloned().collect()
    }

    /// 是否仍有存活的子进程。
    /// phase 只是标签，可能因启动超时被判 Failed 而进程其实还活着，
    /// 因此「能不能停 / 能不能启」必须看句柄，不能只看标签。
    pub fn has_live_child(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => !matches!(child.try_wait(), Ok(Some(_))),
            None => false,
        }
    }

    pub fn request_stop(&mut self) -> Result<(), String> {
        if !self.has_live_child() {
            return Err("服务端未在运行".into());
        }
        // 优先写 stdin 优雅停止；stdin 已不可用时直接 kill，
        // 否则被判 Failed 但进程仍在的服务端会变成界面上停不掉的孤儿进程。
        let graceful = match self.stdin.as_mut() {
            Some(stdin) => stdin.write_all(b"stop\n").is_ok(),
            None => false,
        };
        if !graceful {
            if let Some(child) = self.child.as_mut() {
                let _ = child.kill();
            }
        }
        self.phase = ServerPhase::Stopping;
        Ok(())
    }

    pub fn kill_if_stopping(&mut self) {
        if self.phase == ServerPhase::Stopping {
            if let Some(child) = self.child.as_mut() {
                let _ = child.kill();
            }
        }
    }

    pub fn send_command(&mut self, cmd: &str) -> Result<(), String> {
        match self.phase {
            ServerPhase::Running | ServerPhase::Starting => {}
            _ => return Err("服务端未在运行".into()),
        }
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "标准输入不可用".to_string())?;
        stdin
            .write_all(format!("{cmd}\n").as_bytes())
            .map_err(|e| format!("命令发送失败：{e}"))
    }

    /// 轮询一次子进程：仍在运行 / 已退出（含是否主动停止）/ 等待失败
    pub fn poll_exit(&mut self) -> PollOutcome {
        let Some(child) = self.child.as_mut() else {
            return PollOutcome::WaitFailed("进程句柄已清理".into());
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                let was_stopping = self.phase == ServerPhase::Stopping;
                self.child = None;
                self.stdin = None;
                self.players.clear();
                PollOutcome::Exited { was_stopping, status }
            }
            Ok(None) => PollOutcome::Running,
            Err(e) => PollOutcome::WaitFailed(format!("等待进程退出失败：{e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{strip_ansi, strip_verbatim, ServerManager};
    use std::borrow::Cow;
    use std::path::PathBuf;

    #[test]
    fn strip_verbatim_drops_windows_prefix() {
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\D:\server\paper.jar")),
            PathBuf::from(r"D:\server\paper.jar")
        );
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\UNC\srv\share\paper.jar")),
            PathBuf::from(r"\\srv\share\paper.jar")
        );
        assert_eq!(
            strip_verbatim(PathBuf::from(r"D:\server\paper.jar")),
            PathBuf::from(r"D:\server\paper.jar")
        );
    }

    /// 名单统计是纯函数，不需要真进程即可覆盖
    fn count_after(lines: &[&str]) -> usize {
        let mut manager = ServerManager::new();
        for line in lines {
            manager.apply_player_line(line);
        }
        manager.player_count()
    }

    #[test]
    fn strip_ansi_removes_paper_console_colors() {
        // 真实抓取（Paper 1.21.4 控制台）：256 色 + 复位
        assert_eq!(
            strip_ansi("\u{1b}[38;5;11mProbeBot joined the game\u{1b}[0m"),
            "ProbeBot joined the game"
        );
        // 无转义码时必须零改动地借用返回（老版本 Spigot 1.8.8 走这条路径）
        assert!(matches!(
            strip_ansi("Drbiaodi joined the game"),
            Cow::Borrowed(_)
        ));
    }

    /// 真实控制台行的正文形态：`strip_log_prefix` 之后的带色文本
    fn colored_body(console_line: &str) -> String {
        let body = console_line.split_once("]: ").map(|(_, b)| b).unwrap_or(console_line);
        strip_ansi(body).into_owned()
    }

    #[test]
    fn counts_players_from_colored_console_lines() {
        // 回归：Paper 控制台的玩家进出消息是 Adventure Component，带 ANSI 颜色，
        // 与 logs/latest.log 里同一行的纯文本形态不同。不剥颜色就一个也数不出来，
        // 房间卡片的人数会永远是 0（服务端里其实有人）。
        let mut manager = ServerManager::new();
        manager.apply_player_line(&colored_body(
            "[20:45:33 INFO]: \u{1b}[38;5;11mProbeBot joined the game\u{1b}[0m",
        ));
        assert_eq!(manager.player_count(), 1);
        assert_eq!(manager.player_names(), vec!["ProbeBot".to_string()]);

        manager.apply_player_line(&colored_body(
            "[20:46:03 INFO]: \u{1b}[38;5;11mProbeBot left the game\u{1b}[0m",
        ));
        assert_eq!(manager.player_count(), 0);

        // 同一批行若来自日志文件形态（双括号、无颜色），依旧数得出来
        let mut file_manager = ServerManager::new();
        file_manager.apply_player_line(&colored_body(
            "[20:45:33] [Server thread/INFO]: ProbeBot joined the game",
        ));
        assert_eq!(file_manager.player_count(), 1);
    }

    #[test]
    fn counts_join_and_leave() {
        assert_eq!(count_after(&["Drbiaodi joined the game"]), 1);
        assert_eq!(
            count_after(&["Drbiaodi joined the game", "Steve joined the game"]),
            2
        );
        assert_eq!(
            count_after(&[
                "Drbiaodi joined the game",
                "Steve joined the game",
                "Steve left the game"
            ]),
            1
        );
    }

    #[test]
    fn repeated_join_does_not_double_count() {
        // 同一玩家重复登录（掉线重连）不能重复计数
        assert_eq!(
            count_after(&["Drbiaodi joined the game", "Drbiaodi joined the game"]),
            1
        );
    }

    #[test]
    fn lost_connection_counts_as_leave() {
        assert_eq!(
            count_after(&[
                "Drbiaodi joined the game",
                "Steve joined the game",
                "Steve lost connection: Timed out"
            ]),
            1
        );
    }

    #[test]
    fn list_output_resyncs_whole_roster() {
        // /list 输出是权威名单，能纠正此前漏掉的事件
        assert_eq!(
            count_after(&[
                "Drbiaodi joined the game",
                "There are 2 of a max of 50 players online: Drbiaodi, Steve"
            ]),
            2
        );
        assert_eq!(
            count_after(&[
                "Drbiaodi joined the game",
                "There are 0 of a max of 50 players online:"
            ]),
            0
        );
    }

    #[test]
    fn ignores_chat_and_unrelated_lines() {
        // 聊天内容里出现同样的字样不能被当成进出事件
        assert_eq!(count_after(&["<Steve> i joined the game lol"]), 0);
        assert_eq!(count_after(&["[SuperCraftsman] 经验强化已启动,方案: 3"]), 0);
        assert_eq!(count_after(&["Done (32.838s)! For help, type \"help\""]), 0);
    }

    // ---------- 路径守卫（P1-1 修复的回归） ----------

    #[test]
    fn ensure_within_root_accepts_paths_inside() {
        let base = std::env::temp_dir().join("ljx-guard-inside");
        std::fs::create_dir_all(&base).unwrap();
        let mut manager = ServerManager::new();
        manager.set_root(&base).unwrap();

        // 根目录本身
        assert!(manager.ensure_within_root(&base.to_string_lossy()).is_ok());
        // 根目录下**还不存在**的路径（新建 server.properties 的场景）
        let not_yet = base.join("server.properties");
        assert!(
            manager.ensure_within_root(&not_yet.to_string_lossy()).is_ok(),
            "不存在的子路径也应放行，否则新建文件会被误拒"
        );
        // 不存在的多层子目录
        let deep = base.join("plugins").join("EssentialsX").join("config.yml");
        assert!(manager.ensure_within_root(&deep.to_string_lossy()).is_ok());
    }

    #[test]
    fn ensure_within_root_rejects_traversal_and_outside() {
        let base = std::env::temp_dir().join("ljx-guard-outside");
        std::fs::create_dir_all(&base).unwrap();
        let mut manager = ServerManager::new();
        manager.set_root(&base).unwrap();

        // .. 穿越
        let escape = base.join("..").join("..").join("etc");
        assert!(
            manager.ensure_within_root(&escape.to_string_lossy()).is_err(),
            "../ 穿越必须被拒绝"
        );
        // 明确的根外绝对路径
        let outside = std::env::temp_dir().join("ljx-guard-other");
        std::fs::create_dir_all(&outside).unwrap();
        assert!(manager.ensure_within_root(&outside.to_string_lossy()).is_err());
        // 空路径
        assert!(manager.ensure_within_root("   ").is_err());
    }

    #[test]
    fn ensure_within_root_refuses_when_root_unknown() {
        // 还没确定服务端目录时必须**拒绝**，而不是放行 ——
        // 否则"忘了设置根"就等于完全不受限，等于没做这道防线
        let manager = ServerManager::new();
        assert!(manager.ensure_within_root("C:/anything").is_err());
    }
}
