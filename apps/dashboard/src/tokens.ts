/**
 * Pigeon Dashboard Design Tokens
 * Single source of truth for typography, spacing, radii, and semantic color palettes.
 */

export const tokens = {
  typography: {
    fonts: {
      sans: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
    // Exact requested scale: 12, 13, 14, 16, 20, 24 px
    scale: {
      xs: '12px', // Section labels (12px/500 uppercase with tracking), badges, captions
      sm: '13px', // Table text, dense lists
      base: '14px', // Body text, standard buttons, form inputs
      md: '16px', // Subheadings, modal headers
      lg: '20px', // Page titles (20px/600)
      xl: '24px', // Metric figures (24px/600 tabular-nums mono)
    },
    weights: {
      regular: '400',
      medium: '500',
      semibold: '600',
    },
    lineHeights: {
      tight: '1.25',
      normal: '1.5',
    },
  },
  radii: {
    sm: '4px',
    default: '6px', // Ops console standard 6px corner radius
    md: '8px',
    full: '9999px',
  },
  // Semantic palette used by theme generator & contrast verification test
  colors: {
    light: {
      bg: '#f8fafc',
      surface: '#ffffff',
      surfaceSubtle: '#f1f5f9',
      surfaceHover: '#f8fafc',
      border: '#e2e8f0',
      borderSubtle: '#edf2f7',
      text: '#0f172a',
      textMuted: '#475569',
      accent: '#1e3a8a', // Deep blue-slate
      accentHover: '#172554',
      accentFg: '#ffffff',
      state: {
        ok: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' }, // Forest green
        warn: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' }, // Amber
        danger: { bg: '#fef2f2', fg: '#991b1b', border: '#fecaca' }, // Crimson
        unknown: { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' }, // Slate
      },
    },
    dark: {
      bg: '#0b0d11',
      surface: '#14171d',
      surfaceSubtle: '#1c2028',
      surfaceHover: '#1f242e',
      border: '#2d333f',
      borderSubtle: '#232832',
      text: '#f3f4f6',
      textMuted: '#9ca3af',
      accent: '#60a5fa', // High contrast ops blue
      accentHover: '#3b82f6',
      accentFg: '#0b0d11',
      state: {
        ok: { bg: '#06281e', fg: '#34d399', border: '#0d543f' },
        warn: { bg: '#2a1d08', fg: '#fbbf24', border: '#573b0f' },
        danger: { bg: '#2d0f11', fg: '#f87171', border: '#5c1e22' },
        unknown: { bg: '#1c2028', fg: '#9ca3af', border: '#323946' },
      },
    },
  },
} as const;

export type DesignTokens = typeof tokens;
