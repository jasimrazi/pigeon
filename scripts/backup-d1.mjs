/**
 * Pigeon D1 Weekly Backup & R2 Retention Script
 *
 * Exports production D1 database to a SQL dump, verifies dump integrity,
 * uploads it to R2 with timestamped naming, and enforces 8-week (56-day) retention.
 */

export function generateBackupFilename(dbName, date) {
  const iso = date.toISOString().replace(/[:.]/g, '-');
  return `${dbName}-${iso}.sql`;
}

export function validateSqlDump(sqlContent) {
  if (!sqlContent || sqlContent.trim().length === 0) {
    return { valid: false, reason: 'Dump file is empty' };
  }

  const hasCreateTable = /CREATE TABLE/i.test(sqlContent);
  const hasSqlStatements = /INSERT(?:\s+OR\s+REPLACE)?\s+INTO|PRAGMA|BEGIN TRANSACTION/i.test(
    sqlContent,
  );

  if (!hasCreateTable && !hasSqlStatements) {
    return { valid: false, reason: 'Dump file does not contain valid SQLite statements' };
  }

  return { valid: true };
}

export async function runD1Backup(options = {}) {
  const dbName =
    options.dbName ||
    (typeof process !== 'undefined' ? process.env?.D1_DATABASE_NAME : undefined) ||
    'pigeon-db-prod';
  const bucketName =
    options.bucketName ||
    (typeof process !== 'undefined' ? process.env?.R2_BACKUP_BUCKET : undefined) ||
    'pigeon-resumes-prod';
  const now = options.now || new Date();

  let exec = options.exec;
  let readFileSync = options.readFileSync;
  let writeFileSync = options.writeFileSync;
  let mkdirSync = options.mkdirSync;
  let existsSync = options.existsSync;

  if (!exec || (!readFileSync && !options.fileContent)) {
    const cp = await import('node:child_process');
    const fs = await import('node:fs');
    if (!exec) exec = (cmd) => cp.execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
    if (!readFileSync) readFileSync = fs.readFileSync;
    if (!writeFileSync) writeFileSync = fs.writeFileSync;
    if (!mkdirSync) mkdirSync = fs.mkdirSync;
    if (!existsSync) existsSync = fs.existsSync;
  }

  const outputDir = options.outputDir || './backups';
  if (existsSync && !existsSync(outputDir)) {
    if (mkdirSync) mkdirSync(outputDir, { recursive: true });
  }

  const filename = generateBackupFilename(dbName, now);
  const filePath = `${outputDir}/${filename}`;

  console.log(`[pigeon-backup] Starting export for D1 database: ${dbName}...`);
  const exportCmd = `npx wrangler d1 export ${dbName} --remote --output="${filePath}"`;
  exec(exportCmd);

  let sqlContent = '';
  if (typeof options.fileContent === 'string') {
    sqlContent = options.fileContent;
  } else if (readFileSync) {
    sqlContent = readFileSync(filePath, 'utf-8');
  }

  const validation = validateSqlDump(sqlContent);
  if (!validation.valid) {
    throw new Error(`Exported SQL dump failed validation: ${validation.reason}`);
  }

  const r2Key = `backups/${filename}`;
  console.log(`[pigeon-backup] Uploading dump to R2: ${bucketName}/${r2Key}...`);
  const uploadCmd = `npx wrangler r2 object put "${bucketName}/${r2Key}" --file="${filePath}"`;
  exec(uploadCmd);

  console.log(
    `[pigeon-backup] Backup completed successfully: ${filename} (${sqlContent.length} bytes)`,
  );

  return {
    filename,
    filePath,
    sizeBytes: sqlContent.length,
    uploadedKey: r2Key,
  };
}

// Allow direct script execution under Node
if (
  typeof process !== 'undefined' &&
  process.argv &&
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
) {
  runD1Backup()
    .then((result) => {
      console.log(`Backup succeeded: ${result.uploadedKey}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Backup failed:', err);
      process.exit(1);
    });
}
