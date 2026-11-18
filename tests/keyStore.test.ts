import { afterEach, describe, expect, it } from 'vitest';
import { forgetKey, keyPlace, loadKey, saveKey, useKeychainForTests } from '../src/ai/keyStore';

const KEY = 'sk-ant-test-0123456789';
const LOCAL = 'flowsketch:anthropicKey';

/** A fake of the desktop app's Keychain commands. */
function fakeKeychain(fail = false) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  useKeychainForTests(async (cmd, args) => {
    calls.push(cmd);
    if (fail) throw new Error('keychain locked');
    const name = String(args?.name);
    if (name !== 'anthropic-api-key') throw new Error('unknown secret');
    if (cmd === 'secret_get') return store.get(name) ?? null;
    if (cmd === 'secret_set') { store.set(name, String(args?.value)); return null; }
    if (cmd === 'secret_delete') { store.delete(name); return null; }
    throw new Error('unknown command');
  });
  return { store, calls };
}

afterEach(() => { useKeychainForTests(null); localStorage.clear(); });

describe('API key storage', () => {
  it('browser: only remembered when asked, in local storage; forget removes it', async () => {
    expect(keyPlace()).toBe('browser');
    await saveKey(KEY, false);
    expect(localStorage.getItem(LOCAL)).toBeNull();
    expect(await loadKey()).toEqual({ key: KEY, remembered: false }); // this window's copy
    await saveKey(KEY, true);
    expect(localStorage.getItem(LOCAL)).toBe(KEY);
    expect(await loadKey()).toEqual({ key: KEY, remembered: true });
    await forgetKey();
    expect(localStorage.getItem(LOCAL)).toBeNull();
    expect(await loadKey()).toEqual({ key: '', remembered: false });
  });

  it('desktop app: remembered in the Keychain, never in local storage', async () => {
    const kc = fakeKeychain();
    expect(keyPlace()).toBe('keychain');
    expect(await saveKey(KEY, true)).toBe(true);
    expect(kc.store.get('anthropic-api-key')).toBe(KEY);
    expect(localStorage.getItem(LOCAL)).toBeNull();
    await saveKey('', false); // clears this window's copy too
    await saveKey(KEY, true);
    expect(await loadKey()).toEqual({ key: KEY, remembered: true });
    await forgetKey();
    expect(kc.store.size).toBe(0);
    expect(await loadKey()).toEqual({ key: '', remembered: false });
  });

  it('desktop app: a key an earlier version left in local storage moves into the Keychain', async () => {
    localStorage.setItem(LOCAL, KEY);
    const kc = fakeKeychain();
    expect(await loadKey()).toEqual({ key: KEY, remembered: true });
    expect(kc.store.get('anthropic-api-key')).toBe(KEY);
    expect(localStorage.getItem(LOCAL)).toBeNull();
  });

  it('desktop app: when the Keychain fails, the key is kept for this window only', async () => {
    fakeKeychain(true);
    expect(await saveKey(KEY, true)).toBe(false);
    expect(localStorage.getItem(LOCAL)).toBeNull();
    expect(await loadKey()).toEqual({ key: KEY, remembered: false });
  });
});
