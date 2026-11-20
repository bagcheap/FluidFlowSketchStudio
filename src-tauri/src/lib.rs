// FlowSketch Studio desktop shell: a native window around the same web app that `npm run dev` serves.
// All drawing, storage and export logic stays in the web code; the shell only adds native
// Open/Save dialogs and file writing (see src/persistence/native.ts). The permission to read/write a file you chose
// in a dialog is kept across restarts (persisted scope), so Save can write back to it after the app is reopened.
// It also keeps the optional Anthropic API key in the macOS Keychain (see src/ai/keyStore.ts), never in a file.

/** Keychain service name; the only secret the app may store is listed in SECRETS. */
const SERVICE: &str = "local.flowsketch.studio";
const SECRETS: &[&str] = &["anthropic-api-key"];
const MAX_SECRET: usize = 1000;

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !SECRETS.contains(&name) {
        return Err("unknown secret".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

/// The stored secret, or None when there is none.
#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Store a secret (replacing any earlier one).
#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_SECRET {
        return Err("bad secret".into());
    }
    entry(&name)?.set_password(&value).map_err(|e| e.to_string())
}

/// Remove a secret (fine when there is none).
#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete])
        .run(tauri::generate_context!())
        .expect("error while running FlowSketch");
}
