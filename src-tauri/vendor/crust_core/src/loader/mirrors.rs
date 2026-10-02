use std::time::Duration;

use crate::network::HttpClient;

pub const MIRRORS: [&str; 6] = [
    "https://maven.minecraftforge.net",
    "https://maven.neoforged.net/releases",
    "https://maven.creeperhost.net",
    "https://libraries.minecraft.net",
    // 国内镜像放前面：与 mirror::rewrite 的目标一致，测速时优先命中
    "https://bmclapi2.bangbang93.com/maven",
    "https://repo1.maven.org/maven2",
];

pub async fn check_url(http: &HttpClient, url: &str, timeout: Duration) -> Option<u64> {
    http.head(url, timeout).await
}

pub async fn check_mirror(
    http: &HttpClient,
    base: &str,
    timeout: Duration,
) -> Option<(String, u64)> {
    for mirror in MIRRORS {
        let url = format!("{mirror}/{base}");
        if let Some(size) = check_url(http, &url, timeout).await {
            return Some((url, size));
        }
    }
    None
}
