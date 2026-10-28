import * as vscode from 'vscode';
import * as path from 'path';
import { CodeSelectionContext } from '../models';

export class SelectionService {
  /**
   * Obtiene la selección actual del editor activo o undefined si no hay selección
   */
  public getEditorSelection(): CodeSelectionContext | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      return undefined;
    }

    const document = editor.document;
    const selectedText = document.getText(selection);
    if (!selectedText.trim()) {
      return undefined;
    }

    const fullPath = document.fileName;
    const fileName = path.basename(fullPath);
    let relativePath = fileName;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      if (fullPath.startsWith(root)) {
        relativePath = path.relative(root, fullPath);
      }
    }

    const startLine = selection.start.line + 1; // 1-based
    const endLine = selection.end.line + 1;
    const lineCount = endLine - startLine + 1;
    const languageId = document.languageId;
    const languageBadge = this.getLanguageBadge(languageId, fileName);

    return {
      text: selectedText,
      fileName,
      relativePath,
      fullPath,
      languageId,
      languageBadge,
      startLine,
      endLine,
      lineCount,
    };
  }

  /**
   * Obtiene la selección del editor o un contexto de fallback si no hay selección
   */
  public getEditorSelectionOrSample(): CodeSelectionContext {
    const sel = this.getEditorSelection();
    if (sel) {
      return sel;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document) {
      const doc = editor.document;
      const fileName = path.basename(doc.fileName);
      const lines = doc.getText().split('\n');
      const count = Math.min(12, lines.length);
      const sampleText = lines.slice(0, count).join('\n');
      return {
        text: sampleText || '// Código del proyecto',
        fileName,
        relativePath: fileName,
        fullPath: doc.fileName,
        languageId: doc.languageId,
        languageBadge: this.getLanguageBadge(doc.languageId, fileName),
        startLine: 1,
        endLine: count,
        lineCount: count,
      };
    }

    // Fallback fiel al diseño de la imagen de referencia (users.service.ts)
    return {
      text: `async createUser(data: CreateUserDto) {\n  const { name, email, role } = data;\n  const user = await this.prisma.user.create({\n    data: {\n      name,\n      email,\n      role,\n      createdAt: new Date(),\n    },\n  });\n  return user;\n}`,
      fileName: 'users.service.ts',
      relativePath: 'src/services/users.service.ts',
      fullPath: '',
      languageId: 'typescript',
      languageBadge: 'TS',
      startLine: 12,
      endLine: 22,
      lineCount: 11,
    };
  }

  /**
   * Genera una insignia corta de lenguaje para la tarjeta visual (ej. TS, JS, PY)
   */
  public getLanguageBadge(languageId: string, fileName: string): string {
    const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
    const map: Record<string, string> = {
      typescript: 'TS',
      typescriptreact: 'TSX',
      javascript: 'JS',
      javascriptreact: 'JSX',
      python: 'PY',
      rust: 'RS',
      go: 'GO',
      java: 'JAVA',
      c: 'C',
      cpp: 'C++',
      csharp: 'C#',
      php: 'PHP',
      ruby: 'RB',
      swift: 'SWIFT',
      kotlin: 'KT',
      html: 'HTML',
      css: 'CSS',
      scss: 'SCSS',
      json: 'JSON',
      markdown: 'MD',
      sql: 'SQL',
      shellscript: 'SH',
      yaml: 'YAML',
      dockerfile: 'DOCKER',
    };

    if (map[languageId.toLowerCase()]) {
      return map[languageId.toLowerCase()];
    }
    if (map[ext]) {
      return map[ext];
    }
    return ext.toUpperCase() || 'CODE';
  }

  /**
   * Muestra mensaje explicativo amigable cuando no hay selección
   */
  public async promptEmptySelectionHelp(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      'Share to LinkedIn: Selecciona primero unas líneas de código en tu editor activo para compartir.',
      'Abrir Compositor',
      'Entendido'
    );
    if (action === 'Abrir Compositor') {
      await vscode.commands.executeCommand('share-to-linkedin.openComposer');
    }
  }
}

