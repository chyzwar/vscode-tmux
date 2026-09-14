export declare const DEFAULT_TITLE_TEMPLATE = "${dirty}${activeEditorShort}${separator}${rootName}${separator}${profileName}${separator}${appName}";
export declare const DEFAULT_SEPARATOR = " - ";
/**
 * Render VS Code's `window.title` template the way the workbench does:
 * variables are substituted, and separators between empty segments collapse.
 * Mirrors src/vs/workbench/browser/parts/titlebar/windowTitle.ts (doGetTitle).
 */
export declare function predictTitle(template: string, vars: Record<string, string>, separator?: string): string;
