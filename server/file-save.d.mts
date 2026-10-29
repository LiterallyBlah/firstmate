export function fileHash(bytes: string | Buffer): string;
export class FileChangedError extends Error { code: string; }
export function fileTarget(home: string, path: string): Promise<{ absolute: string; path: string; root: string }>;
export function fileLockPath(absolute: string): string;
export function withFileLock<T>(absolute: string, action: () => Promise<T>): Promise<T>;
export interface SaveOptions {
  actor?: string;
  force?: boolean;
  check?: (before: Buffer | null) => void | Promise<void>;
  afterStaging?: () => Promise<void>;
  beforeCapture?: () => Promise<void>;
  beforeInstall?: () => Promise<void>;
  afterRename?: () => Promise<void>;
}
export function replaceLocked(home: string, path: string, content: string | Buffer, expectedHash: string | null, options?: SaveOptions): Promise<string>;
