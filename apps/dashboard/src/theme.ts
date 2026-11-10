export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pigeon_theme_preference';

/**
 * Reads the user's explicit theme preference from localStorage.
 * Wrapped in try/catch to avoid crashing in restricted browser environments.
 */
export function getStoredTheme(): ThemePreference {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'system';
}

/**
 * Stores the user's theme preference and updates the DOM data-theme attribute.
 */
export function setStoredTheme(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Ignore storage access errors
  }
  applyTheme(pref);
}

/**
 * Applies the theme by setting or removing the data-theme attribute on documentElement.
 */
export function applyTheme(pref?: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const currentPref = pref ?? getStoredTheme();
  const root = document.documentElement;

  if (currentPref === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', currentPref);
  }
}
