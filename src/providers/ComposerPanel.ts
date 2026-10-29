import * as vscode from 'vscode';
import {
  CodeSelectionContext,
  CommitContext,
  ComposerState,
  PublicationOptions,
  TemplateVariant,
} from '../models';
import { SelectionService } from '../services/SelectionService';
import { GitService } from '../services/GitService';
import { PostComposerService } from '../services/PostComposerService';
import { LinkedInClient } from '../services/LinkedInClient';
import { SettingsService } from '../services/SettingsService';

export class ComposerPanel {
  public static currentPanel: ComposerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private state: ComposerState;
  private currentVariant: TemplateVariant = 'technical';
  private workspaceFiles: string[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    private selectionService: SelectionService,
    private gitService: GitService,
    private composerService: PostComposerService,
    private linkedInClient: LinkedInClient,
    private settingsService: SettingsService,
    initialTab: 'selection' | 'commit' = 'selection'
  ) {
    this.panel = panel;

    const options = this.settingsService.getOptions();
    this.state = {
      activeTab: initialTab,
      postText: '',
      suggestedHashtags: [],
      options,
      includeImage: true,
      imageContentType: 'snippet',
      imageContentDescription: '',
      selectedCommitHashes: [],
      selectedFiles: [],
      customContext: '',
      profile: {
        name: 'Joset Manihuari',
        headline: options.userHeadline,
        isConnected: false,
      },
    };

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );
  }

  public static async createOrShow(
    extensionUri: vscode.Uri,
    selectionService: SelectionService,
    gitService: GitService,
    composerService: PostComposerService,
    linkedInClient: LinkedInClient,
    settingsService: SettingsService,
    initialTab: 'selection' | 'commit' = 'selection'
  ): Promise<ComposerPanel> {
    const column = vscode.ViewColumn.Beside;

    if (ComposerPanel.currentPanel) {
      ComposerPanel.currentPanel.panel.reveal(column);
      await ComposerPanel.currentPanel.switchTab(initialTab);
      return ComposerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'shareToLinkedInComposer',
      'Share to LinkedIn',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    const instance = new ComposerPanel(
      panel,
      extensionUri,
      selectionService,
      gitService,
      composerService,
      linkedInClient,
      settingsService,
      initialTab
    );

    ComposerPanel.currentPanel = instance;
    await instance.initialize(initialTab);
    return instance;
  }

  public async initialize(initialTab: 'selection' | 'commit') {
    // 1. Obtener perfil
    this.state.profile = await this.linkedInClient.getUserProfile();
    this.state.options = this.settingsService.getOptions();

    // 2. Cargar archivos del workspace
    try {
      this.workspaceFiles = await this.gitService.getWorkspaceFiles();
    } catch {
      this.workspaceFiles = [];
    }

    // 3. Cargar datos de la pestaña inicial
    await this.switchTab(initialTab);
  }

  public async switchTab(tab: 'selection' | 'commit') {
    this.state.activeTab = tab;

    if (tab === 'selection') {
      const sel = this.selectionService.getEditorSelectionOrSample();
      this.state.selection = sel;
      this.state.imageContentType = 'snippet';
      const { text, hashtags } = this.composerService.composeFromSelection(
        sel,
        this.currentVariant,
        this.state.options,
        this.state.customContext
      );
      this.state.postText = text;
      this.state.suggestedHashtags = hashtags;
    } else {
      try {
        const recent = await this.gitService.getRecentCommits(15);
        this.state.recentCommits = recent;
        if (recent.length > 0) {
          if (!this.state.selectedCommitHashes || this.state.selectedCommitHashes.length === 0) {
            this.state.selectedCommitHashes = [recent[0].hash];
          }
          this.state.commit = recent[0];
          this.state.imageContentType = 'diff';

          // Archivos iniciales
          if (!this.state.selectedFiles || this.state.selectedFiles.length === 0) {
            this.state.selectedFiles = recent[0].changedFiles.map((f) => f.filePath);
          }

          const selectedCommits = recent.filter((c) =>
            this.state.selectedCommitHashes?.includes(c.hash)
          );

          const { text, hashtags } = this.composerService.composeFromMultiCommits(
            selectedCommits.length > 0 ? selectedCommits : [recent[0]],
            this.state.selectedFiles,
            this.state.customContext,
            this.currentVariant,
            this.state.options
          );
          this.state.postText = text;
          this.state.suggestedHashtags = hashtags;
        } else {
          this.state.postText = 'No hay commits registrados en el repositorio Git.';
          this.state.suggestedHashtags = ['#Git', '#Development'];
        }
      } catch (err: any) {
        this.state.postText = `No se pudieron cargar commits de Git: ${err.message}`;
        this.state.suggestedHashtags = ['#Git', '#Development'];
      }
    }

    this.render();
  }

  private regeneratePostText() {
    if (this.state.activeTab === 'selection' && this.state.selection) {
      const { text, hashtags } = this.composerService.composeFromSelection(
        this.state.selection,
        this.currentVariant,
        this.state.options,
        this.state.customContext
      );
      this.state.postText = text;
      this.state.suggestedHashtags = hashtags;
    } else if (this.state.recentCommits && this.state.recentCommits.length > 0) {
      const selected = this.state.recentCommits.filter((c) =>
        this.state.selectedCommitHashes?.includes(c.hash)
      );
      const commitsToUse = selected.length > 0 ? selected : [this.state.recentCommits[0]];
      const { text, hashtags } = this.composerService.composeFromMultiCommits(
        commitsToUse,
        this.state.selectedFiles,
        this.state.customContext,
        this.currentVariant,
        this.state.options
      );
      this.state.postText = text;
      this.state.suggestedHashtags = hashtags;
    }
  }

  private async handleMessage(message: any) {
    switch (message.command) {
      case 'switchTab':
        await this.switchTab(message.tab);
        break;

      case 'updateText':
        this.state.postText = message.text;
        break;

      case 'updateContext':
        this.state.customContext = message.context;
        break;

      case 'toggleCommitSelection': {
        const hash = message.hash;
        let hashes = [...(this.state.selectedCommitHashes || [])];
        if (hashes.includes(hash)) {
          hashes = hashes.filter((h) => h !== hash);
          if (hashes.length === 0 && this.state.recentCommits && this.state.recentCommits.length > 0) {
            hashes = [this.state.recentCommits[0].hash];
          }
        } else {
          hashes.push(hash);
        }
        this.state.selectedCommitHashes = hashes;

        // Actualizar archivos disponibles según los commits seleccionados
        const selected = (this.state.recentCommits || []).filter((c) => hashes.includes(c.hash));
        if (selected.length > 0) {
          this.state.commit = selected[0];
          this.state.selectedFiles = Array.from(
            new Set(selected.flatMap((c) => c.changedFiles.map((f) => f.filePath)))
          );
        }

        this.regeneratePostText();
        this.render();
        break;
      }

      case 'toggleFileSelection': {
        const file = message.file;
        let files = [...(this.state.selectedFiles || [])];
        if (files.includes(file)) {
          files = files.filter((f) => f !== file);
        } else {
          files.push(file);
        }
        this.state.selectedFiles = files;
        this.regeneratePostText();
        this.render();
        break;
      }

      case 'toggleIncludeImage':
        this.state.includeImage = !!message.includeImage;
        this.render();
        break;

      case 'updateImageContent':
        this.state.imageContentType = message.contentType || 'snippet';
        this.state.imageContentDescription = message.description || '';
        this.render();
        break;

      case 'regenerate':
        this.regeneratePostText();
        this.panel.webview.postMessage({ command: 'setText', text: this.state.postText });
        break;

      case 'changeVariant':
        this.currentVariant = message.variant as TemplateVariant;
        this.regeneratePostText();
        this.panel.webview.postMessage({ command: 'setText', text: this.state.postText });
        break;

      case 'generateAI': {
        this.setLoading(true, 'Generando publicación con IA de VS Code...');
        if (message.context !== undefined) {
          this.state.customContext = message.context;
        }

        try {
          let codeContext = '';
          if (this.state.activeTab === 'selection') {
            const sel = this.state.selection || this.selectionService.getEditorSelectionOrSample();
            codeContext = `Archivo: ${sel.relativePath || sel.fileName} (Líneas ${sel.startLine} a ${sel.endLine})
Lenguaje: ${sel.languageId} (${sel.languageBadge})
Código seleccionado:
\`\`\`${sel.languageId}
${sel.text}
\`\`\``;
          } else {
            const selected = (this.state.recentCommits || []).filter((c) =>
              this.state.selectedCommitHashes?.includes(c.hash)
            );
            const commitsToUse =
              selected.length > 0 ? selected : (this.state.recentCommits || []).slice(0, 1);
            codeContext = commitsToUse
              .map(
                (c) =>
                  `Commit: ${c.shortHash} - "${c.message.split('\n')[0]}" (Rama: ${c.branch || 'main'})
Archivos modificados: ${c.changedFiles.map((f) => f.filePath).join(', ')}
Resumen del Diff:
${c.diffSummary || ''}`
              )
              .join('\n---\n');
          }

          let postContent = '';
          try {
            postContent = await this.composerService.generateWithAI(
              codeContext,
              this.state.options.aiModelFamily,
              this.state.customContext,
              this.currentVariant
            );
          } catch (aiErr: any) {
            // Fallback estructurado que combina fielmente el código y las instrucciones del usuario
            postContent = this.composerService.generateSmartDraft(
              codeContext,
              this.state.customContext,
              this.currentVariant
            );
            vscode.window.showInformationMessage(
              `Share to LinkedIn: Borrador generado articulando tu contexto y el código (${aiErr.message}).`
            );
          }

          this.state.postText = postContent;
          this.panel.webview.postMessage({ command: 'setText', text: postContent });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Share to LinkedIn: Error generando con IA: ${err.message}`);
        } finally {
          this.setLoading(false);
        }
        break;
      }

      case 'viewFile':
        if (this.state.selection) {
          const doc = await vscode.workspace.openTextDocument(this.state.selection.fullPath);
          const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
          const range = new vscode.Range(
            this.state.selection.startLine - 1,
            0,
            this.state.selection.endLine - 1,
            100
          );
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range);
        }
        break;

      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text || this.state.postText);
        vscode.window.showInformationMessage('📋 ¡Publicación copiada al portapapeles!');
        break;

      case 'openSettings':
        await vscode.commands.executeCommand('share-to-linkedin.openSettings');
        break;

      case 'close':
        this.dispose();
        break;

      case 'publish':
        this.setLoading(true, 'Preparando publicación...');
        try {
          let imageUrn: string | undefined;

          // Si el usuario tiene habilitada la imagen y se generó el PNG base64
          if (this.state.includeImage && message.imageBase64) {
            this.setLoading(true, 'Subiendo imagen a LinkedIn...');
            try {
              const cleanBase64 = message.imageBase64.replace(/^data:image\/\w+;base64,/, '');
              const imageBuffer = Buffer.from(cleanBase64, 'base64');
              imageUrn = await this.linkedInClient.uploadImage(imageBuffer, 'image/png');
            } catch (imgErr: any) {
              const choice = await vscode.window.showWarningMessage(
                `Share to LinkedIn: No se pudo subir la imagen (${imgErr.message}). ¿Deseas publicar el post solo con texto?`,
                'Publicar solo texto',
                'Cancelar'
              );
              if (choice !== 'Publicar solo texto') {
                this.setLoading(false);
                return;
              }
            }
          }

          this.setLoading(true, 'Publicando en LinkedIn...');
          const result = await this.linkedInClient.createPost(
            message.text || this.state.postText,
            imageUrn
          );

          if (result.success && !result.isMock) {
            const action = await vscode.window.showInformationMessage(
              '🎉 ¡Publicación compartida con éxito en LinkedIn!',
              'Ver Publicación',
              'Cerrar'
            );
            if (action === 'Ver Publicación' && result.postUrl) {
              await vscode.env.openExternal(vscode.Uri.parse(result.postUrl));
            }
          } else if (result.error) {
            vscode.window.showErrorMessage(`Share to LinkedIn: ${result.error}`);
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Share to LinkedIn: Error al publicar: ${err.message}`);
        } finally {
          this.setLoading(false);
        }
        break;
    }
  }

  private setLoading(loading: boolean, text = 'Cargando...') {
    this.panel.webview.postMessage({ command: 'setLoading', loading, text });
  }

  private render() {
    this.panel.webview.html = this.getHtml();
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private getHtml(): string {
    const isSelection = this.state.activeTab === 'selection';
    const sel = this.state.selection;
    const commit = this.state.commit;
    const profile = this.state.profile;
    const recentCommits = this.state.recentCommits || [];
    const selectedHashes = this.state.selectedCommitHashes || [];
    const selectedFiles = this.state.selectedFiles || [];
    const includeImage = this.state.includeImage;

    // Metadatos de la tarjeta adjunta
    let fileName = 'users.service.ts';
    let fileSubtext = 'Líneas 12 - 22';
    let badgeText = 'TS';

    if (isSelection && sel) {
      fileName = sel.fileName;
      fileSubtext = `Líneas ${sel.startLine} - ${sel.endLine}`;
      badgeText = sel.languageBadge || 'TS';
    } else if (!isSelection) {
      if (selectedHashes.length > 1) {
        fileName = `${selectedHashes.length} commits seleccionados (${commit?.branch || 'main'})`;
        fileSubtext = `${selectedFiles.length} archivo(s) modificados`;
        badgeText = 'GIT';
      } else if (commit) {
        fileName = `${commit.shortHash}: ${commit.message.split('\n')[0]}`;
        fileSubtext = `${commit.changedFiles.length} archivo(s) modificados en rama ${commit.branch || 'main'}`;
        badgeText = 'GIT';
      }
    }

    if (this.state.imageContentType === 'custom' && this.state.imageContentDescription) {
      fileSubtext = this.state.imageContentDescription;
    }

    // Todos los archivos modificados disponibles en los commits recientes
    const availableCommitFiles = Array.from(
      new Set(recentCommits.flatMap((c) => c.changedFiles.map((f) => f.filePath)))
    );
    const candidateFiles = availableCommitFiles.length > 0 ? availableCommitFiles : this.workspaceFiles;

    const snippetCode = isSelection && sel
      ? sel.text
      : this.state.imageContentType === 'custom' && this.state.imageContentDescription
      ? this.state.imageContentDescription
      : commit
      ? (commit.diffSummary || commit.changedFiles.map((f) => f.filePath).join('\n') || commit.message)
      : 'export class Service {}';

    const snippetDataJson = JSON.stringify({
      fileName,
      badge: badgeText,
      startLine: isSelection && sel ? sel.startLine : 1,
      code: snippetCode,
    });

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Share to LinkedIn</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #14171d);
      --fg: var(--vscode-editor-foreground, #e1e4ea);
      --linkedin-blue: #0a66c2;
      --linkedin-hover: #004182;
      --card-bg: #1c2029;
      --border: var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      --subtext: var(--vscode-descriptionForeground, #8c93a0);
      --badge-bg: #0a66c2;
    }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      line-height: 1.45;
      padding: 16px 20px 40px;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .wrapper {
      max-width: 600px;
      width: 100%;
    }
    .top-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .brand-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-icon {
      width: 22px;
      height: 22px;
      background: var(--linkedin-blue);
      color: white;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 13px;
    }
    .brand-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .icon-btn {
      background: transparent;
      border: none;
      color: var(--subtext);
      cursor: pointer;
      font-size: 16px;
      padding: 4px 6px;
      border-radius: 4px;
    }
    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    /* Pestañas */
    .tabs-bar {
      display: flex;
      border: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 3px;
      margin-bottom: 18px;
    }
    .tab-btn {
      flex: 1;
      padding: 8px 12px;
      background: transparent;
      border: none;
      color: var(--subtext);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 6px;
      text-align: center;
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .tab-btn.active {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Tarjeta Simulador de LinkedIn */
    .linkedin-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 18px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    .user-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0a66c2, #004182);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 18px;
      flex-shrink: 0;
    }
    .user-info h4 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #ffffff;
    }
    .user-info p {
      margin: 2px 0 0 0;
      font-size: 11px;
      color: var(--subtext);
    }

    /* Editor de texto */
    .post-textarea {
      width: 100%;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.15);
      color: #ffffff;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.5;
      font-family: inherit;
      resize: vertical;
      min-height: 120px;
      outline: none;
      margin-bottom: 12px;
    }
    .post-textarea:focus {
      border-color: var(--linkedin-blue);
    }

    /* Tarjeta Adjunta de Archivo / Código (Fiel a la referencia de diseño) */
    .file-attachment-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      margin-top: 10px;
    }
    .file-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .lang-badge {
      width: 32px;
      height: 32px;
      background: var(--badge-bg);
      color: #ffffff;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .file-meta-col {
      min-width: 0;
    }
    .file-name {
      font-size: 13px;
      font-weight: 600;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-lines {
      font-size: 11px;
      color: var(--subtext);
    }
    .file-action-link {
      color: #4da3ff;
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
      font-weight: 500;
      margin-left: 10px;
    }
    .file-action-link:hover {
      text-decoration: underline;
    }

    /* Barra de Reacciones de LinkedIn */
    .reactions-bar {
      display: flex;
      justify-content: space-around;
      border-top: 1px solid var(--border);
      margin-top: 14px;
      padding-top: 10px;
      font-size: 11px;
      color: var(--subtext);
      user-select: none;
    }
    .reaction-item {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
    }
    .reaction-item:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #ffffff;
    }

    /* Panel de Personalización y Contexto */
    .controls-panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 18px;
    }
    .control-row {
      margin-bottom: 12px;
    }
    .control-row:last-child {
      margin-bottom: 0;
    }
    .control-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--subtext);
      margin-bottom: 6px;
      display: block;
    }
    .input-context {
      width: 100%;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.2);
      color: #ffffff;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
    }
    .input-context:focus {
      border-color: var(--linkedin-blue);
    }

    /* Lista de Commits con selección múltiple */
    .commits-list {
      max-height: 150px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.2);
      padding: 4px;
    }
    .commit-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease;
    }
    .commit-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .commit-item.selected {
      background: rgba(10, 102, 194, 0.2);
      border-left: 2px solid var(--linkedin-blue);
    }
    .commit-hash {
      font-family: monospace;
      color: #4da3ff;
      font-weight: 600;
    }
    .commit-msg {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--fg);
    }

    /* Chips de Archivos */
    .files-chips-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-height: 80px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .file-chip {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
      color: var(--subtext);
      user-select: none;
      transition: all 0.15s ease;
    }
    .file-chip.active {
      background: var(--linkedin-blue);
      color: #ffffff;
      border-color: var(--linkedin-blue);
    }

    /* Switch de Imagen Opcional */
    .image-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      margin-top: 10px;
    }
    .switch-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #ffffff;
      cursor: pointer;
    }

    /* Controles de variantes y botones */
    .options-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      gap: 8px;
      flex-wrap: wrap;
    }
    .variant-selector {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    select {
      background: var(--card-bg);
      color: #fff;
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
    }
    .btn-action-primary {
      width: 100%;
      background: var(--linkedin-blue);
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 11px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.15s ease;
      font-family: inherit;
      margin-bottom: 8px;
    }
    .btn-action-primary:hover {
      background: var(--linkedin-hover);
    }
    .btn-action-secondary {
      width: 100%;
      background: transparent;
      color: var(--subtext);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 9px 16px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s ease;
      font-family: inherit;
      margin-bottom: 8px;
    }
    .btn-action-secondary:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #ffffff;
    }

    /* Overlay de carga */
    #loading-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      z-index: 100;
      justify-content: center;
      align-items: center;
      flex-direction: column;
      color: #fff;
    }
    .spinner {
      border: 3px solid rgba(255,255,255,0.2);
      border-left-color: var(--linkedin-blue);
      border-radius: 50%;
      width: 32px;
      height: 32px;
      animation: spin 0.8s linear infinite;
      margin-bottom: 10px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <!-- Encabezado con título e icono -->
    <div class="top-header">
      <div class="brand-title-wrap">
        <div class="brand-icon">in</div>
        <h3 class="brand-title">Share to LinkedIn</h3>
      </div>
      <div class="header-actions">
        <button id="btn-header-settings" class="icon-btn" title="Configuración">⚙️</button>
        <button id="btn-header-close" class="icon-btn" title="Cerrar">✕</button>
      </div>
    </div>

    <!-- Pestañas [ Selección ] y [ Commits de Git ] -->
    <div class="tabs-bar">
      <button id="tab-selection" class="tab-btn ${isSelection ? 'active' : ''}">Selección</button>
      <button id="tab-commit" class="tab-btn ${!isSelection ? 'active' : ''}">Commits de Git</button>
    </div>

    <div class="section-title">
      <span>1. Vista previa</span>
      ${
        includeImage
          ? '<span style="font-size: 11px; color: #4da3ff;">● Con tarjeta visual</span>'
          : '<span style="font-size: 11px; color: var(--subtext);">○ Solo texto</span>'
      }
    </div>

    <!-- Tarjeta de LinkedIn -->
    <div class="linkedin-card">
      <div class="user-row">
        <div class="avatar">${profile.name.charAt(0).toUpperCase()}</div>
        <div class="user-info">
          <h4>${this.escapeHtml(profile.name)}</h4>
          <p>${this.escapeHtml(profile.headline)} • Ahora • 🌐</p>
        </div>
      </div>

      <!-- Texto del post -->
      <textarea id="post-text" class="post-textarea" placeholder="Escribe o edita tu publicación...">${this.escapeHtml(
        this.state.postText
      )}</textarea>

      <!-- Tarjeta Adjunta de Archivo / Código (Opcional según switch) -->
      ${
        includeImage
          ? `<div class="file-attachment-card">
              <div class="file-left">
                <div class="lang-badge">${this.escapeHtml(badgeText)}</div>
                <div class="file-meta-col">
                  <div class="file-name">${this.escapeHtml(fileName)}</div>
                  <div class="file-lines">${this.escapeHtml(fileSubtext)}</div>
                </div>
              </div>
              ${
                isSelection && sel
                  ? `<a id="link-view-file" class="file-action-link">Ver archivo &gt;</a>`
                  : ''
              }
            </div>
            <div id="image-preview-wrap" style="margin-top: 10px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); background: #0e131f;">
              <canvas id="live-canvas-preview" style="width: 100%; height: auto; display: block; max-height: 200px; object-fit: contain;"></canvas>
            </div>`
          : ''
      }

      <!-- Barra de Reacciones -->
      <div class="reactions-bar">
        <div class="reaction-item">👍 Recomendar</div>
        <div class="reaction-item">💬 Comentar</div>
        <div class="reaction-item">🔁 Compartir</div>
        <div class="reaction-item">↗ Enviar</div>
      </div>
    </div>

    <!-- Panel de Contexto y Selección Avanzada (Cumple con Requerimientos 2, 6 y 7) -->
    <div class="controls-panel">
      <!-- Instrucciones / Contexto para la IA -->
      <div class="control-row">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label class="control-label" for="input-context" style="margin: 0; font-size: 13px; color: #ffffff;">
            ✨ Contexto o instrucciones para la IA:
          </label>
          <span style="font-size: 11px; color: #4da3ff;">La IA redactará el post a partir de tu contexto y el código</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: stretch;">
          <textarea
            id="input-context"
            class="input-context"
            rows="2"
            placeholder="Ej: Explica cómo funciona esta implementación, por qué se eligió esta arquitectura y qué problemas previene en producción..."
            style="resize: vertical; min-height: 48px; line-height: 1.45;"
          >${this.escapeHtml(this.state.customContext || '')}</textarea>
          <button id="btn-generate-ai-context" class="btn-action-primary" style="width: auto; margin: 0; padding: 8px 16px; font-size: 12px; white-space: nowrap; display: flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #0a66c2, #004182);">
            <span>✨</span>
            <span>Generar con IA</span>
          </button>
        </div>
      </div>

      <!-- Si la pestaña activa es commits: selección de múltiples commits y archivos -->
      ${
        !isSelection && recentCommits.length > 0
          ? `
          <div class="control-row" style="margin-top: 12px;">
            <label class="control-label">Commits a incluir (puedes seleccionar varios):</label>
            <div class="commits-list">
              ${recentCommits
                .map((c) => {
                  const isChecked = selectedHashes.includes(c.hash);
                  return `
                  <div class="commit-item ${isChecked ? 'selected' : ''}" data-hash="${c.hash}">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} style="margin: 0;" />
                    <span class="commit-hash">${c.shortHash}</span>
                    <span class="commit-msg">${this.escapeHtml(c.message.split('\n')[0])}</span>
                  </div>`;
                })
                .join('')}
            </div>
          </div>

          <div class="control-row" style="margin-top: 10px;">
            <label class="control-label">Archivos a destacar en la publicación:</label>
            <div class="files-chips-wrap">
              ${candidateFiles
                .slice(0, 15)
                .map((f) => {
                  const isAct = selectedFiles.includes(f);
                  return `<span class="file-chip ${isAct ? 'active' : ''}" data-file="${this.escapeHtml(f)}">${this.escapeHtml(f.split('/').pop() || f)}</span>`;
                })
                .join('')}
            </div>
          </div>
          `
          : ''
      }

      <!-- Control de Imagen Opcional (Cumple con Requerimiento 7) -->
      <div class="image-toggle-row">
        <label class="switch-wrap">
          <input type="checkbox" id="chk-include-image" ${includeImage ? 'checked' : ''} />
          <span>Incluir tarjeta / imagen visual en el post</span>
        </label>
        ${
          includeImage
            ? `
            <select id="select-image-type" style="font-size: 11px; padding: 4px 8px;">
              <option value="snippet" ${this.state.imageContentType === 'snippet' ? 'selected' : ''}>Fragmento de código</option>
              <option value="diff" ${this.state.imageContentType === 'diff' ? 'selected' : ''}>Resumen de cambios (Git)</option>
              <option value="custom" ${this.state.imageContentType === 'custom' ? 'selected' : ''}>Personalizado...</option>
            </select>`
            : ''
        }
      </div>

      ${
        includeImage && this.state.imageContentType === 'custom'
          ? `
          <div class="control-row" style="margin-top: 8px;">
            <input
              id="input-image-desc"
              class="input-context"
              type="text"
              placeholder="Especifica qué mostrar en la imagen (ej: Diagrama de flujo / Arquitectura)..."
              value="${this.escapeHtml(this.state.imageContentDescription || '')}"
            />
          </div>`
          : ''
      }
    </div>

    <!-- Opciones de estilo y Asistente IA -->
    <div class="options-bar">
      <div class="variant-selector">
        <label for="variant-select">Estilo:</label>
        <select id="variant-select">
          <option value="technical" ${this.currentVariant === 'technical' ? 'selected' : ''}>Técnico y Profesional</option>
          <option value="learning" ${this.currentVariant === 'learning' ? 'selected' : ''}>Aprendizaje (Qué aprendí)</option>
          <option value="experience" ${this.currentVariant === 'experience' ? 'selected' : ''}>Experiencia / Personal</option>
        </select>
      </div>
      <div style="display: flex; gap: 6px;">
        <button id="btn-regenerate" class="icon-btn" title="Regenerar con las opciones actuales" style="font-size: 12px; display: flex; align-items: center; gap: 4px;">
          🔄 Regenerar
        </button>
        <button id="btn-generate-ai" class="icon-btn" title="Generar con IA usando tu contexto" style="font-size: 12px; display: flex; align-items: center; gap: 4px;">
          ✨ Asistente IA
        </button>
      </div>
    </div>

    <!-- Botones de Acción -->
    <button id="btn-publish" class="btn-action-primary">
      <span style="background: white; color: #0a66c2; font-weight: 800; font-size: 11px; padding: 1px 4px; border-radius: 2px; margin-right: 4px;">in</span>
      <span>Publicar en LinkedIn</span>
    </button>
    <button id="btn-copy" class="btn-action-secondary">
      📋 Copiar al portapapeles
    </button>
    <button id="btn-cancel" class="btn-action-secondary">
      Cancelar
    </button>
  </div>

  <div id="loading-overlay">
    <div class="spinner"></div>
    <div id="loading-text">Cargando...</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    window._snippetData = ${snippetDataJson};

    function generateCardPng(targetCanvas) {
      const canvas = targetCanvas || document.createElement('canvas');
      const scale = 2;
      const width = 800;
      const padding = 24;
      const headerHeight = 44;
      const lineHeight = 22;

      const rawText = (window._snippetData && window._snippetData.code) || 'console.log("Hello, LinkedIn!");';
      const lines = rawText.split('\\n').slice(0, 20);
      const contentHeight = Math.max(lines.length * lineHeight, 80);
      const height = headerHeight + contentHeight + padding * 2 + 20;

      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      // Fondo degradado
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, '#1a1f2c');
      bgGrad.addColorStop(1, '#0e131f');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Caja de la ventana con esquinas redondeadas
      const cardX = 20;
      const cardY = 16;
      const cardW = width - 40;
      const cardH = height - 32;
      const radius = 10;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#1c2029';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, radius);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Barra superior estilo macOS
      ctx.fillStyle = '#14171d';
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, headerHeight, [radius, radius, 0, 0]);
      ctx.fill();

      // Botones ventana (rojo, amarillo, verde)
      const dotY = cardY + 22;
      ctx.fillStyle = '#ff5f56'; ctx.beginPath(); ctx.arc(cardX + 20, dotY, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffbd2e'; ctx.beginPath(); ctx.arc(cardX + 38, dotY, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#27c93f'; ctx.beginPath(); ctx.arc(cardX + 56, dotY, 6, 0, Math.PI * 2); ctx.fill();

      // Título del archivo
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((window._snippetData && window._snippetData.fileName) || 'users.service.ts', width / 2, dotY + 4);

      // Insignia del lenguaje
      ctx.fillStyle = '#0a66c2';
      ctx.beginPath();
      ctx.roundRect(cardX + cardW - 55, cardY + 12, 38, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText((window._snippetData && window._snippetData.badge) || 'TS', cardX + cardW - 36, cardY + 26);

      // Renderizado de líneas de código
      ctx.textAlign = 'left';
      ctx.font = '13px Menlo, Monaco, "Courier New", monospace';
      const startY = cardY + headerHeight + 22;
      const startLine = (window._snippetData && window._snippetData.startLine) || 1;

      lines.forEach((line, i) => {
        const y = startY + i * lineHeight;
        ctx.fillStyle = '#5c6370';
        ctx.fillText(String(startLine + i).padStart(2, ' '), cardX + 16, y);

        const clean = line.replace(/\\t/g, '  ');
        if (clean.trim().startsWith('//') || clean.trim().startsWith('#')) {
          ctx.fillStyle = '#616e88';
        } else if (clean.match(/\\b(import|export|from|class|const|let|var|function|async|await|return|if|else)\\b/)) {
          ctx.fillStyle = '#81a1c1';
        } else if (clean.match(/['"\`].*?['"\`]/)) {
          ctx.fillStyle = '#a3be8c';
        } else {
          ctx.fillStyle = '#e1e4ea';
        }
        ctx.fillText(clean, cardX + 50, y);
      });

      // Pie con marca Share to LinkedIn
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Share to LinkedIn', cardX + cardW - 14, cardY + cardH - 10);

      return canvas.toDataURL('image/png');
    }

    // Inicializar previsualización en vivo si el elemento existe
    try {
      const liveCanvas = document.getElementById('live-canvas-preview');
      if (liveCanvas) {
        generateCardPng(liveCanvas);
      }
    } catch (e) {
      console.error(e);
    }
    const postText = document.getElementById('post-text');
    const tabSelection = document.getElementById('tab-selection');
    const tabCommit = document.getElementById('tab-commit');
    const btnPublish = document.getElementById('btn-publish');
    const btnCopy = document.getElementById('btn-copy');
    const btnCancel = document.getElementById('btn-cancel');
    const variantSelect = document.getElementById('variant-select');
    const btnGenerateAI = document.getElementById('btn-generate-ai');
    const btnRegenerate = document.getElementById('btn-regenerate');
    const linkViewFile = document.getElementById('link-view-file');
    const btnHeaderSettings = document.getElementById('btn-header-settings');
    const btnHeaderClose = document.getElementById('btn-header-close');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const inputContext = document.getElementById('input-context');
    const btnGenerateAIContext = document.getElementById('btn-generate-ai-context');
    const chkIncludeImage = document.getElementById('chk-include-image');
    const selectImageType = document.getElementById('select-image-type');
    const inputImageDesc = document.getElementById('input-image-desc');

    postText.addEventListener('input', () => {
      vscode.postMessage({ command: 'updateText', text: postText.value });
    });

    tabSelection?.addEventListener('click', () => {
      vscode.postMessage({ command: 'switchTab', tab: 'selection' });
    });

    tabCommit?.addEventListener('click', () => {
      vscode.postMessage({ command: 'switchTab', tab: 'commit' });
    });

    inputContext?.addEventListener('input', () => {
      vscode.postMessage({ command: 'updateContext', context: inputContext.value });
    });

    btnGenerateAIContext?.addEventListener('click', () => {
      vscode.postMessage({
        command: 'generateAI',
        context: inputContext ? inputContext.value.trim() : ''
      });
    });

    inputContext?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        vscode.postMessage({
          command: 'generateAI',
          context: inputContext.value.trim()
        });
      }
    });

    // Delegación para selección de commits
    document.querySelectorAll('.commit-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        const hash = item.getAttribute('data-hash');
        if (hash) {
          vscode.postMessage({ command: 'toggleCommitSelection', hash });
        }
      });
    });

    // Delegación para chips de archivos
    document.querySelectorAll('.file-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const file = chip.getAttribute('data-file');
        if (file) {
          vscode.postMessage({ command: 'toggleFileSelection', file });
        }
      });
    });

    chkIncludeImage?.addEventListener('change', () => {
      vscode.postMessage({ command: 'toggleIncludeImage', includeImage: chkIncludeImage.checked });
    });

    selectImageType?.addEventListener('change', () => {
      vscode.postMessage({
        command: 'updateImageContent',
        contentType: selectImageType.value,
        description: inputImageDesc ? inputImageDesc.value : ''
      });
    });

    inputImageDesc?.addEventListener('input', () => {
      vscode.postMessage({
        command: 'updateImageContent',
        contentType: 'custom',
        description: inputImageDesc.value
      });
    });

    variantSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'changeVariant', variant: variantSelect.value });
    });

    btnRegenerate?.addEventListener('click', () => {
      vscode.postMessage({ command: 'regenerate' });
    });

    btnGenerateAI.addEventListener('click', () => {
      vscode.postMessage({
        command: 'generateAI',
        context: inputContext ? inputContext.value.trim() : ''
      });
    });

    linkViewFile?.addEventListener('click', () => {
      vscode.postMessage({ command: 'viewFile' });
    });

    btnPublish.addEventListener('click', () => {
      let imageBase64 = null;
      if (chkIncludeImage && chkIncludeImage.checked) {
        try {
          imageBase64 = generateCardPng();
        } catch (e) {
          console.error('Error generando imagen de código:', e);
        }
      }
      vscode.postMessage({
        command: 'publish',
        text: postText.value,
        imageBase64: imageBase64
      });
    });

    btnCopy.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyToClipboard', text: postText.value });
    });

    btnCancel.addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    btnHeaderSettings.addEventListener('click', () => {
      vscode.postMessage({ command: 'openSettings' });
    });

    btnHeaderClose.addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'setText') {
        postText.value = msg.text;
      } else if (msg.command === 'setLoading') {
        if (msg.loading) {
          loadingText.innerText = msg.text || 'Cargando...';
          loadingOverlay.style.display = 'flex';
        } else {
          loadingOverlay.style.display = 'none';
        }
      }
    });
  </script>
</body>
</html>`;
  }

  public dispose() {
    ComposerPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
