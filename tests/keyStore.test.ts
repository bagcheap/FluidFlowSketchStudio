import { afterEach, describe, expect, it } from 'vitest';
import { clearSessionForTests, forgetKey, keyPlace, loadKey, saveKey, seal, unlockKey, unseal, useKeychainForTests } from '../src/ai/keyStore';

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

afterEach(() => { useKeychainForTests(null); clearSessionForTests(); localStorage.clear(); });
const ENC = 'flowsketch:anthropicKeyEnc';

describe('API key storage', () => {
  it('browser: remembered only encrypted with a passphrase; unlocking needs it; forget removes it', async () => {
    expect(keyPlace()).toBe('browser');
    expect(await saveKey(KEY, false)).toBe('ok');
    expect(localStorage.length).toBe(0);
    expect(await loadKey()).toMatchObject({ key: KEY, remembered: false, locked: false }); // this tab's copy
    expect(await saveKey(KEY, true)).toBe('need-passphrase'); // no passphrase: not stored
    expect(await saveKey(KEY, true, 'short')).toBe('need-passphrase');
    expect(localStorage.getItem(ENC)).toBeNull();
    expect(await saveKey(KEY, true, 'correct horse')).toBe('ok');
    const stored = localStorage.getItem(ENC)!;
    expect(stored).not.toContain(KEY); // never in plain text
    expect(localStorage.getItem(LOCAL)).toBeNull();
    // a new tab: locked until unlocked with the passphrase
    clearSessionForTests();
    expect(await loadKey()).toMatchObject({ key: '', remembered: true, locked: true });
    expect(await unlockKey('wrong passphrase')).toBe('');
    expect(await unlockKey('correct horse')).toBe(KEY);
    expect(await loadKey()).toMatchObject({ key: KEY, remembered: true, locked: false });
    expect(await saveKey(KEY, true)).toBe('ok'); // the same key, already stored: no passphrase needed
    await forgetKey();
    expect(localStorage.length).toBe(0);
    expect(await loadKey()).toMatchObject({ key: '', remembered: false, locked: false });
  }, 30000);

  it('browser: an unencrypted key from an earlier version is removed from storage and kept for this tab', async () => {
    localStorage.setItem(LOCAL, KEY);
    const r = await loadKey();
    expect(r).toMatchObject({ key: KEY, remembered: false, locked: false });
    expect(r.note).toMatch(/unencrypted/);
    expect(localStorage.getItem(LOCAL)).toBeNull();
  });

  it('encryption: a different salt every time, and tampered data does not open', async () => {
    const a = await seal(KEY, 'correct horse'), b = await seal(KEY, 'correct horse');
    expect(a.salt).not.toBe(b.salt); expect(a.data).not.toBe(b.data);
    expect(await unseal(a, 'correct horse')).toBe(KEY);
    const bad = { ...a, data: a.data.slice(0, -4) + (a.data.endsWith('AAA=') ? 'BBB=' : 'AAA=') };
    expect(await unseal(bad, 'correct horse')).toBe('');
  }, 30000);

  it('desktop app: remembered in the Keychain, never in local storage', async () => {
    const kc = fakeKeychain();
    expect(keyPlace()).toBe('keychain');
    expect(await saveKey(KEY, true)).toBe('ok');
    expect(kc.store.get('anthropic-api-key')).toBe(KEY);
    expect(localStorage.getItem(LOCAL)).toBeNull();
    await saveKey('', false); // clears this window's copy too
    await saveKey(KEY, true);
    expect(await loadKey()).toMatchObject({ key: KEY, remembered: true });
    await forgetKey();
    expect(kc.store.size).toBe(0);
    expect(await loadKey()).toMatchObject({ key: '', remembered: false });
  });

  it('desktop app: a key an earlier version left in local storage moves into the Keychain', async () => {
    localStorage.setItem(LOCAL, KEY);
    const kc = fakeKeychain();
    expect(await loadKey()).toMatchObject({ key: KEY, remembered: true });
    expect(kc.store.get('anthropic-api-key')).toBe(KEY);
    expect(localStorage.getItem(LOCAL)).toBeNull();
  });

  it('desktop app: when the Keychain fails, the key is kept for this window only', async () => {
    fakeKeychain(true);
    expect(await saveKey(KEY, true)).toBe('keychain-failed');
    expect(localStorage.getItem(LOCAL)).toBeNull();
    expect(await loadKey()).toMatchObject({ key: KEY, remembered: false });
  });
});
