import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
   * Consolida el contexto de múltiples commits seleccionados (REQ-001 Escenario 4)
   */
  public async getMultiCommitContext(
    hashes: string[],
    userContext?: string
  ): Promise<GitCommitContext> {
    if (!hashes || hashes.length === 0) {
      throw new Error('Debes seleccionar al menos un commit.');
    }

    if (hashes.length === 1) {
      const single = await this.getCommitContext(hashes[0]);
      single.mode = 'commits';
      single.userContext = userContext?.trim();
      single.selectedHashes = hashes;
      return single;
    }

    const contexts = await Promise.all(hashes.map((h) => this.getCommitContext(h)));

    // Consolidar archivos modificados evitando duplicados
    const fileMap = new Map<string, GitFileChange>();
    for (const ctx of contexts) {
      for (const f of ctx.changedFiles) {
        if (!fileMap.has(f.filePath)) {
          fileMap.set(f.filePath, { ...f });
        } else {
          const existing = fileMap.get(f.filePath)!;
          existing.additions += f.additions;
          existing.deletions += f.deletions;
          if (f.patch && !existing.patch.includes(f.patch)) {
            existing.patch += `\n${f.patch}`;
          }
        }
      }
    }

    const messages = contexts
      .map((c) => `• [${c.shortHash}] ${c.message.split('\n')[0]}`)
      .join('\n');

    const authors = Array.from(new Set(contexts.map((c) => c.author))).join(', ');
    const unifiedDiff = contexts
      .map((c) => c.unifiedDiff)
      .filter(Boolean)
      .join('\n\n');

    return {
      hash: hashes.join(','),
      shortHash: `${contexts[0].shortHash}..${contexts[contexts.length - 1].shortHash} (${contexts.length} commits)`,
      message: `Conjunto de commits:\n${messages}`,
      author: authors || contexts[0].author,
      date: contexts[0].date,
      changedFiles: Array.from(fileMap.values()),
      unifiedDiff,
      mode: 'commits',
      userContext: userContext?.trim(),
      selectedHashes: hashes,
    };
  }

  /**
   * Obtiene la lista de archivos modificados o presentes en el workspace
   * Cumple con REQ-001 Escenario 5
   */
  public async getWorkspaceFiles(): Promise<{ relativePath: string; status: string }[]> {
    const results: { relativePath: string; status: string }[] = [];
    const seen = new Set<string>();

    // 1. Obtener archivos con cambios en Git
    try {
      const statusOutput = await this.runGit(['status', '--porcelain']);
      const lines = statusOutput.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const statusCode = line.substring(0, 2).trim();
        const filePath = line.substring(3).trim().replace(/^"|"$/g, '');
        if (filePath && !seen.has(filePath)) {
          seen.add(filePath);
          let labelStatus = 'Modificado';
          if (statusCode.includes('A') || statusCode.includes('?')) {
            labelStatus = 'Nuevo / Untracked';
          } else if (statusCode.includes('D')) {
            labelStatus = 'Eliminado';
          }
          results.push({ relativePath: filePath, status: labelStatus });
        }
      }
    } catch {
      // Ignorar error si no es git
    }

    // 2. Si hay pocos archivos modificados, complementar con archivos del repositorio
    if (results.length < 15) {
      try {
        const lsOutput = await this.runGit(['ls-files']);
        const lsLines = lsOutput.trim().split('\n').filter(Boolean);
        for (const filePath of lsLines) {
          if (results.length >= 35) {
            break;
          }
          const lower = filePath.toLowerCase();
          if (
            !seen.has(filePath) &&
            !lower.endsWith('.lock') &&
            !lower.endsWith('-lock.json') &&
            !lower.endsWith('.png') &&
            !lower.endsWith('.svg') &&
            !lower.endsWith('.vsix')
          ) {
            seen.add(filePath);
            results.push({ relativePath: filePath, status: 'Repositorio' });
          }
        }
      } catch {
        // Fallback a archivos comunes
      }
    }

    return results;
  }

  /**
   * Extrae el contexto estructurado a partir de una lista de archivos seleccionados (REQ-001 Escenario 5)
   */
  public async getFilesContext(
    filePaths: string[],
    userContext?: string
  ): Promise<GitCommitContext> {
    if (!filePaths || filePaths.length === 0) {
      throw new Error('Debes seleccionar al menos un archivo.');
    }

    const changedFiles: GitFileChange[] = [];
    let fullDiff = '';

    for (const relPath of filePaths) {
      let patch = '';
      let additions = 0;
      let deletions = 0;

      // Intentar obtener git diff HEAD
      try {
        const diff = await this.runGit(['diff', 'HEAD', '--', relPath]);
        if (diff.trim()) {
          patch = diff.trim();
          const lines = patch.split('\n');
          for (const l of lines) {
            if (l.startsWith('+') && !l.startsWith('+++')) {
              additions++;
            }
            if (l.startsWith('-') && !l.startsWith('---')) {
              deletions++;
            }
          }
          fullDiff += `\n${patch}`;
        }
      } catch {
        // Fallback a lectura de archivo
      }

      // Si no hay diff unificado (archivo ya commiteado o nuevo), leer fragmento directo
      if (!patch && this.workspaceRoot) {
        try {
          const absPath = path.isAbsolute(relPath)
            ? relPath
            : path.join(this.workspaceRoot, relPath);
          if (fs.existsSync(absPath)) {
            const content = await fs.promises.readFile(absPath, 'utf8');
            const lines = content.split('\n').slice(0, 45); // Primeras 45 líneas
            patch = lines.join('\n');
            additions = lines.length;
            fullDiff += `\n// Archivo: ${relPath}\n${patch}`;
          }
        } catch {
          // Ignorar si no se puede leer
        }
      }

      changedFiles.push({
        filePath: relPath,
        additions,
        deletions,
        patch,
      });
    }

    let author = 'Desarrollador';
    try {
      const gitAuthor = await this.runGit(['config', 'user.name']);
      if (gitAuthor.trim()) {
        author = gitAuthor.trim();
      }
    } catch {
      // Usar autor por defecto
    }

    const fileNames = filePaths.map((f) => path.basename(f)).join(', ');

    return {
      hash: 'workspace-files',
      shortHash: `${filePaths.length} archivo(s)`,
      message: `Trabajo en archivos: ${fileNames}`,
      author,
      date: new Date().toISOString().split('T')[0],
      changedFiles,
      unifiedDiff: fullDiff.trim(),
      mode: 'files',
      userContext: userContext?.trim(),
      selectedFiles: filePaths,
    };
  }

  /**
   * Asistente interactivo guiado para crear post:
   * 1. Elegir modo (Commits vs Archivos)
   * 2. Selección múltiple
   * 3. Ingresar contexto o reto técnico
   */
  public async promptPostCreation(): Promise<GitCommitContext | undefined> {
    try {
      const modeChoice = await vscode.window.showQuickPick(
        [
          {
            label: '$(git-commit) Commits de Git',
            description: 'Selecciona uno o más commits recientes',
            id: 'commits',
          },
          {
            label: '$(files) Archivos del Proyecto',
            description: 'Selecciona uno o varios archivos del espacio de trabajo',
            id: 'files',
          },
        ],
        {
          title: '2share: ¿Cómo deseas crear tu post?',
          placeHolder: 'Elige la fuente de código o cambios...',
        }
      );

      if (!modeChoice) {
        return undefined;
      }

      let selectedHashes: string[] = [];
      let selectedFiles: string[] = [];

      if (modeChoice.id === 'commits') {
        const commits = await this.getRecentCommits(25);
        if (commits.length === 0) {
          vscode.window.showInformationMessage('2share: No hay commits en el repositorio.');
          return undefined;
        }

        const items: vscode.QuickPickItem[] = commits.map((c) => ({
          label: `$(git-commit) ${c.shortHash}: ${c.message}`,
          description: `${c.author} • ${c.date}`,
          detail: c.hash,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          title: '2share: Selecciona 1 o más commits (usa espacio para marcar varios)',
          canPickMany: true,
          placeHolder: 'Elige los commits que formarán el post...',
        });

        if (!picked || picked.length === 0) {
          return undefined;
        }

        selectedHashes = picked.map((p) => p.detail!);
      } else {
        const files = await this.getWorkspaceFiles();
        if (files.length === 0) {
          vscode.window.showInformationMessage('2share: No se encontraron archivos para compartir.');
          return undefined;
        }

        const items: vscode.QuickPickItem[] = files.map((f) => ({
          label: `$(file-code) ${f.relativePath}`,
          description: f.status,
          detail: f.relativePath,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          title: '2share: Selecciona los archivos a incluir (marca 1 o varios)',
          canPickMany: true,
          placeHolder: 'Elige los archivos...',
        });

        if (!picked || picked.length === 0) {
          return undefined;
        }

        selectedFiles = picked.map((p) => p.detail!);
      }

      // Preguntar por contexto / notas / métricas personalizadas (REQ-002 Escenario 4)
      const userContext = await vscode.window.showInputBox({
        title: '2share: Contexto o reto técnico clave (Opcional)',
        prompt: '¿Qué reto superaste, qué métricas lograste o qué aprendizaje quieres destacar?',
        placeHolder: 'Ej: Redujimos la latencia 60% usando un cache local...',
      });

      // Preguntar si desea incluir imagen (REQ-003 Escenario 4)
      const imageChoice = await vscode.window.showQuickPick(
        [
          {
            label: '$(device-camera) Incluir captura visual de código',
            description: 'Genera imagen estilizada con marco macOS para LinkedIn',
            id: 'with-image',
          },
          {
            label: '$(note) Solo texto',
            description: 'Publicar únicamente el contenido textual sin imagen adjunta',
            id: 'text-only',
          },
        ],
        {
          title: '2share: ¿Deseas incluir imagen en la publicación?',
        }
      );

      const includeImage = imageChoice ? imageChoice.id === 'with-image' : true;

      // Preguntar por snippet personalizado si hay selección activa en el editor (REQ-003 Escenario 5)
      let customSnippet: { code: string; fileName?: string } | undefined;
      const activeEditor = vscode.window.activeTextEditor;
      if (includeImage && activeEditor && !activeEditor.selection.isEmpty) {
        const fileName = path.basename(activeEditor.document.fileName);
        const useSelectionChoice = await vscode.window.showQuickPick(
          [
            {
              label: '$(check) Usar selección actual del editor',
              description: `Capturar fragmento seleccionado en ${fileName}`,
              id: 'useSelection',
            },
            {
              label: '$(sparkle) Extraer automáticamente de los cambios',
              description: 'Detectar cambios representativos de forma automática',
              id: 'auto',
            },
          ],
          {
            title: '2share: ¿Qué fragmento de código deseas mostrar en la imagen?',
          }
        );
        if (useSelectionChoice && useSelectionChoice.id === 'useSelection') {
          customSnippet = {
            code: activeEditor.document.getText(activeEditor.selection),
            fileName,
          };
        }
      }

      let resultContext: GitCommitContext;
      if (modeChoice.id === 'commits') {
        resultContext = await this.getMultiCommitContext(selectedHashes, userContext);
      } else {
        resultContext = await this.getFilesContext(selectedFiles, userContext);
      }

      resultContext.includeImage = includeImage;
      if (customSnippet) {
        resultContext.customSnippet = customSnippet;
      }

      return resultContext;
    } catch (error: any) {
      vscode.window.showWarningMessage(
        `2share: ${error.message || 'Error al inspeccionar el repositorio Git.'}`
      );
      return undefined;
    }
  }

  /**
   * Muestra un QuickPick con los commits recientes para que el usuario elija uno (Backward compatibility).
   */
  public async pickCommit(): Promise<GitCommitContext | undefined> {
    return this.promptPostCreation();
  }
}

