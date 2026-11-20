import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The production build gets the same content security policy as the desktop app's window (one source: the "csp" in
 * src-tauri/tauri.conf.json), as a <meta> tag: the page may only load its own files and connect to itself and the
 * Anthropic API. Not in `npm run dev`, whose live reloading needs more.
 */
function contentSecurityPolicy(): Plugin {
  const conf = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  // frame-ancestors / sandbox / report-uri are ignored in a <meta> policy, so they're left out
  const csp = String(conf.app.security.csp);
  return {
    name: 'flowsketch-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
  worker: { format: 'es' },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
} as any);
