import { readFileSync } from 'node:fs';
export const DEFAULT_SETTINGS = { ghosttyGdkBackend: 'x11', ghosttyStartTimeoutMs: 8000 };
/** Read `<configDir>/config.json`; missing file or unknown keys are fine, bad values fall back to defaults. */
export function loadSettings(file) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return { ...DEFAULT_SETTINGS };
    }
    const s = { ...DEFAULT_SETTINGS };
    if (typeof raw === 'object' && raw !== null) {
        const r = raw;
        if (r.ghosttyGdkBackend === 'x11' || r.ghosttyGdkBackend === 'wayland' || r.ghosttyGdkBackend === 'default')
            s.ghosttyGdkBackend = r.ghosttyGdkBackend;
        if (typeof r.ghosttyStartTimeoutMs === 'number' && r.ghosttyStartTimeoutMs > 0)
            s.ghosttyStartTimeoutMs = r.ghosttyStartTimeoutMs;
    }
    return s;
}
/** Environment additions for the Ghostty process derived from settings. */
export function ghosttyEnvFor(settings) {
    return settings.ghosttyGdkBackend === 'default' ? {} : { GDK_BACKEND: settings.ghosttyGdkBackend };
}
//# sourceMappingURL=settings.js.map