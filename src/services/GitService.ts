import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CommitContext, GitFileChange } from '../models';

const execFileAsync = promisify(execFile);

const SENSITIVE_PATTERNS = [
  /\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /credentials\.json$/i,
  /secrets?\./i,
  /\.pfx$/i,
];

export class GitService {
  constructor(private workspaceRoot?: string) {
    if (!this.workspaceRoot) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        this.workspaceRoot = folders[0].uri.fsPath;
      }
    }
  }

  private async runGit(args: string[]): Promise<string> {
    if (!this.workspaceRoot) {
      throw new Error('No hay un espacio de trabajo abierto en VS Code.');
    }

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error: any) {
      const stderr = error?.stderr || error?.message || '';
      if (stderr.includes('not a git repository')) {
        throw new Error('El espacio de trabajo actual no es un repositorio Git.');
      }
      if (stderr.includes('does not have any commits yet')) {
        throw new Error('El repositorio Git no tiene commits registrados aún.');
      }
      throw new Error(`Error de Git: ${stderr.trim() || error.message}`);
    }
  }

  public async isGitRepository(): Promise<boolean> {
    try {
      const output = await this.runGit(['rev-parse', '--is-inside-work-tree']);
      return output.trim() === 'true';
    } catch {
      return false;
    }
  }

  public async getCurrentBranch(): Promise<string> {
    try {
      const branch = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch {
      return 'main';
    }
  }

  /**
   * Obtiene el último commit del repositorio
   */
  public async getLastCommit(): Promise<CommitContext> {
    const commits = await this.getRecentCommits(1);
    if (!commits || commits.length === 0) {
      throw new Error('No hay commits registrados en el repositorio.');
    }
    return commits[0];
  }

  /**
   * Obtiene la lista de commits recientes
   */
  public async getRecentCommits(limit = 10): Promise<CommitContext[]> {
    const format = '%H%x1f%h%x1f%an%x1f%ad%x1f%s';
    const output = await this.runGit([
      'log',
      `-${limit}`,
      `--pretty=format:${format}`,
      '--date=short',
    ]);

    if (!output.trim()) {
      return [];
    }

    const lines = output.trim().split('\n');
    const branch = await this.getCurrentBranch();
    const results: CommitContext[] = [];

    for (const line of lines) {
      const [hash, shortHash, author, date, message] = line.split('\x1f');
      if (!hash) {
        continue;
      }

      // Obtener archivos modificados
      const numstatOutput = await this.runGit(['show', '--numstat', '--pretty=format:', hash]);
      const changedFiles: GitFileChange[] = [];

      for (const statLine of numstatOutput.trim().split('\n')) {
        const parts = statLine.split('\t');
        if (parts.length >= 3) {
          const filePath = parts[2].trim();
          // Omitir archivos sensibles por seguridad (Prompt Maestro Sección 6)
          if (this.isSensitiveFile(filePath)) {
            continue;
          }

          const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
          const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
          changedFiles.push({ filePath, additions, deletions });
        }
      }

      // Obtener resumen controlado del diff (máximo 1500 caracteres, sin secretos)
      let diffSummary = '';
      try {
        const rawDiff = await this.runGit(['show', '--stat', '--pretty=format:', hash]);
        diffSummary = rawDiff.trim().slice(0, 1500);
      } catch {
        diffSummary = `${changedFiles.length} archivos modificados`;
      }

      results.push({
        hash,
        shortHash: shortHash || hash.substring(0, 7),
        author: author || 'Desarrollador',
        date: date || '',
        message: message || 'Sin mensaje',
        branch,
        changedFiles,
        diffSummary,
      });
    }

    return results;
  }

  public async getWorkspaceFiles(limit = 40): Promise<string[]> {
    try {
      const output = await this.runGit(['ls-files']);
      const files = output
        .trim()
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f && !this.isSensitiveFile(f))
        .slice(0, limit);
      return files;
    } catch {
      return [];
    }
  }

  public isSensitiveFile(filePath: string): boolean {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(filePath));
  }
}

