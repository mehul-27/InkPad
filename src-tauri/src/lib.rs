// Phase 2: file operations. All disk access lives here; the frontend only
// passes paths and content through these commands.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

const RECENT_LIMIT: usize = 10;

fn recent_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("recent.json"))
}

fn read_recent(app: &AppHandle) -> Vec<String> {
    let Some(path) = recent_path(app) else {
        return vec![];
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return vec![];
    };
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

fn write_recent(app: &AppHandle, paths: &[String]) {
    let Some(path) = recent_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let Ok(raw) = serde_json::to_string_pretty(paths) else {
        return;
    };
    let _ = fs::write(path, raw);
}

/// First existing file in argv — how Windows delivers "open with InkPad".
/// argv[0] is the executable itself, so skip it.
fn file_arg_from(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| {
            let p = PathBuf::from(a);
            p.exists() && p.is_file()
        })
        .cloned()
}

#[tauri::command]
fn get_startup_file() -> Option<String> {
    file_arg_from(&std::env::args().collect::<Vec<_>>())
}

#[tauri::command]
fn get_recent_files(app: AppHandle) -> Vec<String> {
    read_recent(&app)
        .into_iter()
        // remove missing files gracefully
        .filter(|p| fs::metadata(p).map(|m| m.is_file()).unwrap_or(false))
        .collect()
}

#[tauri::command]
fn add_recent_file(app: AppHandle, path: String) {
    let mut paths = read_recent(&app);
    paths.retain(|p| p != &path);
    paths.insert(0, path);
    paths.truncate(RECENT_LIMIT);
    write_recent(&app, &paths);
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    // ponytail: plain write for now; atomic (temp + rename) write lands in
    // Phase 4 with autosave, per the spec's development order.
    fs::write(&path, content).map_err(|e| format!("Could not save {path}: {e}"))
}

#[tauri::command]
fn reveal_in_explorer(path: String) {
    #[cfg(windows)]
    let _ = std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn();
}

// ---- Phase 3: local image loading for the Markdown Reader ----

/// Cap on decoded image bytes; larger files are skipped (quiet placeholder).
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(serde::Serialize)]
struct ImageData {
    mime: String,
    data: String,
}

fn mime_for(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
fn read_image_data(path: String) -> Option<ImageData> {
    use base64::Engine;
    let meta = fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    Some(ImageData {
        mime: mime_for(&path).to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = file_arg_from(&argv) {
                let _ = app.emit("open-file", path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            get_recent_files,
            add_recent_file,
            read_text_file,
            write_text_file,
            reveal_in_explorer,
            read_image_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
