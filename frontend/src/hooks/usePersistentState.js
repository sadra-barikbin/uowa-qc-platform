import { useState, useEffect } from 'react';

// A useState whose string value is mirrored to localStorage under `key`, so a UI
// selection (e.g. the chosen evaluation period / department) survives navigating away
// and back — and app restarts — instead of resetting every time the page remounts.
//
// `override` (when truthy) wins over the stored value on first mount and is then itself
// persisted: it's used for deep links that pre-pick a selection (?period=&department=),
// which should take precedence over whatever was last sticky.
//
// Reads and writes are wrapped in try/catch: localStorage can throw or be unavailable
// (private mode, blocked storage), and a remembered convenience must never break render.
export default function usePersistentState(key, override) {
    const [value, setValue] = useState(() => {
        if (override) return override;
        try { return localStorage.getItem(key) || ''; } catch { return ''; }
    });
    useEffect(() => {
        try {
            if (value) localStorage.setItem(key, value);
            else localStorage.removeItem(key);
        } catch { /* storage unavailable — the selection just won't persist */ }
    }, [key, value]);
    return [value, setValue];
}
