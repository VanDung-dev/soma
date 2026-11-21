use std::io::Cursor;
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};

use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::header;
use reqwest::{Client, Url, redirect::Policy};
use tiny_http::{Header, Method, Request, Response, Server};

const FRAME: &str = include_str!("../../scripts/wikipedia-frame.html");
const FRAME_CSP: &str = include_str!("../../scripts/wikipedia-frame.csp");
const ERROR_PAGE: &str = "<!doctype html><html lang=\"vi\"><head><meta charset=\"utf-8\"></head><body><p>Không tải được Wikipedia</p></body></html>";
const ERROR_CSP: &str = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; base-uri https://*.wikipedia.org";
static HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<head(?:\s[^>]*)?>").unwrap());
static HOST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]*\.wikipedia\.org$").unwrap());

pub struct Proxy(Option<String>);

impl Proxy {
    pub fn start() -> Self {
        Self(start_server())
    }
}

#[tauri::command]
pub fn wikipedia_proxy_url(proxy: tauri::State<'_, Proxy>) -> Option<String> {
    proxy.0.clone()
}

fn start_server() -> Option<String> {
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .user_agent("Soma/0.1 (Wikipedia article reader)")
        .build()
        .ok()?;
    let mut token = [0; 16];
    getrandom::fill(&mut token).ok()?;
    let path = format!("/{:032x}/wikipedia", u128::from_be_bytes(token));
    let server = Server::http(("127.0.0.1", 0)).ok()?;
    let host = server.server_addr().to_ip()?.to_string();
    let url = format!("http://{host}{path}");
    thread::Builder::new()
        .name("wikipedia-proxy".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                let host_matches = request
                    .headers()
                    .iter()
                    .any(|header| header.field.equiv("Host") && header.value.as_str() == host);
                if !host_matches || request.url().split('?').next() != Some(path.as_str()) {
                    let _ = request.respond(Response::empty(404));
                    continue;
                }
                let client = client.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let response = tauri::async_runtime::block_on(proxy(&request, &client));
                    let _ = request.respond(response);
                });
            }
        })
        .ok()?;
    Some(url)
}

fn valid_encoding(value: &str) -> bool {
    value
        .as_bytes()
        .split(|&byte| byte == b'%')
        .skip(1)
        .all(|part| {
            part.get(..2)
                .is_some_and(|hex| hex.iter().all(u8::is_ascii_hexdigit))
        })
        && percent_decode_str(value).decode_utf8().is_ok()
}

fn wikipedia_url(mut url: Url) -> Option<Url> {
    if url.scheme() != "https"
        || !url.host_str().is_some_and(|host| HOST.is_match(host))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !url.path().starts_with("/wiki/")
        || url.path() == "/wiki/"
        || !valid_encoding(url.path())
        || !valid_encoding(url.fragment().unwrap_or_default())
        || url
            .query_pairs()
            .any(|(key, _)| key != "useskin" && key != "variant")
    {
        return None;
    }
    remove_skin(&mut url);
    url.query_pairs_mut().append_pair("useskin", "vector-2022");
    Some(url)
}

fn remove_skin(url: &mut Url) {
    let query: Vec<_> = url
        .query_pairs()
        .into_owned()
        .filter(|(key, _)| key != "useskin")
        .collect();
    url.set_query(None);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
}

fn redirect_url(source: &Url, location: &str) -> Option<Url> {
    let mut target = wikipedia_url(source.join(location).ok()?)?;
    if target.fragment().is_none() {
        target.set_fragment(source.fragment());
    }
    Some(target)
}

fn html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

fn wikipedia_page(mut html: String, source: &Url) -> Option<String> {
    let head = HEAD.find(&html)?.end();
    let mut base = source.clone();
    base.set_fragment(None);
    remove_skin(&mut base);
    let frame = FRAME
        .replacen("{{source}}", &html_attribute(source.as_str()), 1)
        .replacen("{{base}}", &html_attribute(base.as_str()), 1);
    html.insert_str(head, &frame);
    Some(html)
}

async fn fetch_page(client: &Client, source: &mut Url) -> Option<String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    for redirects in 0..=5 {
        let response = client
            .get(source.clone())
            .timeout(deadline.checked_duration_since(Instant::now())?)
            .send()
            .await
            .ok()?;
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if redirects == 5 {
                return None;
            }
            let location = response.headers().get(header::LOCATION)?.to_str().ok()?;
            *source = redirect_url(source, location)?;
            continue;
        }
        let mime = response
            .headers()
            .get(header::CONTENT_TYPE)?
            .to_str()
            .ok()?;
        if response.status().is_success() && mime.contains("text/html") {
            return wikipedia_page(response.text().await.ok()?, source);
        }
        return None;
    }
    None
}

async fn proxy(request: &Request, client: &Client) -> Response<Cursor<Vec<u8>>> {
    if request.method() != &Method::Get {
        return Response::from_string("")
            .with_status_code(405)
            .with_header(response_header("Allow", "GET"));
    }
    let source = Url::parse(&format!("http://127.0.0.1{}", request.url()))
        .ok()
        .and_then(|url| {
            let (_, value) = url.query_pairs().find(|(key, _)| key == "url")?;
            wikipedia_url(Url::parse(&value).ok()?)
        });
    let Some(mut source) = source else {
        return Response::from_string("Liên kết Wikipedia không hợp lệ.").with_status_code(400);
    };
    let (status, csp, html) = match fetch_page(client, &mut source).await {
        Some(html) => (200, FRAME_CSP.trim(), html),
        None => (
            502,
            ERROR_CSP,
            wikipedia_page(ERROR_PAGE.into(), &source).unwrap(),
        ),
    };
    Response::from_string(html)
        .with_status_code(status)
        .with_header(response_header("Content-Type", "text/html; charset=utf-8"))
        .with_header(response_header("Cache-Control", "no-store"))
        .with_header(response_header("Referrer-Policy", "no-referrer"))
        .with_header(response_header("X-Content-Type-Options", "nosniff"))
        .with_header(response_header("Content-Security-Policy", csp))
}

fn response_header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restricts_redirects_and_wraps_the_original_vector_page() {
        let source =
            wikipedia_url(Url::parse("https://en.wikipedia.org/wiki/Alias#Humans").unwrap())
                .unwrap();
        for location in [
            "https://example.com/wiki/Skeleton",
            "https://en.wikipedia.org.example.com/wiki/Skeleton",
            "/w/api.php",
            "/wiki/Skeleton?action=edit",
            "/wiki/Skeleton#%ZZ",
        ] {
            assert!(redirect_url(&source, location).is_none(), "{location}");
        }
        let target = redirect_url(&source, "/wiki/Skeleton?variant=en").unwrap();
        let original = r#"<html><head></head><body><input id="vector-page-titlebar-toc-checkbox"></body></html>"#;
        let page = wikipedia_page(original.into(), &target).unwrap();
        assert!(
            page.contains(r#"<base href="https://en.wikipedia.org/wiki/Skeleton?variant=en">"#)
        );
        assert!(page.contains(r#"data-source="https://en.wikipedia.org/wiki/Skeleton?variant=en&amp;useskin=vector-2022#Humans""#));
        assert!(page.contains(r#"<input id="vector-page-titlebar-toc-checkbox">"#));
        assert!(
            FRAME_CSP.starts_with("sandbox allow-scripts")
                && !FRAME_CSP.contains("allow-same-origin")
        );
    }
}
