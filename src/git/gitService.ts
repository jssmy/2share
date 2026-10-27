import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitCommitContext, GitFileChange } from '../types';

const execFileAsync = promisify(execFile);

export interface CommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export class GitService {
  constructor(private workspaceRoot?: string) {
    if (!this.workspaceRoot) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        this.workspaceRoot = folders[0].uri.fsPath;
      }
    }
  }

  /**
   * Ejecuta un comando git en el repositorio activo
   */
  private async runGit(args: string[]): Promise<string> {
    if (!this.workspaceRoot) {
      throw new Error('No hay un espacio de trabajo abierto en VS Code.');
    }

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB
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

  /**
   * Obtiene la lista de los últimos N commits (por defecto 20)
   * Cumple con REQ-001 Escenario 1
   */
  public async getRecentCommits(limit = 20): Promise<CommitSummary[]> {
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
    return lines.map((line) => {
      const [hash, shortHash, author, date, message] = line.split('\x1f');
      return {
        hash,
        shortHash: shortHash || hash.substring(0, 7),
        author: author || 'Desconocido',
        date: date || '',
        message: message || 'Sin mensaje',
      };
    });
  }

  /**
   * Extrae los metadatos y el diff estructurado de un commit específico
   * Cumple con REQ-001 Escenario 2
   */
  public async getCommitContext(commitHash: string): Promise<GitCommitContext> {
    // 1. Obtener metadatos del commit
    const metaOutput = await this.runGit([
      'show',
      '-s',
      '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%B',
      '--date=iso',
      commitHash,
    ]);

    const [hash, shortHash, author, date, message] = metaOutput.split('\x1f');

    // 2. Obtener estadísticas de archivos modificados
    const numstatOutput = await this.runGit([
      'show',
      '--numstat',
      '--pretty=format:',
      commitHash,
    ]);

    // 3. Obtener el diff unificado completo
    const unifiedDiff = await this.runGit(['show', '--pretty=format:', commitHash]);

    // 4. Parsear archivos y estadísticas
    const changedFiles: GitFileChange[] = [];
    const numstatLines = numstatOutput.trim().split('\n').filter(Boolean);

    for (const line of numstatLines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        const filePath = parts[2].trim();

        // Extraer el patch específico para este archivo
        const patch = this.extractFilePatch(unifiedDiff, filePath);

        changedFiles.push({
          filePath,
          additions,
          deletions,
          patch,
        });
      }
    }

    return {
      hash: hash.trim(),
      shortHash: (shortHash || hash.substring(0, 7)).trim(),
      message: (message || '').trim(),
      author: (author || '').trim(),
      date: (date || '').trim(),
      changedFiles,
      unifiedDiff: unifiedDiff.trim(),
    };
  }

  /**
   * Extrae el bloque de diff correspondiente a un archivo específico
   */
  private extractFilePatch(fullDiff: string, filePath: string): string {
    const fileHeader = `diff --git a/${filePath} b/${filePath}`;
    const nextDiffHeader = '\ndiff --git ';

    const startIndex = fullDiff.indexOf(fileHeader);
    if (startIndex === -1) {
      return '';
    }

    const endIndex = fullDiff.indexOf(nextDiffHeader, startIndex + fileHeader.length);
    if (endIndex === -1) {
      return fullDiff.substring(startIndex).trim();
    }

    return fullDiff.substring(startIndex, endIndex).trim();
  }

  /**
   * Muestra un QuickPick con los commits recientes para que el usuario elija uno.
   * Si ocurre un error (no hay git o no hay commits), muestra advertencia informativa (REQ-001 Escenario 3).
   */
  public async pickCommit(): Promise<GitCommitContext | undefined> {
    try {
      const commits = await this.getRecentCommits(20);

      if (commits.length === 0) {
        vscode.window.showInformationMessage(
          '2share: El repositorio actual no tiene commits disponibles para compartir.'
        );
        return undefined;
      }

      const quickPickItems: vscode.QuickPickItem[] = commits.map((commit) => ({
        label: `$(git-commit) ${commit.shortHash}: ${commit.message}`,
        description: `${commit.author} • ${commit.date}`,
        detail: commit.hash,
      }));

      const selected = await vscode.window.showQuickPick(quickPickItems, {
        title: '2share: Selecciona un commit para crear tu post',
        placeHolder: 'Elige un commit reciente...',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected || !selected.detail) {
        return undefined;
      }

      return await this.getCommitContext(selected.detail);
    } catch (error: any) {
      vscode.window.showWarningMessage(
        `2share: ${error.message || 'Error al inspeccionar el repositorio Git.'}`
      );
      return undefined;
    }
  }
}
