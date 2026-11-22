//! Silent self-update for Harbor Frame Generation.
//!
//! The front end finds a newer GitHub release and calls `selfupdate_stage`:
//! the installer is downloaded in the background (progress goes out as
//! `selfupdate-progress`), its SHA-256 checked against the one GitHub
//! publishes, and the installer runs silently when Harbor closes.
//! `selfupdate_install_now` starts it right away (with /R, so it opens
//! Harbor again when done) and exits.

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use std::path::PathBuf;
use tauri::Emitter;

/// The installer downloaded this session, ready to run.
static STAGED: Mutex<Option<PathBuf>> = Mutex::new(None);

const ALLOWED_PREFIX: &str = "https://github.com/abogzah559-wq/harbor-frame-generation/releases/download/";

#[tauri::command]
pub async fn selfupdate_stage(app: tauri::AppHandle, url: String, sha256: Option<String>, tag: String) -> Result<String, String> {
    if !url.starts_with(ALLOWED_PREFIX) || !url.ends_with(".exe") {
        return Err("refusing an installer from outside this project's releases".into());
    }
    let safe_tag: String = tag.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '.').collect();
    let dir = std::env::temp_dir().join("harbor-update");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join(format!("Harbor-setup-{}.exe", safe_tag));
    let part = path.with_extension("part");

    // Older downloads are no longer needed (each one is a few hundred MB).
    if let Ok(mut rd) = tokio::fs::read_dir(&dir).await {
        let keep = format!("Harbor-setup-{}.", safe_tag);
        while let Ok(Some(e)) = rd.next_entry().await {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("Harbor-setup-") && !name.starts_with(&keep) {
                let _ = tokio::fs::remove_file(e.path()).await;
            }
        }
    }

    // Already downloaded by an earlier run: check it and reuse it instead of
    // downloading the whole installer again.
    if tokio::fs::metadata(&path).await.map(|m| m.len() > 0).unwrap_or(false) {
        let ok = match sha256.as_deref().map(|w| w.trim_start_matches("sha256:").to_ascii_lowercase()) {
            Some(want) if !want.is_empty() => sha256_of_file(&path).await.map(|got| got == want).unwrap_or(false),
            _ => true,
        };
        if ok {
            *STAGED.lock().unwrap() = Some(path.clone());
            let len = tokio::fs::metadata(&path).await.map(|m| m.len()).unwrap_or(0);
            let _ = app.emit("selfupdate-progress", (len, len));
            return Ok(path.to_string_lossy().to_string());
        }
        let _ = tokio::fs::remove_file(&path).await;
    }

    let client = reqwest::Client::builder()
        .user_agent("HarborFrameGeneration-updater")
        .build()
        .map_err(|e| e.to_string())?;

    // Download in parallel pieces that survive a restart: a single stream
    // from GitHub is slow on many connections, and closing Harbor used to
    // throw away everything downloaded so far.
    let parallel = download_in_pieces(&app, &client, &url, &part).await;
    if let Err(e) = parallel {
        eprintln!("[selfupdate] parallel download unavailable ({e}), using one stream");
        download_single(&app, &client, &url, &part).await?;
    }

    let got = sha256_of_file(&part).await?;
    if let Some(want) = sha256.as_deref() {
        let want = want.trim_start_matches("sha256:").to_ascii_lowercase();
        if !want.is_empty() && want != got {
            let _ = tokio::fs::remove_file(&part).await;
            let _ = tokio::fs::remove_file(pieces_file(&part)).await;
            return Err("installer checksum mismatch".into());
        }
    }
    let _ = tokio::fs::remove_file(pieces_file(&part)).await;
    let _ = tokio::fs::remove_file(&path).await;
    tokio::fs::rename(&part, &path).await.map_err(|e| e.to_string())?;

    *STAGED.lock().unwrap() = Some(path.clone());
    Ok(path.to_string_lossy().to_string())
}

/// Install the staged update now: Harbor exits, the helper started by
/// `selfupdate_stage` installs it and opens Harbor again.
#[tauri::command]
pub fn selfupdate_install_now(app: tauri::AppHandle) -> Result<(), String> {
    let staged = STAGED.lock().unwrap().take().ok_or("no update downloaded")?;
    crate::shutdown_services(&app);
    // /R: the installer opens Harbor again when it is done. It also closes
    // anything of Harbor's still running, so it can start before we exit.
    spawn_installer(&staged, true)?;
    app.exit(0);
    Ok(())
}

/// Install a downloaded update while Harbor closes (no restart).
pub fn install_staged_on_exit() {
    if let Some(p) = STAGED.lock().unwrap().take() {
        if let Err(e) = spawn_installer(&p, false) {
            eprintln!("[selfupdate] could not start the installer: {e}");
        }
    }
}

/// Run the installer silently, fully detached from Harbor so it survives
/// Harbor exiting. (The old hidden PowerShell helper was often stopped
/// before it got to run the installer, so updates never installed.)
fn spawn_installer(installer: &std::path::Path, relaunch: bool) -> Result<(), String> {
    let mut args = vec!["/S"];
    if relaunch {
        args.push("/R");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let first = std::process::Command::new(installer)
            .args(&args)
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB)
            .spawn();
        if first.is_ok() {
            return Ok(());
        }
        // Breaking away from a job is not always allowed; try without it.
        std::process::Command::new(installer)
            .args(&args)
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(installer).args(&args).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

const PIECE: u64 = 4 * 1024 * 1024;
const WORKERS: usize = 8;

fn pieces_file(part: &std::path::Path) -> PathBuf {
    part.with_extension("pieces")
}

/// Total size of the file behind `url`, if the server accepts byte ranges.
async fn ranged_size(client: &reqwest::Client, url: &str) -> Result<u64, String> {
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("no range support (HTTP {})", resp.status()));
    }
    let cr = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .ok_or("no content-range")?
        .to_string();
    cr.rsplit('/').next().and_then(|t| t.trim().parse::<u64>().ok()).filter(|n| *n > 0).ok_or_else(|| "bad content-range".into())
}

async fn download_in_pieces(app: &tauri::AppHandle, client: &reqwest::Client, url: &str, part: &std::path::Path) -> Result<(), String> {
    let total = ranged_size(client, url).await?;
    let count = total.div_ceil(PIECE);
    let record = pieces_file(part);

    // Pieces finished by an earlier run, kept only if the file has the same size.
    let mut done_set: BTreeSet<u64> = BTreeSet::new();
    let same_size = tokio::fs::metadata(part).await.map(|m| m.len() == total).unwrap_or(false);
    if same_size {
        if let Ok(txt) = tokio::fs::read_to_string(&record).await {
            if let Some((size, list)) = txt.split_once('\n') {
                if size.trim().parse::<u64>().ok() == Some(total) {
                    done_set.extend(list.split(',').filter_map(|x| x.trim().parse::<u64>().ok()).filter(|i| *i < count));
                }
            }
        }
    } else {
        let f = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
        f.set_len(total).await.map_err(|e| e.to_string())?;
        done_set.clear();
    }

    let done_bytes = Arc::new(AtomicU64::new(
        done_set.iter().map(|i| (total - i * PIECE).min(PIECE)).sum(),
    ));
    let todo: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new((0..count).rev().filter(|i| !done_set.contains(i)).collect()));
    let finished = Arc::new(Mutex::new(done_set));
    let record_lock = Arc::new(tokio::sync::Mutex::new(()));
    let _ = app.emit("selfupdate-progress", (done_bytes.load(Ordering::Relaxed), total));

    let mut tasks = Vec::new();
    for _ in 0..WORKERS {
        let client = client.clone();
        let url = url.to_string();
        let part = part.to_path_buf();
        let record = record.clone();
        let todo = todo.clone();
        let finished = finished.clone();
        let done_bytes = done_bytes.clone();
        let record_lock = record_lock.clone();
        let app = app.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                let Some(idx) = todo.lock().unwrap().pop() else { return Ok::<(), String>(()) };
                let start = idx * PIECE;
                let end = (start + PIECE).min(total) - 1;
                let mut attempt = 0;
                loop {
                    attempt += 1;
                    match fetch_piece(&client, &url, &part, start, end).await {
                        Ok(()) => break,
                        Err(e) if attempt < 4 => {
                            eprintln!("[selfupdate] piece {idx} failed ({e}), retrying");
                            tokio::time::sleep(std::time::Duration::from_millis(800 * attempt)).await;
                        }
                        Err(e) => return Err(e),
                    }
                }
                let now = done_bytes.fetch_add(end - start + 1, Ordering::Relaxed) + (end - start + 1);
                {
                    let _guard = record_lock.lock().await;
                    let line = {
                        let mut f = finished.lock().unwrap();
                        f.insert(idx);
                        format!("{total}\n{}", f.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(","))
                    };
                    let _ = tokio::fs::write(&record, line).await;
                }
                let _ = app.emit("selfupdate-progress", (now, total));
            }
        }));
    }
    for t in tasks {
        t.await.map_err(|e| e.to_string())??;
    }
    Ok(())
}

async fn fetch_piece(client: &reqwest::Client, url: &str, part: &std::path::Path, start: u64, end: u64) -> Result<(), String> {
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 != end - start + 1 {
        return Err("short piece".into());
    }
    let mut f = tokio::fs::OpenOptions::new().write(true).open(part).await.map_err(|e| e.to_string())?;
    f.seek(std::io::SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;
    f.write_all(&bytes).await.map_err(|e| e.to_string())?;
    f.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn download_single(app: &tauri::AppHandle, client: &reqwest::Client, url: &str, part: &std::path::Path) -> Result<(), String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut done: u64 = 0;
    let mut last_pct: u64 = u64::MAX;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        let pct = if total > 0 { done * 100 / total } else { 0 };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit("selfupdate-progress", (done, total));
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn sha256_of_file(path: &std::path::Path) -> Result<String, String> {
    let mut f = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}
