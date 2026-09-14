import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLE_TEMPLATE, predictTitle } from '../src/title.js';

describe('predictTitle', () => {
  it('renders the default template', () => {
    expect(
      predictTitle(DEFAULT_TITLE_TEMPLATE, { dirty: '', activeEditorShort: 'App.tsx', rootName: 'project-a', profileName: '', appName: 'Visual Studio Code' }),
    ).toBe('App.tsx - project-a - Visual Studio Code');
  });
  it('drops separators around empty segments', () => {
    expect(predictTitle('${activeEditorShort}${separator}${rootName}${separator}${appName}', { activeEditorShort: '', rootName: 'p', appName: 'Code' })).toBe('p - Code');
  });
  it('keeps the dirty marker attached', () => {
    expect(predictTitle('${dirty}${activeEditorShort}${separator}${appName}', { dirty: '● ', activeEditorShort: 'a.ts', appName: 'Code' })).toBe('● a.ts - Code');
  });
  it('treats unknown variables as empty', () => {
    expect(predictTitle('${nope}${separator}${appName}', { appName: 'Code' })).toBe('Code');
  });
});
