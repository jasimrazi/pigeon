declare module '*/scripts/backup-d1.mjs' {
  export interface BackupOptions {
    dbName?: string;
    bucketName?: string;
    retentionDays?: number;
    outputDir?: string;
    now?: Date;
    exec?: (command: string) => string;
    fileContent?: string;
  }

  export function generateBackupFilename(dbName: string, date: Date): string;
  export function validateSqlDump(sqlContent: string): { valid: boolean; reason?: string };
  export function runD1Backup(options?: BackupOptions): Promise<{
    filename: string;
    filePath: string;
    sizeBytes: number;
    uploadedKey: string;
  }>;
}
