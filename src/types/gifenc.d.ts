declare module 'gifenc' {
  export type Palette = number[][];
  export interface QuantizeOptions { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number }
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
  export interface FrameOptions { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number; first?: boolean; colorDepth?: number }
  export interface Encoder { writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void; finish(): void; bytes(): Uint8Array; bytesView(): Uint8Array; reset(): void }
  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): Encoder;
}
