import { describe, it, expect } from 'vitest';
// @ts-expect-error Node.js fs module is available in Vitest node test runner
import * as fs from 'node:fs';
// @ts-expect-error Node.js path module is available in Vitest node test runner
import * as path from 'node:path';
// @ts-expect-error Node.js url module is available in Vitest node test runner
import { fileURLToPath } from 'node:url';
import { tokens } from './tokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');
const componentsDir = path.resolve(__dirname, '../src/components');

// Standard Unicode emoji regex matching emoticons, pictographs, transport, flags, dingbats
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

// Hex color pattern: #xxx, #xxxx, #xxxxxx, #xxxxxxxx
const hexColorRegex = /#[0-9a-fA-F]{3,8}\b/;

function getAllFiles(dir: string, ext = '.tsx'): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...getAllFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext) && !entry.name.includes('.test.')) {
      result.push(fullPath);
    }
  }
  return result;
}

// Relative luminance formula per WCAG 2.1
function getLuminance(hex: string): number {
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

  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Dashboard Visual Design & Standards Verification', () => {
  it('Scanner test: fails if an emoji is found anywhere in apps/dashboard/src/**/*.tsx', () => {
    const tsxFiles = getAllFiles(srcDir, '.tsx');
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line: string, idx: number) => {
        if (emojiRegex.test(line)) {
          violations.push({
            file: path.relative(srcDir, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }

    expect(
      violations,
      `Found emojis in dashboard source:\n${violations.map((v) => `  ${v.file}:${v.line} -> ${v.text}`).join('\n')}`,
    ).toHaveLength(0);
  });

  it('Scanner test: fails if a hard-coded hex colour is found in apps/dashboard/src/components/', () => {
    const componentFiles = getAllFiles(componentsDir, '.tsx');
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of componentFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line: string, idx: number) => {
        if (hexColorRegex.test(line)) {
          violations.push({
            file: path.relative(componentsDir, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }

    expect(
      violations,
      `Found hard-coded hex colors in components (must use theme tokens/CSS vars):\n${violations
        .map((v) => `  ${v.file}:${v.line} -> ${v.text}`)
        .join('\n')}`,
    ).toHaveLength(0);
  });

  describe('WCAG AA Contrast Verification (all theme pairings >= 4.5:1)', () => {
    it('verifies light theme color pairings pass WCAG AA', () => {
      const { light } = tokens.colors;

      const pairings = [
        { name: 'Light Surface Text', fg: light.text, bg: light.surface },
        { name: 'Light Text Muted', fg: light.textMuted, bg: light.surface },
        { name: 'Light State OK', fg: light.state.ok.fg, bg: light.state.ok.bg },
        { name: 'Light State Warn', fg: light.state.warn.fg, bg: light.state.warn.bg },
        { name: 'Light State Danger', fg: light.state.danger.fg, bg: light.state.danger.bg },
        { name: 'Light State Unknown', fg: light.state.unknown.fg, bg: light.state.unknown.bg },
        { name: 'Light Accent on Surface', fg: light.accent, bg: light.surface },
        { name: 'Light Accent Fg on Accent', fg: light.accentFg, bg: light.accent },
      ];

      for (const pair of pairings) {
        const ratio = getContrastRatio(pair.fg, pair.bg);
        expect(
          ratio,
          `Pairing "${pair.name}" (${pair.fg} on ${pair.bg}) contrast ${ratio.toFixed(2)}:1 below WCAG AA 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('verifies dark theme color pairings pass WCAG AA', () => {
      const { dark } = tokens.colors;

      const pairings = [
        { name: 'Dark Surface Text', fg: dark.text, bg: dark.surface },
        { name: 'Dark Text Muted', fg: dark.textMuted, bg: dark.surface },
        { name: 'Dark State OK', fg: dark.state.ok.fg, bg: dark.state.ok.bg },
        { name: 'Dark State Warn', fg: dark.state.warn.fg, bg: dark.state.warn.bg },
        { name: 'Dark State Danger', fg: dark.state.danger.fg, bg: dark.state.danger.bg },
        { name: 'Dark State Unknown', fg: dark.state.unknown.fg, bg: dark.state.unknown.bg },
        { name: 'Dark Accent on Surface', fg: dark.accent, bg: dark.surface },
        { name: 'Dark Accent Fg on Accent', fg: dark.accentFg, bg: dark.accent },
      ];

      for (const pair of pairings) {
        const ratio = getContrastRatio(pair.fg, pair.bg);
        expect(
          ratio,
          `Pairing "${pair.name}" (${pair.fg} on ${pair.bg}) contrast ${ratio.toFixed(2)}:1 below WCAG AA 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
