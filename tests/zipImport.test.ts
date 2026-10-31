import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { detectVendor, importZipBytes, planPack } from '../src/icons/zipImport';
import { sanitizeLibrary } from '../src/icons/libraries';

const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/></svg>`;
// jsdom's TextEncoder returns typed arrays from another realm, which fflate doesn't recognise; copy them
// into this realm's Uint8Array (real browsers have one realm, so the app needs no such step)
const u8 = (v: string | Uint8Array) => new Uint8Array(typeof v === 'string' ? strToU8(v) : v);
const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, u8(v)])));

// laid out like AWS's Asset-Package download (sizes, light/dark variants, macOS metadata, a non-SVG)
const AWS = {
  'Asset-Package_07312025/Architecture-Service-Icons_07312025/Arch_Compute/32/Arch_Amazon-EC2_32.svg': svg('#ed7100'),
  'Asset-Package_07312025/Architecture-Service-Icons_07312025/Arch_Compute/64/Arch_Amazon-EC2_64.svg': svg('#ed7100'),
  'Asset-Package_07312025/Architecture-Service-Icons_07312025/Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg': svg('#7aa116'),
  'Asset-Package_07312025/Resource-Icons_07312025/Res_Compute/Res_Amazon-EC2_Instance_48_Light.svg': svg('#ed7100'),
  'Asset-Package_07312025/Resource-Icons_07312025/Res_Compute/Res_Amazon-EC2_Instance_48_Dark.svg': svg('#ffffff'),
  'Asset-Package_07312025/Architecture-Service-Icons_07312025/Arch_Compute/64/Arch_AWS-Lambda_64.png': 'not an svg',
  '__MACOSX/Asset-Package_07312025/._Arch_Amazon-EC2_64.svg': 'junk',
  'Asset-Package_07312025/Architecture-Service-Icons_07312025/Arch_Security/64/Arch_Evil_64.svg': '<svg viewBox="0 0 64 64" onload="alert(1)"><script>alert(1)</script><circle cx="32" cy="32" r="20" fill="#dd344c"/></svg>',
};

describe('cloud provider packages', () => {
  it('picks one SVG per icon (largest size, light variant), with clean names and categories', () => {
    const picks = planPack(Object.keys(AWS));
    expect(picks.map((p) => [p.category, p.name])).toEqual([
      ['Compute', 'amazon-ec2'], ['Compute', 'amazon-ec2-instance'], ['Security', 'evil'], ['Storage', 'amazon-simple-storage-service'],
    ]);
    expect(picks.find((p) => p.name === 'amazon-ec2')!.path).toContain('/64/');
    expect(picks.find((p) => p.name === 'amazon-ec2-instance')!.path).toMatch(/_Light\.svg$/);
  });

  it('recognises each provider from its layout', () => {
    expect(detectVendor(Object.keys(AWS), 'Asset-Package_07312025.zip')).toBe('aws');
    expect(detectVendor(['Azure_Public_Service_Icons/Icons/compute/10021-icon-service-Virtual-Machine.svg'], 'icons.zip')).toBe('azure');
    expect(detectVendor(['icons/compute/compute-engine.svg'], 'google-cloud-icons.zip')).toBe('gcp');
    expect(detectVendor(['team/a.svg'], 'team.zip')).toBeNull();
  });

  it('imports an AWS-style package as a library that follows AWS terms', async () => {
    const r = await importZipBytes(zip(AWS), 'Asset-Package_07312025.zip');
    expect(r.vendor).toBe('aws');
    expect(r.libraryName).toBe('AWS Architecture Icons');
    expect(r.items.map((i) => i.name)).toEqual(['amazon-ec2', 'amazon-ec2-instance', 'evil', 'amazon-simple-storage-service']);
    expect(JSON.stringify(r.items)).not.toMatch(/script|alert|onload/);
    const lib = sanitizeLibrary({ name: r.libraryName, vendor: r.vendor, items: r.items }, 'aws1')!;
    expect(lib.vendor).toBe('aws');
    expect(lib.items[0]).toMatchObject({ name: 'amazon-ec2', category: 'Compute', icon: { id: 'lib-aws1:amazon-ec2', set: 'AWS Architecture Icons', license: 'AWS terms' } });
  });

  it('reads Azure-style names, ZIPs inside ZIPs, and plain ZIPs of SVGs', async () => {
    const azure = await importZipBytes(zip({ 'Azure_Public_Service_Icons/Icons/compute/10021-icon-service-Virtual-Machine.svg': svg('#0078d4') }), 'Azure_Public_Service_Icons_V21.zip');
    expect(azure).toMatchObject({ vendor: 'azure', libraryName: 'Azure Icons', items: [{ name: 'virtual-machine', category: 'Compute' }] });
    const nested = await importZipBytes(zip({ 'pack/inner.zip': zip({ 'shapes/box.svg': svg('#000000') }) }), 'outer.zip');
    expect(nested.items.map((i) => [i.category, i.name])).toEqual([['Shapes', 'box']]);
    const plain = await importZipBytes(zip({ 'team/service.svg': svg('#7048e8'), 'readme.txt': 'hi' }), 'Team Icons.zip');
    expect(plain).toMatchObject({ vendor: null, libraryName: 'Team Icons', items: [{ name: 'service', category: 'Team' }] });
    await expect(importZipBytes(zip({ 'readme.txt': 'hi' }), 'empty.zip')).rejects.toThrow(/no SVG icons/);
    await expect(importZipBytes(u8('not a zip'), 'bad.zip')).rejects.toThrow(/could not be read/);
  });
});
