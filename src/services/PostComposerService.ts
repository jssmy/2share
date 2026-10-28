import * as vscode from 'vscode';
import {
  CodeSelectionContext,
  CommitContext,
  PublicationOptions,
  TemplateVariant,
} from '../models';

export class PostComposerService {
  /**
   * Genera el texto inicial de la publicación basado en la selección de código
   */
  public composeFromSelection(
    selection: CodeSelectionContext,
    variant: TemplateVariant = 'technical',
    options?: PublicationOptions
  ): { text: string; hashtags: string[] } {
    const lang = this.formatLanguageName(selection.languageId);
    const hashtags = this.suggestHashtags(selection.languageId, selection.fileName, selection.text);
    const hashtagStr = hashtags.join(' ');

    let body = '';
    switch (variant) {
      case 'technical':
        if (
          selection.fileName.toLowerCase().includes('user') ||
          selection.text.includes('createUser') ||
          selection.text.toLowerCase().includes('prisma')
        ) {
          body = `Implementing user creation in the UsersService with Prisma ORM. This method handles the creation of a new user with essential fields and timestamps.`;
        } else {
          body = `Implementing key functionality in ${selection.fileName} with ${lang}. This implementation structures the business logic with clean patterns and maintainability.`;
        }
        break;
      case 'learning':
        body = `Comparto un aprendizaje técnico clave trabajando en ${selection.fileName} con ${lang}:\n\nLa estructuración modular y el tipado estricto aceleran la mantenibilidad y reducen la deuda técnica en el desarrollo de software.`;
        break;
      case 'experience':
        body =
          options?.messageTemplate ||
          `Comparto este código que implementé en mi proyecto. ¡Espero que sea útil! 💡`;
        break;
    }

    // Agregar referencia al archivo si está habilitado en las opciones
    let fileRef = '';
    if (options?.includeFile) {
      const lineInfo = options.showLineNumbers
        ? ` (Líneas ${selection.startLine} - ${selection.endLine})`
        : '';
      fileRef = `\n\n📌 Archivo: ${selection.relativePath}${lineInfo}`;
    }

    const fullText = `${body}${fileRef}\n\n${hashtagStr}`;
    return { text: fullText.trim(), hashtags };
  }

  /**
   * Genera el texto inicial de la publicación basado en el último commit
   */
  public composeFromCommit(
    commit: CommitContext,
    variant: TemplateVariant = 'technical',
    options?: PublicationOptions
  ): { text: string; hashtags: string[] } {
    const filesList = commit.changedFiles
      .slice(0, 3)
      .map((f) => f.filePath)
      .join(', ');

    const detectedLang = this.detectLanguageFromFiles(commit.changedFiles.map((f) => f.filePath));
    const hashtags = this.suggestHashtags(detectedLang, filesList, commit.message);
    const hashtagStr = hashtags.join(' ');

    let body = '';
    const cleanMsg = commit.message.split('\n')[0];

    switch (variant) {
      case 'technical':
        body = `🚀 Actualización técnica: ${cleanMsg}\n\nSe aplicaron mejoras en el flujo de trabajo afectando ${commit.changedFiles.length} archivo(s) clave (${filesList || 'repositorio'}).`;
        break;
      case 'learning':
        body = `💡 Aprendizaje del último commit: "${cleanMsg}"\n\nIterar en pequeñas unidades y mantener un historial de cambios descriptivo acelera las revisiones de código y la calidad del producto.`;
        break;
      case 'experience':
        body = `Nuevo commit completado en la rama ${commit.branch || 'main'}: "${cleanMsg}". Seguimos avanzando paso a paso.`;
        break;
    }

    const fullText = `${body}\n\n${hashtagStr}`;
    return { text: fullText.trim(), hashtags };
  }

  /**
   * Sugiere hashtags relevantes según lenguaje, archivo y contenido
   */
  public suggestHashtags(languageId: string, fileName: string, codeSnippet: string): string[] {
    const tags = new Set<string>();

    // Hashtags de lenguaje
    const langMap: Record<string, string[]> = {
      typescript: ['#TypeScript', '#CleanCode'],
      typescriptreact: ['#TypeScript', '#React', '#WebDevelopment'],
      javascript: ['#JavaScript', '#WebDev'],
      javascriptreact: ['#JavaScript', '#React'],
      python: ['#Python', '#SoftwareEngineering'],
      rust: ['#Rust', '#SystemsProgramming'],
      go: ['#Golang', '#Backend'],
      java: ['#Java', '#Backend'],
      php: ['#PHP', '#Laravel'],
      sql: ['#SQL', '#Databases'],
    };

    const found = langMap[languageId.toLowerCase()];
    if (found) {
      found.forEach((t) => tags.add(t));
    } else {
      tags.add('#Programming');
      tags.add('#CleanCode');
    }

    // Detección de frameworks por palabras clave en el código o nombre de archivo
    const lowerCode = (codeSnippet + ' ' + fileName).toLowerCase();
    if (lowerCode.includes('prisma')) tags.add('#Prisma');
    if (lowerCode.includes('nest')) tags.add('#NestJS');
    if (lowerCode.includes('angular')) tags.add('#Angular');
    if (lowerCode.includes('docker')) tags.add('#DevOps');
    if (lowerCode.includes('test') || lowerCode.includes('describe') || lowerCode.includes('assert'))
      tags.add('#Testing');

    tags.add('#SoftwareEngineering');
    tags.add('#WebDevelopment');

    return Array.from(tags).slice(0, 5);
  }

  /**
   * Generación opcional con IA usando la API nativa `vscode.lm`
   */
  public async generateWithAI(
    contextText: string,
    modelFamily = 'gpt-4o'
  ): Promise<string> {
    if (!('lm' in vscode) || typeof vscode.lm.selectChatModels !== 'function') {
      throw new Error('La API `vscode.lm` no está disponible en este entorno.');
    }

    let [model] = await vscode.lm.selectChatModels({ family: modelFamily });
    if (!model) {
      [model] = await vscode.lm.selectChatModels();
    }
    if (!model) {
      throw new Error('No se encontraron modelos de IA disponibles en VS Code.');
    }

    const messages = [
      vscode.LanguageModelChatMessage.User(
        `Eres un Developer Advocate experto en redacción para LinkedIn.
A partir del siguiente código o commit, redacta un post breve, profesional, técnico y atractivo en español.
No inventes métricas ni funcionalidades no respaldadas por el código.
Incluye 4-5 hashtags técnicos al final.

Contexto:
${contextText.slice(0, 3000)}`
      ),
    ];

    const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
    let result = '';
    for await (const chunk of response.text) {
      result += chunk;
    }
    return result.trim();
  }

  private formatLanguageName(langId: string): string {
    const map: Record<string, string> = {
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      python: 'Python',
      rust: 'Rust',
      go: 'Go',
      java: 'Java',
      php: 'PHP',
      csharp: 'C#',
      cpp: 'C++',
    };
    return map[langId.toLowerCase()] || langId;
  }

  private detectLanguageFromFiles(files: string[]): string {
    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'typescript';
      if (file.endsWith('.js') || file.endsWith('.jsx')) return 'javascript';
      if (file.endsWith('.py')) return 'python';
      if (file.endsWith('.rs')) return 'rust';
      if (file.endsWith('.go')) return 'go';
    }
    return 'plaintext';
  }
}

