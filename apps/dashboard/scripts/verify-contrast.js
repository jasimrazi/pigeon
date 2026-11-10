/* global console */
// Contrast Verification Script (Plain Node.js)
// Computes WCAG 2.1 relative luminance and contrast ratios for Pigeon Design Tokens

const tokens = {
  colors: {
    light: {
      surface: '#ffffff',
      text: '#0f172a',
      textMuted: '#475569',
      accent: '#1e3a8a',
      accentFg: '#ffffff',
      state: {
        ok: { bg: '#ecfdf5', fg: '#065f46' },
        warn: { bg: '#fffbeb', fg: '#92400e' },
        danger: { bg: '#fef2f2', fg: '#991b1b' },
        unknown: { bg: '#f1f5f9', fg: '#475569' },
      },
    },
    dark: {
      surface: '#14171d',
      text: '#f3f4f6',
      textMuted: '#9ca3af',
      accent: '#60a5fa',
      accentFg: '#0b0d11',
      state: {
        ok: { bg: '#06281e', fg: '#34d399' },
        warn: { bg: '#2a1d08', fg: '#fbbf24' },
        danger: { bg: '#2d0f11', fg: '#f87171' },
        unknown: { bg: '#1c2028', fg: '#9ca3af' },
      },
    },
  },
};

function getLuminance(hex) {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastRatio(hex1, hex2) {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function runVerification() {
  console.log('=== WCAG AA Contrast Verification Report ===\n');

  const { light, dark } = tokens.colors;

  const lightPairings = [
    { name: 'Light Surface Text', fg: light.text, bg: light.surface },
    { name: 'Light Text Muted', fg: light.textMuted, bg: light.surface },
    { name: 'Light State OK', fg: light.state.ok.fg, bg: light.state.ok.bg },
    { name: 'Light State Warn', fg: light.state.warn.fg, bg: light.state.warn.bg },
    { name: 'Light State Danger', fg: light.state.danger.fg, bg: light.state.danger.bg },
    { name: 'Light State Unknown', fg: light.state.unknown.fg, bg: light.state.unknown.bg },
    { name: 'Light Accent on Surface', fg: light.accent, bg: light.surface },
    { name: 'Light Accent Fg on Accent', fg: light.accentFg, bg: light.accent },
  ];

  const darkPairings = [
    { name: 'Dark Surface Text', fg: dark.text, bg: dark.surface },
    { name: 'Dark Text Muted', fg: dark.textMuted, bg: dark.surface },
    { name: 'Dark State OK', fg: dark.state.ok.fg, bg: dark.state.ok.bg },
    { name: 'Dark State Warn', fg: dark.state.warn.fg, bg: dark.state.warn.bg },
    { name: 'Dark State Danger', fg: dark.state.danger.fg, bg: dark.state.danger.bg },
    { name: 'Dark State Unknown', fg: dark.state.unknown.fg, bg: dark.state.unknown.bg },
    { name: 'Dark Accent on Surface', fg: dark.accent, bg: dark.surface },
    { name: 'Dark Accent Fg on Accent', fg: dark.accentFg, bg: dark.accent },
  ];

  console.log('--- LIGHT THEME ---');
  let allPassed = true;
  for (const pair of lightPairings) {
    const ratio = getContrastRatio(pair.fg, pair.bg);
    const pass = ratio >= 4.5;
    if (!pass) allPassed = false;
    console.log(
      `  ${pass ? '[PASS]' : '[FAIL]'} ${pair.name.padEnd(26)}: ${pair.fg} on ${pair.bg} -> ${ratio.toFixed(2)}:1 (min 4.5:1)`,
    );
  }

  console.log('\n--- DARK THEME ---');
  for (const pair of darkPairings) {
    const ratio = getContrastRatio(pair.fg, pair.bg);
    const pass = ratio >= 4.5;
    if (!pass) allPassed = false;
    console.log(
      `  ${pass ? '[PASS]' : '[FAIL]'} ${pair.name.padEnd(26)}: ${pair.fg} on ${pair.bg} -> ${ratio.toFixed(2)}:1 (min 4.5:1)`,
    );
  }

  console.log(
    `\nOverall Result: ${allPassed ? 'ALL PASS (WCAG AA compliant)' : 'FAILURES DETECTED'}`,
  );
}

runVerification();
