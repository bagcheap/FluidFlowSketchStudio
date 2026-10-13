// Builds the standalone HTML player (IIFE) that "Export ▸ Standalone HTML player" embeds.
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    lib: { entry: 'src/player/main.ts', formats: ['iife'], name: 'FlowSketchPlayer', fileName: () => 'player.bundle.js' },
    outDir: 'src/player/dist',
    emptyOutDir: true,
    minify: true,
  },
});
