/**
 * Definiciones de tipos para 2share VS Code Extension
 * Creado en base a los requerimientos:
 * - [[Requirements/REQ-001 - Seleccion y Extraccion de Commits Git]]
 * - [[Requirements/REQ-002 - Generacion de Post con IA de VS Code]]
 * - [[Requirements/REQ-003 - Captura Visual de Fragmentos de Codigo]]
 * - [[Requirements/REQ-004 - Vista Previa y Edicion de Post]]
 * - [[Requirements/REQ-005 - Autenticacion y Publicacion en LinkedIn]]
 */

export interface GitFileChange {
  filePath: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface GitCommitContext {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  changedFiles: GitFileChange[];
  unifiedDiff?: string;
}

export type SnapshotTheme = 'nord' | 'one-dark-pro' | 'github-dark' | 'dracula';

export interface CodeSnippetSnapshot {
  fileName: string;
  language: string;
  code: string;
  theme: SnapshotTheme;
  svgContent: string;
  imageBuffer?: Buffer;
  dataUri: string;
  mimeType: 'image/svg+xml' | 'image/png';
}

export type WebviewMessage =
  | { command: 'ready' }
  | { command: 'updateText'; text: string }
  | { command: 'regenerateAI' }
  | { command: 'publish'; payload: { text: string; imageDataUri?: string } };

export interface LinkedInPostPayload {
  author: string;
  commentary: string;
  visibility: 'PUBLIC' | 'CONNECTIONS';
  imageBuffer?: Buffer;
  imageUrn?: string;
}

export interface LinkedInPublishResult {
  success: boolean;
  postUrn?: string;
  postUrl?: string;
  error?: string;
}
