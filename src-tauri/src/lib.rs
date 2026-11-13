// FlowSketch Studio desktop shell: a native window around the same web app that `npm run dev` serves.
// All drawing, storage and export logic stays in the web code; the shell only adds native
// Open/Save dialogs and file writing (see src/persistence/native.ts). The permission to read/write a file you chose
// in a dialog is kept across restarts (persisted scope), so Save can write back to it after the app is reopened.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .run(tauri::generate_context!())
        .expect("error while running FlowSketch");
}
