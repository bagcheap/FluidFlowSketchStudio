// Where the optional Anthropic API key is kept when "Remember" is ticked in the AI dialogs.
// - Desktop app: the macOS Keychain (encrypted by macOS, tied to your login), through the app's own secret_get /
//   secret_set / secret_delete commands (src-tauri/src/lib.rs), which only accept this one secret's name. A key an
//   earlier version left in the app's local storage is moved into the Keychain the first time it is read.
// - Browser: local storage, unencrypted (the dialog says so). Readable by anyone who can read this browser profile.
// Without "remember", the key is only kept in memory until the window is closed.
import { cleanKey } from './describe';
import { isDesktopApp } from '../persistence/native';

const LOCAL = 'flowsketch:anthropicKey';
const SECRET = 'anthropic-api-key';
let sessionKey = '';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
let testInvoke: Invoke | null = null;
/** For tests: pretend to be the desktop app, with this in place of its commands (null = back to normal). */
export function useKeychainForTests(f: Invoke | null) { testInvoke = f; }

const keychain = () => isDesktopApp || !!testInvoke;
async function invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (testInvoke) return testInvoke(cmd, args);
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke(cmd, args);
}
const readLocal = () => { try { return cleanKey(localStorage.getItem(LOCAL)); } catch { return ''; } };
const removeLocal = () => { try { localStorage.removeItem(LOCAL); } catch { /* storage unavailable */ } };

/** Where a remembered key is kept, for the dialog's wording. */
export const keyPlace = (): 'keychain' | 'browser' => (keychain() ? 'keychain' : 'browser');

/** The key to fill in: the remembered one, else the one typed earlier in this window. */
export async function loadKey(): Promise<{ key: string; remembered: boolean }> {
  if (keychain()) {
    const old = readLocal();
    if (old) {
      try { await invoke('secret_set', { name: SECRET, value: old }); removeLocal(); } catch { /* keep it where it is */ }
    }
    try {
      const v = cleanKey(await invoke('secret_get', { name: SECRET }));
      if (v) return { key: v, remembered: true };
    } catch { /* Keychain unavailable: fall back to this window's copy */ }
    return { key: sessionKey || readLocal(), remembered: !!readLocal() };
  }
  const v = readLocal();
  return v ? { key: v, remembered: true } : { key: sessionKey, remembered: false };
}

/**
 * Keep the key for this window, and remember it on this computer only when asked (otherwise any remembered copy is
 * removed). Returns false if the Keychain could not be used (the key then stays for this window only).
 */
export async function saveKey(key: string, remember: boolean): Promise<boolean> {
  sessionKey = cleanKey(key);
  if (keychain()) {
    removeLocal(); // never in local storage in the app
    try {
      if (remember && sessionKey) await invoke('secret_set', { name: SECRET, value: sessionKey });
      else await invoke('secret_delete', { name: SECRET });
      return true;
    } catch { return false; }
  }
  try { if (remember && sessionKey) localStorage.setItem(LOCAL, sessionKey); else removeLocal(); } catch { return false; }
  return true;
}

/** Forget the key: this window's copy and any remembered one. */
export async function forgetKey(): Promise<boolean> { return saveKey('', false); }
