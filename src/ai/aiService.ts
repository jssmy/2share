import * as vscode from 'vscode';
import { GitCommitContext } from '../types';

export class AIService {
  constructor(private preferredFamily?: string) {
    if (!this.preferredFamily) {
      const config = vscode.workspace.getConfiguration('2share');
      this.preferredFamily = config.get<string>('aiModelFamily', 'gpt-4o');
    }
  }

  /**
   * Obtiene un modelo de lenguaje disponible a través de la API `vscode.lm`
   * Cumple con REQ-002 Escenario 1
   */
  private async getLanguageModel(): Promise<vscode.LanguageModelChat> {
    if (!('lm' in vscode) || typeof vscode.lm.selectChatModels !== 'function') {
      throw new Error(
        'La API Language Model (`vscode.lm`) no está soportada o disponible en esta versión de VS Code.'
      );
    }

    let models: vscode.LanguageModelChat[] = [];

    // 1. Intentar con la familia preferida configurada
    if (this.preferredFamily) {
      try {
        models = await vscode.lm.selectChatModels({ family: this.preferredFamily });
      } catch (err) {
        // Ignorar y caer en selección general
      }
    }

    // 2. Si no hay modelo de la familia preferida, buscar cualquier modelo de chat disponible
    if (!models || models.length === 0) {
      models = await vscode.lm.selectChatModels();
    }

    if (!models || models.length === 0) {
      throw new Error(
        'No se encontraron modelos de IA disponibles en el entorno de VS Code. Asegúrate de tener activa una extensión como GitHub Copilot u otro proveedor de IA compatible.'
      );
    }

    return models[0];
  }

  /**
   * Genera el texto estructurado del post para LinkedIn
   * Cumple con REQ-002 Escenario 2
   */
  public async generatePost(
    commitContext: GitCommitContext,
    cancellationToken?: vscode.CancellationToken
  ): Promise<string> {
    const model = await this.getLanguageModel();

    // Resumen simplificado de archivos modificados para no desbordar el contexto
    const filesSummary = commitContext.changedFiles
      .slice(0, 5)
      .map((f) => `- ${f.filePath} (+${f.additions}/-${f.deletions})`)
      .join('\n');

    // Recortar diff representativo (máximo 4000 caracteres)
    const diffSample = (commitContext.unifiedDiff || '').slice(0, 4000);

    const promptText = `Eres un experto en Developer Advocacy y redacción de contenido técnico de alto impacto para LinkedIn.
Tu misión es transformar el siguiente commit de Git en una publicación profesional, educativa, concisa y atractiva.

Información del Commit:
- Mensaje: "${commitContext.message}"
- Autor: ${commitContext.author}
- Archivos Modificados:
${filesSummary}

Muestra del Diff:
${diffSample}

Estructura requerida de la publicación:
1. Hook inicial: 1-2 oraciones que capturen la atención de ingenieros de software sin sonar a clickbait.
2. Contexto & Solución: Qué problema se resolvió o qué se implementó, de forma directa y clara.
3. Reto técnico o aprendizaje: Un detalle técnico interesante del código o arquitectura que aporte valor a la comunidad.
4. Llamado a la conversación: Pregunta abierta para motivar comentarios.
5. Hashtags recomendados (4-6 hashtags técnicos relevantes).

Nota de estilo:
- Usa saltos de línea limpios para facilitar la lectura rápida en el feed móvil.
- No uses emojis excesivos; mantén un tono profesional e inspirador.
- Escribe directamente el texto final en español, sin preámbulos como "Aquí tienes tu post:".`;

    const messages = [
      vscode.LanguageModelChatMessage.User(promptText),
    ];

    const token = cancellationToken || new vscode.CancellationTokenSource().token;
    const response = await model.sendRequest(messages, {}, token);

    let fullText = '';
    for await (const chunk of response.text) {
      fullText += chunk;
    }

    return fullText.trim();
  }

  /**
   * Generador de fallback con plantilla en caso de que no haya IA disponible
   * Permite al usuario continuar sin bloquearse (REQ-002 Escenario 3)
   */
  public generateManualTemplate(commitContext: GitCommitContext): string {
    const fileList = commitContext.changedFiles
      .slice(0, 3)
      .map((f) => `• ${f.filePath}`)
      .join('\n');

    return `🚀 Actualización de código: ${commitContext.message}

Hoy estuve trabajando en una mejora importante en nuestro proyecto:
${fileList}

💡 Reto técnico superado:
Detalla aquí el principal desafío que encontraste al implementar estos cambios y cómo lo resolviste.

¿Cómo sueles abordar este tipo de problemas en tus proyectos? Me encantaría leer sus experiencias en los comentarios. 👇

#SoftwareEngineering #CleanCode #Developer #Git #TechCommunity`;
  }
}
