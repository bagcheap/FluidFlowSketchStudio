import { describe, expect, it } from 'vitest';
import { baseName, filterFor, isDesktopApp } from '../src/persistence/native';

describe('desktop app file helpers', () => {
  it('is off in a normal browser', () => {
    expect(isDesktopApp).toBe(false);
  });
  it('offers a Save-dialog filter matching the file type', () => {
    expect(filterFor('My diagram.flowsketch')).toEqual([{ name: 'FlowSketch diagram', extensions: ['flowsketch'] }]);
    expect(filterFor('loop.GIF')).toEqual([{ name: 'GIF image', extensions: ['gif'] }]);
    expect(filterFor('noext')).toEqual([]);
  });
  it('shows just the file name of a chosen path', () => {
    expect(baseName('/Users/angus/Documents/Flow.flowsketch')).toBe('Flow.flowsketch');
    expect(baseName('C:\\\\diagrams\\\\a.png')).toBe('a.png');
  });
});
