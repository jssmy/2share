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
    options?: PublicationOptions,
    customContext?: string
  ): { text: string; hashtags: string[] } {
    const lang = this.formatLanguageName(selection.languageId);
    const hashtags = this.suggestHashtags(
      selection.languageId,
      selection.fileName,
      (selection.text + ' ' + (customContext || '')).trim()
    );
    const hashtagStr = hashtags.join(' ');

    let body = '';
    switch (variant) {
      case 'technical':
        if (customContext && customContext.trim()) {
          body = `Implementación técnica en ${selection.fileName} (${lang}):\n\n${customContext.trim()}\n\nEste método estructura la lógica con patrones limpios, tipado estricto y alta mantenibilidad.`;
        } else if (
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
        body = `Comparto un aprendizaje técnico clave trabajando en ${selection.fileName} con ${lang}:\n\n${
          customContext ? customContext.trim() + '\n\n' : ''
        }La estructuración modular y el tipado estricto aceleran la mantenibilidad y reducen la deuda técnica en el desarrollo de software.`;
        break;
      case 'experience':
        body = customContext && customContext.trim()
          ? `${customContext.trim()}\n\nComparto este avance que implementé en mi proyecto. ¡Espero que sea de utilidad!`
          : options?.messageTemplate ||
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
    options?: PublicationOptions,
    customContext?: string
  ): { text: string; hashtags: string[] } {
    return this.composeFromMultiCommits([commit], [], customContext, variant, options);
  }

  /**
   * Genera el post basado en uno o más commits seleccionados, archivos elegidos y contexto opcional
   */
  public composeFromMultiCommits(
    commits: CommitContext[],
    selectedFiles: string[] = [],
    customContext?: string,
    variant: TemplateVariant = 'technical',
    options?: PublicationOptions
  ): { text: string; hashtags: string[] } {
    if (!commits || commits.length === 0) {
      return {
        text: 'No se han seleccionado commits.',
        hashtags: ['#Git', '#Development'],
      };
    }

    // Archivos combinados de los commits o filtrados según selección del usuario
    const allCommitFiles = Array.from(
      new Set(commits.flatMap((c) => c.changedFiles.map((f) => f.filePath)))
    );
    const targetFiles = selectedFiles.length > 0 ? selectedFiles : allCommitFiles;
    const filesList = targetFiles.slice(0, 3).join(', ');
    const detectedLang = this.detectLanguageFromFiles(targetFiles);

    const combinedText =
      commits.map((c) => c.message).join(' ') + ' ' + (customContext || '');
    const hashtags = this.suggestHashtags(detectedLang, filesList, combinedText);
    const hashtagStr = hashtags.join(' ');

    let body = '';
    const mainMsg = commits[0].message.split('\n')[0];
    const isMulti = commits.length > 1;

    switch (variant) {
      case 'technical':
        if (customContext && customContext.trim()) {
          body = `🚀 Actualización de desarrollo:\n\n${customContext.trim()}\n\n`;
          if (isMulti) {
            body += `📦 Incluye ${commits.length} commits recientes:\n` +
              commits.map((c) => `• ${c.shortHash}: ${c.message.split('\n')[0]}`).join('\n');
          } else {
            body += `Commit: ${commits[0].shortHash} - "${mainMsg}"`;
          }
        } else if (isMulti) {
          body = `🚀 Resumen de commits (${commits.length} actualizaciones en rama ${commits[0].branch || 'main'}):\n\n` +
            commits.map((c) => `• ${c.shortHash}: ${c.message.split('\n')[0]}`).join('\n') +
            `\n\nArchivos clave afectados: ${filesList || 'repositorio'}.`;
        } else {
          body = `🚀 Actualización técnica: ${mainMsg}\n\nSe aplicaron mejoras en el flujo de trabajo afectando ${commits[0].changedFiles.length} archivo(s) clave (${filesList || 'repositorio'}).`;
        }
        break;

      case 'learning':
        body = `💡 Aprendizaje técnico del sprint:\n\n` +
          (customContext ? `${customContext.trim()}\n\n` : '') +
          `Trabajando en ${isMulti ? `${commits.length} commits` : `"${mainMsg}"`}: ` +
          `Mantener cambios atómicos, verificables y bien documentados agiliza el despliegue y eleva los estándares del equipo.`;
        break;

      case 'experience':
        if (customContext && customContext.trim()) {
          body = `${customContext.trim()}\n\nAvanzando en la rama ${commits[0].branch || 'main'} con ${commits.length} commit(s) integrados.`;
        } else {
          body = isMulti
            ? `${commits.length} commits integrados exitosamente en la rama ${commits[0].branch || 'main'}. Compartiendo el avance de esta jornada de desarrollo.`
            : `Nuevo commit completado en la rama ${commits[0].branch || 'main'}: "${mainMsg}". Seguimos avanzando paso a paso.`;
        }
        break;
    }

    let filesRef = '';
    const shouldIncludeFile = options ? options.includeFile : true;
    if (shouldIncludeFile && targetFiles.length > 0) {
      filesRef = `\n\n📌 Archivos: ${targetFiles.slice(0, 4).join(', ')}`;
    }

    const fullText = `${body}${filesRef}\n\n${hashtagStr}`;
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
   * Generación asistida con IA usando la API nativa `vscode.lm`
   * Sintetiza las instrucciones del usuario como eje central junto con el código real
   * (Cumple con REQ-002 Escenarios 1, 2 y 4)
   */
  public async generateWithAI(
    codeContext: string,
    modelFamily = 'gpt-4o',
    userInstructions?: string,
    variant: TemplateVariant = 'technical'
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

    const styleInstructions: Record<TemplateVariant, string> = {
      technical: 'Enfoque técnico, arquitectónico y de ingeniería de software (patrones, tipado estricto, buenas prácticas).',
      learning: 'Enfoque de aprendizaje ("Qué aprendí"): comparte reflexiones, desafíos superados y lecciones aplicables.',
      experience: 'Enfoque de trayectoria / personal: relata el avance del proyecto, decisiones técnicas y aprendizajes prácticos.',
    };

    const instructionsBlock = userInstructions && userInstructions.trim()
      ? `\n🎯 OBJETIVO Y CONTEXTO DEL USUARIO (Prioridad máxima para guiar la publicación):\n${userInstructions.trim()}\n`
      : '';

    const systemPrompt = `Eres un Developer Advocate y creador de contenido técnico senior para LinkedIn.
Tu labor es redactar un post auténtico, técnico y de alto valor en español.
El post debe partir de las instrucciones y contexto provisto por el autor, sustentándolo con el código o cambios del repositorio.

Estructura recomendada:
1. Gancho inicial (Hook): Una primera línea contundente que despierte curiosidad técnica (evita saludos vacíos como "Hola red").
2. Contexto e implementación: Explica claramente qué se construyó, qué problema resuelve y cómo funciona el código adjunto.
3. Decisión arquitectónica o lección clave: Por qué se tomó este camino (mantenibilidad, rendimiento, seguridad).
4. Pregunta de debate: Cierre invitando a la interacción con otros desarrolladores.
5. Hashtags: 4 o 5 hashtags pertinentes (#TypeScript, #CleanCode, #Backend, etc.) al final.

Reglas:
- No inventes tecnologías, funciones ni métricas que no estén en el código o en las instrucciones del usuario.
- Tono: profesional, conciso y entusiasta, sin clichés artificiales.`;

    const userPrompt = `${systemPrompt}

${instructionsBlock}
📐 Estilo deseado: ${styleInstructions[variant] || styleInstructions.technical}

💻 CÓDIGO Y DETALLES TÉCNICOS:
${codeContext.slice(0, 3500)}`;

    const messages = [vscode.LanguageModelChatMessage.User(userPrompt)];

    const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
    let result = '';
    for await (const chunk of response.text) {
      result += chunk;
    }
    return result.trim();
  }

  /**
   * Genera un borrador estructurado cuando la IA no está disponible,
   * articulando fluidamente las instrucciones del usuario con el código.
   */
  public generateSmartDraft(
    codeSummary: string,
    userInstructions?: string,
    variant: TemplateVariant = 'technical'
  ): string {
    const hasInstructions = userInstructions && userInstructions.trim().length > 0;
    const cleanContext = hasInstructions ? userInstructions!.trim() : '';

    let hook = '🚀 Avance técnico en el proyecto:';
    if (variant === 'learning') {
      hook = '💡 Aprendizaje clave de desarrollo:';
    } else if (variant === 'experience') {
      hook = '🛠️ Compartiendo una decisión técnica reciente:';
    }

    let core = '';
    if (hasInstructions) {
      core = `${cleanContext}\n\nAnalizando la implementación en el código, la solución garantiza una estructura modular, tipado estricto y alta previsibilidad.`;
    } else {
      core = `Implementamos mejoras importantes en la lógica de negocio, priorizando la legibilidad, mantenibilidad y robustez de la arquitectura.`;
    }

    const debate = '\n\n¿Qué enfoque sueles utilizar para abordar este tipo de requerimientos? Te leo en los comentarios. 👇';
    const hashtags = '\n\n#SoftwareEngineering #CleanCode #Development #TechCommunity';

    return `${hook}\n\n${core}${debate}${hashtags}`;
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

