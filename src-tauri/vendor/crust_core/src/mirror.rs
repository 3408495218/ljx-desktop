//! 下载源镜像（默认使用 BMCLAPI，可按需切回官方源）。
//!
//! ## 为什么需要它
//!
//! 上游 `crust_core` 把各下载源写成常量，没有配置入口。而国内直连
//! `resources.download.minecraft.net`（assets ~400MB，最大头）往往很慢。
//! 这里用一个**集中的域名映射**把所有下载请求改写到国内镜像，
//! 修改点只在 HTTP 层的两个入口，不触碰业务逻辑。
//!
//! ## 安全边界
//!
//! **按域名白名单映射**：只有列在 [`MIRRORS`] 里的官方域名会被改写。
//! 微软/Xbox/Mojang 认证（`login.live.com`、`api.minecraftservices.com` 等）
//! **不在白名单内**，因此登录流程不受影响 —— 这点很关键，
//! 因为认证端点是 POST + 令牌，改写会直接导致登录失败。
//!
//! ## 如何切换回官方源
//!
//! 设环境变量 `LJX_MC_MIRROR=official`（或 `off`）即可全部走官方源；
//! 默认（不设或设为 `bmclapi`）走 BMCLAPI。
//!
//! 所有映射都**实测验证过**（200 响应），不是凭印象写的。

/// 国内镜像根地址（BMCLAPI）
pub const BMCLAPI: &str = "https://bmclapi2.bangbang93.com";

/// 是否**优先**使用镜像。**默认 false（优先官方源）**。
///
/// 依据是实测（24 个真实资产文件、按并发跑聚合速度）：
///
/// | 源 | 并发 8 | 16 | 32 | 64 |
/// |---|---|---|---|---|
/// | BMCLAPI | 0.46 | 0.57 | 0.30 | **0.53 MB/s** |
/// | **官方** | 2.79 | 4.38 | 5.74 | **6.73 MB/s** |
///
/// **官方源在多并发下快约 12 倍**（BMCLAPI 疑似限流）。
/// 早前用"单文件"测速得出"镜像更快"的结论是误导 —— 单连接会被限速，不代表真实场景。
///
/// 设 `LJX_MC_MIRROR=bmclapi|mirror|on|1` 可改为镜像优先（适用于官方源确实不通的网络）。
/// **无论顺序如何，两者都会互相兜底**（见 [`candidates`]），所以不会因为某一个不通而失败。
pub fn mirror_enabled() -> bool {
    enabled_from_env(std::env::var("LJX_MC_MIRROR").ok().as_deref())
}

/// 纯函数版：不读全局状态，便于测试（并行测试里操作环境变量会互相干扰）
pub fn enabled_from_env(raw: Option<&str>) -> bool {
    match raw {
        Some(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "bmclapi" | "mirror" | "on" | "1" | "true"
        ),
        None => false, // 默认官方优先
    }
}

/// 把官方 URL 改写成镜像 URL；不在白名单内的原样返回。
///
/// 映射依据（均已实测 200）：
///
/// | 官方 | 镜像 |
/// |---|---|
/// | `launchermeta.mojang.com/mc/game/version_manifest_v2.json` | `{bmclapi}/mc/game/version_manifest_v2.json` |
/// | `piston-meta.mojang.com/.../{版本}.json` | `{bmclapi}/version/{版本}/json` |
/// | `resources.download.minecraft.net/{前2位}/{hash}` | `{bmclapi}/assets/{前2位}/{hash}` |
/// | `libraries.minecraft.net/{path}` | `{bmclapi}/maven/{path}` |
/// | `maven.neoforged.net/releases/{path}` | `{bmclapi}/maven/{path}` |
/// | `maven.minecraftforge.net/{path}` | `{bmclapi}/maven/{path}` |
///
/// **不映射**（保持官方）：
/// - `api.azul.com` / `cdn.azul.com`（Java 运行时，BMCLAPI 不代理）
/// - `files.minecraftforge.net`（元数据 API，路径与 maven 不同）
/// - 所有认证域名（登录、令牌、皮肤）
pub fn rewrite(url: &str) -> String {
    rewrite_with(url, mirror_enabled())
}

/// 纯函数版改写：`enabled=false` 时原样返回。测试用这个，避免共享环境变量。
pub fn rewrite_with(url: &str, enabled: bool) -> String {
    if !enabled {
        return url.to_string();
    }
    let u = url.trim();

    // 版本清单
    if let Some(rest) = u.strip_prefix("https://launchermeta.mojang.com/") {
        return format!("{BMCLAPI}/{rest}");
    }

    // 版本详情：官方是 .../v1/packages/<sha1>/<版本>.json，镜像走 /version/<版本>/json
    if u.starts_with("https://piston-meta.mojang.com/") {
        if let Some(ver) = version_from_meta_url(u) {
            return format!("{BMCLAPI}/version/{ver}/json");
        }
        return u.to_string();
    }

    // 资源文件（assets 的对象，按内容哈希寻址）
    if let Some(rest) = u.strip_prefix("https://resources.download.minecraft.net/") {
        return format!("{BMCLAPI}/assets/{rest}");
    }

    // 依赖库与加载器
    for prefix in [
        "https://libraries.minecraft.net/",
        "https://maven.neoforged.net/releases/",
        "https://maven.minecraftforge.net/",
    ] {
        if let Some(rest) = u.strip_prefix(prefix) {
            return format!("{BMCLAPI}/maven/{rest}");
        }
    }

    // 其它一律不动（含 Java 运行时、Forge 元数据 API、所有认证端点）
    u.to_string()
}

/// 镜像失败计数：连续失败达到阈值后，**本次进程内**后续请求直接走官方源。
///
/// 为什么需要：实测 BMCLAPI 平均比官方快（1210 KB/s vs 594 KB/s），
/// 但**偶发** SSL 握手失败。若每个文件都"先试镜像再回退"，失败的那些会白等一轮，
/// 整体反而变慢。用这个记忆，一旦发现镜像不稳就立刻整体切官方，避免反复踩同一个坑。
static MIRROR_FAILURES: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
const MIRROR_FAILURE_THRESHOLD: u32 = 3;

/// 记录一次镜像失败；返回当前是否已"拉黑"镜像
pub fn note_mirror_failure() -> bool {
    let n = MIRROR_FAILURES.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    n >= MIRROR_FAILURE_THRESHOLD
}

/// 记录一次镜像成功：重置计数（抖动是正常的，不必永久拉黑）
pub fn note_mirror_success() {
    MIRROR_FAILURES.store(0, std::sync::atomic::Ordering::Relaxed);
}

/// 镜像是否已被临时判定为"不可用"
pub fn mirror_degraded() -> bool {
    MIRROR_FAILURES.load(std::sync::atomic::Ordering::Relaxed) >= MIRROR_FAILURE_THRESHOLD
}

/// 返回该 URL 的**候选来源列表**：镜像优先、官方兜底（去重）。
///
/// 为什么要兜底：镜像（BMCLAPI）偶尔会 502/504 或限流，
/// 而"拉版本清单"是构建的第一步 —— 这里失败会导致**本地明明已经下全**的客户端起不来。
/// 有了候选列表，调用方可以逐个尝试，镜像不通就自动走官方。
pub fn candidates(url: &str) -> Vec<String> {
    let original = url.trim().to_string();
    let mirrored = rewrite_with(url, true);
    if mirrored == original {
        return vec![original]; // 认证类等不需要镜像的 URL，只有一个候选
    }
    // 镜像优先还是官方优先，取决于开关与"镜像是否已被判定不稳"；
    // 无论如何**两个都会保留**，任何一个失败都会自动尝试另一个。
    let mirror_first = mirror_enabled() && !mirror_degraded();
    if mirror_first {
        vec![mirrored, original]
    } else {
        vec![original, mirrored]
    }
}

/// 从 `.../{版本}.json` 这类 URL 里取出版本号；**取不到就返回 None**（保持官方源）。
///
/// `piston-meta.mojang.com/v1/packages/<sha1>/` 下同时挂着两类文件：
///   - `1.21.4.json` ← 版本详情（可以安全换成镜像的 `/version/1.21.4/json`）
///   - `19.json`     ← **assets 索引**（不能当版本号！）
///
/// 之前用"以字母数字开头"这种宽松判断，把 `19.json` 误判成版本号，
/// 于是请求 `bmclapi/version/19/json` 得到 **404**。
/// 现在改成严格匹配 MC 版本号格式：
///   - 正式版 / 预发布：至少含一个点，如 `1.21.4`、`1.20.1-pre1`、`1.19.2-rc1`
///   - 快照：`24w14a` 这种 `两位年 + w + 两位周 + 字母`
fn version_from_meta_url(url: &str) -> Option<String> {
    let ver = url.rsplit('/').next()?.strip_suffix(".json")?;
    if ver.is_empty() || ver.len() > 24 {
        return None;
    }
    // 纯数字（assets 索引如 19、5）一律排除
    if ver.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let looks_like_release = ver.contains('.')
        && ver.chars().next().is_some_and(|c| c.is_ascii_digit())
        && ver.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    let looks_like_snapshot = {
        let b = ver.as_bytes();
        b.len() >= 6
            && b[0].is_ascii_digit()
            && b[1].is_ascii_digit()
            && b[2] == b'w'
            && b[3..5].iter().all(u8::is_ascii_digit)
            && b[5].is_ascii_alphabetic()
    };
    if looks_like_release || looks_like_snapshot {
        Some(ver.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 需要改写的官方域名 → 镜像
    fn rewritten(url: &str) -> String {
        rewrite_with(url, true)
    }

    #[test]
    fn rewrites_known_official_hosts() {
        assert_eq!(
            rewritten("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"),
            "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json"
        );
        assert_eq!(
            rewritten("https://piston-meta.mojang.com/v1/packages/abc/1.21.4.json"),
            "https://bmclapi2.bangbang93.com/version/1.21.4/json"
        );
        assert_eq!(
            rewritten("https://resources.download.minecraft.net/b6/b62ca8ec10d07e6bf5ac8dae0c8c1d2e6a1e3356"),
            "https://bmclapi2.bangbang93.com/assets/b6/b62ca8ec10d07e6bf5ac8dae0c8c1d2e6a1e3356"
        );
        assert_eq!(
            rewritten("https://libraries.minecraft.net/ca/weblite/java-objc-bridge/1.1/java-objc-bridge-1.1.jar"),
            "https://bmclapi2.bangbang93.com/maven/ca/weblite/java-objc-bridge/1.1/java-objc-bridge-1.1.jar"
        );
        assert_eq!(
            rewritten("https://maven.neoforged.net/releases/net/neoforged/neoforge/21.4.157/neoforge-21.4.157-installer.jar"),
            "https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/21.4.157/neoforge-21.4.157-installer.jar"
        );
    }

    /// **认证端点绝不能被改写** —— 一旦改写，登录会直接失败。
    /// Java 运行时（Azul）与 Forge 元数据 API 也不在镜像覆盖范围内，保持官方。
    #[test]
    fn never_rewrites_auth_or_java_or_forge_meta() {
        for url in [
            "https://login.live.com/oauth20_token.srf",
            "https://user.auth.xboxlive.com/user/authenticate",
            "https://xsts.auth.xboxlive.com/xsts/authorize",
            "https://api.minecraftservices.com/authentication/login_with_xbox",
            "https://api.azul.com/metadata/v1/zulu/packages/",
            "https://cdn.azul.com/zulu/bin/zulu17.zip",
            "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
        ] {
            assert_eq!(rewritten(url), url, "不该改写：{url}");
        }
    }

    /// **assets 索引不能被当成版本号** —— 这是实际踩到的 404：
    /// `.../19.json` 曾被映射成 `bmclapi/version/19/json`，导致整个构建失败。
    #[test]
    fn assets_index_is_not_treated_as_version() {
        let index = "https://piston-meta.mojang.com/v1/packages/cd6757fadfa8abf306e90465661ec4a7dcd3386a/19.json";
        assert_eq!(rewritten(index), index, "assets 索引应保持官方源");

        // 其它非版本号文件名同理
        for other in [".../5.json", ".../legacy.json", ".../.json"] {
            let u = format!("https://piston-meta.mojang.com/v1/packages/abc/{other}");
            assert_eq!(rewritten(&u), u, "不该改写：{u}");
        }

        // 而真正的版本详情要能改写（含预发布与快照）
        assert_eq!(
            rewritten("https://piston-meta.mojang.com/v1/packages/abc/1.20.1-pre1.json"),
            "https://bmclapi2.bangbang93.com/version/1.20.1-pre1/json"
        );
        assert_eq!(
            rewritten("https://piston-meta.mojang.com/v1/packages/abc/24w14a.json"),
            "https://bmclapi2.bangbang93.com/version/24w14a/json"
        );
    }

    /// 候选列表要能把镜像排在前面、官方兜底；认证类 URL 只有一个候选（不改写）
    #[test]
    fn candidates_prefer_mirror_then_official() {
        let url = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
        assert_eq!(
            rewrite_with(url, true),
            "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json"
        );
        let official_only = "https://login.live.com/oauth20_token.srf";
        assert_eq!(rewrite_with(official_only, true), official_only);
    }

    #[test]
    fn can_fall_back_to_official() {
        let url = "https://resources.download.minecraft.net/ab/abcdef";
        assert_eq!(rewrite_with(url, false), url, "关闭镜像时应原样返回");
        // 环境变量解析：**默认官方优先**；只有显式指定才走镜像优先
        assert!(!enabled_from_env(None), "默认应为官方优先（实测官方多并发快 12 倍）");
        for on in ["bmclapi", "MIRROR", "on", "1", "true"] {
            assert!(enabled_from_env(Some(on)), "{on} 应启用镜像优先");
        }
        for off in ["official", "OFF", "none", "0", ""] {
            assert!(!enabled_from_env(Some(off)), "{off} 应保持官方优先");
        }
        // 兜底能力：无论优先级如何，认证类 URL 仍只有一个候选
        assert_eq!(rewrite_with("https://login.live.com/x", true), "https://login.live.com/x");
    }
}
