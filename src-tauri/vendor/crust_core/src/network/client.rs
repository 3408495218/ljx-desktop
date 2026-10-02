use serde::Serialize;
use serde::de::DeserializeOwned;

use super::Error;

const USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone)]
pub struct HttpClient {
    inner: reqwest::Client,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

impl HttpClient {
    pub fn new() -> Result<Self, Error> {
        // 关键：给连接与整体请求都设上限，让"某个源不可用"时能**快速失败**并切到备用源。
        // 不加超时时，镜像偶发丢包/握手失败会让单个文件干等几十秒 —— 实测过，
        // 这种"等待"比下载本身还慢，表现为"整体极其缓慢"。
        let inner = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(std::time::Duration::from_secs(8))
            .timeout(std::time::Duration::from_secs(120))
            .pool_max_idle_per_host(64)
            .build()
            .map_err(Error::Build)?;
        Ok(Self { inner })
    }

    pub fn from_reqwest(inner: reqwest::Client) -> Self {
        Self { inner }
    }

    pub fn inner(&self) -> &reqwest::Client {
        &self.inner
    }

    pub async fn head(&self, url: &str, timeout: std::time::Duration) -> Option<u64> {
        let response = self.inner.head(url).timeout(timeout).send().await.ok()?;
        if response.status().as_u16() != 200 {
            return None;
        }
        Some(response.content_length().unwrap_or(0))
    }

    pub async fn get(&self, url: &str, bearer: Option<&str>) -> Result<Response, Error> {
        // 逐个尝试候选源（镜像优先、官方兜底），并带重试。
        //
        // 这里刻意做得"啰嗦"：拉版本清单/详情是构建的第一步，而镜像偶尔会 502/504，
        // 一旦这一步挂掉，本地明明已经下全的客户端也起不来（实际遇到过）。
        let candidates = crate::mirror::candidates(url);
        let mut last_error: Option<Error> = None;
        for (idx, candidate) in candidates.iter().enumerate() {
            for attempt in 0..2 {
                let mut request = self.inner.get(candidate).header("Accept", "application/json");
                if let Some(token) = bearer {
                    request = request.bearer_auth(token);
                }
                match Self::collect(request).await {
                    Ok(resp) => return Ok(resp),
                    Err(e) => {
                        last_error = Some(e);
                        if attempt == 0 {
                            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                        }
                    }
                }
            }
            let _ = idx; // 镜像失败后继续尝试下一个候选（官方源）
        }
        // 理论上到不了这里（候选至少一个、每个重试两次）；兜底用 status=0 表示"所有来源都失败"
        Err(last_error.unwrap_or(Error::Status {
            status: 0,
            url: url.to_string(),
        }))
    }

    pub async fn post_json<B: Serialize + ?Sized>(
        &self,
        url: &str,
        body: &B,
        bearer: Option<&str>,
    ) -> Result<Response, Error> {
        let mut request = self
            .inner
            .post(url)
            .header("Accept", "application/json")
            .json(body);
        if let Some(token) = bearer {
            request = request.bearer_auth(token);
        }
        Self::collect(request).await
    }

    pub async fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Response, Error> {
        let request = self
            .inner
            .post(url)
            .header("Accept", "application/json")
            .form(form);
        Self::collect(request).await
    }

    async fn collect(request: reqwest::RequestBuilder) -> Result<Response, Error> {
        let response = request.send().await?;
        let status = response.status().as_u16();
        let body = response.text().await?;
        Ok(Response { status, body })
    }
}

impl Response {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn json<T: DeserializeOwned>(&self) -> Result<T, Error> {
        Ok(serde_json::from_str(&self.body)?)
    }
}
