import { describe, it, expect } from 'vitest';
import ts from 'typescript';
// @ts-expect-error Node.js fs module is available in Vitest node test runner
import fs from 'node:fs';
// @ts-expect-error Node.js path module is available in Vitest node test runner
import path from 'node:path';
// @ts-expect-error Node.js url module is available in Vitest node test runner
import { fileURLToPath } from 'node:url';
import { MIGRATED_SETTING_KEYS, type MigratedSettingKey } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

export interface AstScanViolation {
  file: string;
  line: number;
  property: string;
  codeSnippet: string;
}

export function scanAstForMigratedEnvReads(
  sourceCode: string,
  filePath: string,
): AstScanViolation[] {
  const violations: AstScanViolation[] = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const migratedKeySet = new Set<string>(MIGRATED_SETTING_KEYS);

  function checkExpressionTarget(node: ts.Expression): boolean {
    const text = node.getText(sourceFile);
    return (
      text === 'env' ||
      text === 'c.env' ||
      text === 'workerEnv' ||
      text === 'rawEnv' ||
      text.endsWith('.env')
    );
  }

  function visit(node: ts.Node) {
    // 1. Check property access: env.GOOGLE_CLIENT_ID
    if (ts.isPropertyAccessExpression(node)) {
      const propName = node.name.text;
      if (migratedKeySet.has(propName) && checkExpressionTarget(node.expression)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          file: filePath,
          line: line + 1,
          property: propName,
          codeSnippet: node.getText(sourceFile),
        });
      }
    }

    // 2. Check element access: env['GOOGLE_CLIENT_ID']
    if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (arg && ts.isStringLiteral(arg)) {
        const propName = arg.text;
        if (migratedKeySet.has(propName) && checkExpressionTarget(node.expression)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push({
            file: filePath,
            line: line + 1,
            property: propName,
            codeSnippet: node.getText(sourceFile),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'fixtures') {
        getFilesRecursively(fullPath, fileList);
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('AST Scanner for Migrated Environment Reads', () => {
  it('detects reintroduced direct reads of migrated variables (Removal Test)', () => {
    const testCases = [
      `const id = env.GOOGLE_CLIENT_ID;`,
      `const secret = c.env.GOOGLE_CLIENT_SECRET;`,
      `const key = workerEnv['GEMINI_API_KEY'];`,
      `const token = env.TELEGRAM_BOT_TOKEN;`,
      `const sheet = c.env.GOOGLE_SHEET_ID;`,
      `const prov = env.LLM_PROVIDER;`,
    ];

    for (const code of testCases) {
      const violations = scanAstForMigratedEnvReads(code, 'test-sample.ts');
      expect(violations.length).toBeGreaterThan(0);
      expect(MIGRATED_SETTING_KEYS).toContain(violations[0]?.property as MigratedSettingKey);
    }
  });

  it('scans all source files in apps/worker/src and packages/shared/src (excluding config.ts) and finds zero direct reads', () => {
    const targetDirs = [
      path.join(rootDir, 'apps/worker/src'),
      path.join(rootDir, 'packages/shared/src'),
    ];

    const allSourceFiles: string[] = [];
    for (const dir of targetDirs) {
      getFilesRecursively(dir, allSourceFiles);
    }

    const allViolations: AstScanViolation[] = [];

    for (const file of allSourceFiles) {
      // Exclude config.ts (the config module itself where env is read for dev fallback) and env.ts (which defines Bindings interface / validation)
      const basename = path.basename(file);
      if (basename === 'config.ts' || basename === 'env.ts') {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      const fileViolations = scanAstForMigratedEnvReads(content, file);
      allViolations.push(...fileViolations);
    }

    if (allViolations.length > 0) {
      const details = allViolations
        .map((v) => `  ${v.file}:${v.line} -> ${v.codeSnippet} (${v.property})`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} direct reads of migrated config values outside the config module:\n${details}`,
      );
    }

    expect(allViolations).toHaveLength(0);
  });
});
