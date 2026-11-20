// Where the optional Anthropic API key is kept when "Remember" is ticked in the AI dialogs.
// - Desktop app: the macOS Keychain (encrypted by macOS, tied to your login), through the app's own secret_get /
//   secret_set / secret_delete commands (src-tauri/src/lib.rs), which only accept this one secret's name. A key an
//   earlier version left in the app's local storage is moved into the Keychain the first time it is read.
// - Browser: encrypted with a passphrase (PBKDF2-SHA-256, 600,000 rounds → AES-GCM, Web Crypto); only the salt, IV
//   and ciphertext are stored (local storage). The passphrase is never stored. Unlocking puts the key in memory for
//   this tab. A key an earlier version stored unencrypted is removed from storage (and kept for this tab only).
// Without "remember", the key is only kept in memory until the window is closed.
// Nothing here protects against script running in the page while the key is unlocked; the content security policy
// (vite.config.ts / tauri.conf.json) limits where such script could send it.
import { cleanKey } from './describe';
import { isDesktopApp } from '../persistence/native';

const LOCAL = 'flowsketch:anthropicKey'; // the old, unencrypted place (browser and app)
const ENC = 'flowsketch:anthropicKeyEnc'; // the browser's encrypted copy
const SECRET = 'anthropic-api-key';
export const MIN_PASSPHRASE = 8;
const ROUNDS = 600_000;
let sessionKey = '';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
let testInvoke: Invoke | null = null;
/** For tests: pretend to be the desktop app, with this in place of its commands (null = back to normal). */
export function useKeychainForTests(f: Invoke | null) { testInvoke = f; }
/** For tests: forget this tab's copy of the key. */
export function clearSessionForTests() { sessionKey = ''; }

const keychain = () => isDesktopApp || !!testInvoke;
async function invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (testInvoke) return testInvoke(cmd, args);
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke(cmd, args);
}
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const remove = (k: string) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } };

/** Where a remembered key is kept, for the dialog's wording. */
export const keyPlace = (): 'keychain' | 'browser' => (keychain() ? 'keychain' : 'browser');

// ---- the browser's encrypted copy -----------------------------------------------------------------------------------

interface Sealed { v: 1; salt: string; iv: string; data: string }
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function readSealed(): Sealed | null {
  try {
    const o = JSON.parse(get(ENC) ?? 'null');
    const ok = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9+/=]+$/.test(s);
    return o && o.v === 1 && ok(o.salt, 64) && ok(o.iv, 64) && ok(o.data, 4000) ? { v: 1, salt: o.salt, iv: o.iv, data: o.data } : null;
  } catch { return null; }
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ROUNDS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypt the key with a passphrase (exported for tests). */
export async function seal(key: string, passphrase: string): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(passphrase, salt), new TextEncoder().encode(key)));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

/** Decrypt; '' when the passphrase is wrong or the data damaged. */
export async function unseal(s: Sealed, passphrase: string): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, await deriveKey(passphrase, unb64(s.salt)), unb64(s.data));
    return cleanKey(new TextDecoder().decode(plain));
  } catch { return ''; }
}

// ---- what the dialogs use -------------------------------------------------------------------------------------------

export interface KeyState {
  key: string; // '' when locked or none
  remembered: boolean; // a copy is kept on this computer (Keychain, or the browser's encrypted copy)
  locked: boolean; // browser: an encrypted copy exists but hasn't been unlocked in this tab
  note?: string; // something to tell the user (an old unencrypted copy was removed)
}

/** The key to fill in: the remembered one (if unlocked or in the Keychain), else the one typed earlier in this tab. */
export async function loadKey(): Promise<KeyState> {
  const old = cleanKey(get(LOCAL));
  if (keychain()) {
    if (old) {
      try { await invoke('secret_set', { name: SECRET, value: old }); remove(LOCAL); } catch { /* keep it where it is */ }
    }
    try {
      const v = cleanKey(await invoke('secret_get', { name: SECRET }));
      if (v) return { key: v, remembered: true, locked: false };
    } catch { /* Keychain unavailable: fall back to this window's copy */ }
    return { key: sessionKey || cleanKey(get(LOCAL)), remembered: false, locked: false };
  }
  let note: string | undefined;
  if (old) {
    // an unencrypted copy from an earlier version: out of storage, kept for this tab
    remove(LOCAL);
    if (!sessionKey) sessionKey = old;
    note = 'Your remembered key was stored unencrypted, so it has been removed from this browser. It is kept until you close this tab; tick Remember and choose a passphrase to keep it encrypted.';
  }
  const sealed = readSealed();
  if (sessionKey) return { key: sessionKey, remembered: !!sealed, locked: false, note };
  return { key: '', remembered: !!sealed, locked: !!sealed, note };
}

/** Browser: unlock the encrypted copy with its passphrase for this tab. Returns the key, or '' if it didn't open. */
export async function unlockKey(passphrase: string): Promise<string> {
  const s = readSealed();
  if (!s || !passphrase) return '';
  const k = await unseal(s, passphrase);
  if (k) sessionKey = k;
  return k;
}

export type SaveResult = 'ok' | 'keychain-failed' | 'need-passphrase' | 'failed';

/**
 * Keep the key for this window, and remember it on this computer only when asked (otherwise any remembered copy is
 * removed). In the browser, remembering a new or changed key needs a passphrase (≥ MIN_PASSPHRASE characters);
 * the same key that is already stored needs none.
 */
export async function saveKey(key: string, remember: boolean, passphrase = ''): Promise<SaveResult> {
  const prev = sessionKey;
  sessionKey = cleanKey(key);
  remove(LOCAL); // never unencrypted in storage
  if (keychain()) {
    try {
      if (remember && sessionKey) await invoke('secret_set', { name: SECRET, value: sessionKey });
      else await invoke('secret_delete', { name: SECRET });
      return 'ok';
    } catch { return 'keychain-failed'; }
  }
  if (!remember || !sessionKey) { remove(ENC); return 'ok'; }
  const sealed = readSealed();
  if (sealed && !passphrase && sessionKey === prev) return 'ok'; // already stored, unlocked this tab
  if (passphrase.length < MIN_PASSPHRASE) return 'need-passphrase';
  try { localStorage.setItem(ENC, JSON.stringify(await seal(sessionKey, passphrase))); return 'ok'; } catch { return 'failed'; }
}

/** Forget the key: this window's copy and any remembered one. */
export async function forgetKey(): Promise<void> {
  sessionKey = '';
  remove(LOCAL); remove(ENC);
  if (keychain()) { try { await invoke('secret_delete', { name: SECRET }); } catch { /* nothing more to do */ } }
}
