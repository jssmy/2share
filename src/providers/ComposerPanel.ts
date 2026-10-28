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

    // 2. Cargar datos de la pestaña
    await this.switchTab(initialTab);
  }

  public async switchTab(tab: 'selection' | 'commit') {
    this.state.activeTab = tab;

    if (tab === 'selection') {
      const sel = this.selectionService.getEditorSelection();
      this.state.selection = sel;
      if (sel) {
        const { text, hashtags } = this.composerService.composeFromSelection(
          sel,
          'technical',
          this.state.options
        );
        this.state.postText = text;
        this.state.suggestedHashtags = hashtags;
      } else {
        this.state.postText =
          'Selecciona unas líneas de código en el editor para previsualizar la publicación.';
        this.state.suggestedHashtags = ['#CleanCode', '#SoftwareEngineering'];
      }
    } else {
      try {
        const commit = await this.gitService.getLastCommit();
        this.state.commit = commit;
        const { text, hashtags } = this.composerService.composeFromCommit(
          commit,
          'technical',
          this.state.options
        );
        this.state.postText = text;
        this.state.suggestedHashtags = hashtags;
      } catch (err: any) {
        this.state.postText = `No se pudieron cargar commits de Git: ${err.message}`;
        this.state.suggestedHashtags = ['#Git', '#Development'];
      }
    }

    this.render();
  }

  private async handleMessage(message: any) {
    switch (message.command) {
      case 'switchTab':
        await this.switchTab(message.tab);
        break;

      case 'updateText':
        this.state.postText = message.text;
        break;

      case 'changeVariant':
        if (this.state.activeTab === 'selection' && this.state.selection) {
          const { text, hashtags } = this.composerService.composeFromSelection(
            this.state.selection,
            message.variant as TemplateVariant,
            this.state.options
          );
          this.state.postText = text;
          this.state.suggestedHashtags = hashtags;
          this.panel.webview.postMessage({ command: 'setText', text });
        } else if (this.state.commit) {
          const { text, hashtags } = this.composerService.composeFromCommit(
            this.state.commit,
            message.variant as TemplateVariant,
            this.state.options
          );
          this.state.postText = text;
          this.state.suggestedHashtags = hashtags;
          this.panel.webview.postMessage({ command: 'setText', text });
        }
        break;

      case 'generateAI':
        this.setLoading(true, 'Generando publicación con IA de VS Code...');
        try {
          const context =
            this.state.activeTab === 'selection'
              ? this.state.selection?.text || ''
              : `${this.state.commit?.message}\n${this.state.commit?.diffSummary}`;
          const aiText = await this.composerService.generateWithAI(
            context,
            this.state.options.aiModelFamily
          );
          this.state.postText = aiText;
          this.panel.webview.postMessage({ command: 'setText', text: aiText });
        } catch (err: any) {
          vscode.window.showWarningMessage(
            `Share to LinkedIn: No se pudo conectar a la IA (${err.message}). Usando plantilla.`
          );
        } finally {
          this.setLoading(false);
        }
        break;

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
        this.setLoading(true, 'Publicando en LinkedIn...');
        try {
          const result = await this.linkedInClient.createPost(message.text || this.state.postText);
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

    const fileName = isSelection
      ? sel?.fileName || 'users.service.ts'
      : commit
      ? `${commit.shortHash}: ${commit.message.split('\n')[0]}`
      : 'commit';

    const fileSubtext = isSelection
      ? `Líneas ${sel?.startLine || 12} - ${sel?.endLine || 22}`
      : `${commit?.changedFiles.length || 0} archivo(s) modificados en rama ${commit?.branch || 'main'}`;

    const badgeText = isSelection ? sel?.languageBadge || 'TS' : 'GIT';

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
      padding: 16px 20px;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .wrapper {
      max-width: 580px;
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

    /* Tabs */
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
    }

    /* Tarjeta Simulador de LinkedIn */
    .linkedin-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
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
      min-height: 110px;
      outline: none;
      margin-bottom: 12px;
    }
    .post-textarea:focus {
      border-color: var(--linkedin-blue);
    }

    /* Tarjeta Adjunta de Archivo (Referencia visual a la imagen adjunta) */
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

    <!-- Pestañas [ Selección ] y [ Último commit ] -->
    <div class="tabs-bar">
      <button id="tab-selection" class="tab-btn ${isSelection ? 'active' : ''}">Selección</button>
      <button id="tab-commit" class="tab-btn ${!isSelection ? 'active' : ''}">Último commit</button>
    </div>

    <div class="section-title">1. Vista previa</div>

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
      <textarea id="post-text" class="post-textarea" placeholder="Escribe tu publicación...">${this.escapeHtml(
        this.state.postText
      )}</textarea>

      <!-- Tarjeta Adjunta de Archivo / Código -->
      <div class="file-attachment-card">
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

      <!-- Barra de Reacciones -->
      <div class="reactions-bar">
        <div class="reaction-item">👍 Recomendar</div>
        <div class="reaction-item">💬 Comentar</div>
        <div class="reaction-item">🔁 Compartir</div>
        <div class="reaction-item">↗ Enviar</div>
      </div>
    </div>

    <!-- Opciones de generación de variantes -->
    <div class="options-bar">
      <div class="variant-selector">
        <label for="variant-select">Estilo:</label>
        <select id="variant-select">
          <option value="technical">Técnico y Profesional</option>
          <option value="learning">Aprendizaje (Qué aprendí)</option>
          <option value="experience">Experiencia / Personal</option>
        </select>
      </div>
      <button id="btn-generate-ai" class="icon-btn" title="Generar con IA (si está disponible)" style="font-size: 12px; display: flex; align-items: center; gap: 4px;">
        ✨ Asistente IA
      </button>
    </div>

    <!-- Botones de Acción -->
    <button id="btn-publish" class="btn-action-primary">
      <span>in</span>
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
    const postText = document.getElementById('post-text');
    const tabSelection = document.getElementById('tab-selection');
    const tabCommit = document.getElementById('tab-commit');
    const btnPublish = document.getElementById('btn-publish');
    const btnCopy = document.getElementById('btn-copy');
    const btnCancel = document.getElementById('btn-cancel');
    const variantSelect = document.getElementById('variant-select');
    const btnGenerateAI = document.getElementById('btn-generate-ai');
    const linkViewFile = document.getElementById('link-view-file');
    const btnHeaderSettings = document.getElementById('btn-header-settings');
    const btnHeaderClose = document.getElementById('btn-header-close');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    postText.addEventListener('input', () => {
      vscode.postMessage({ command: 'updateText', text: postText.value });
    });

    tabSelection.addEventListener('click', () => {
      vscode.postMessage({ command: 'switchTab', tab: 'selection' });
    });

    tabCommit.addEventListener('click', () => {
      vscode.postMessage({ command: 'switchTab', tab: 'commit' });
    });

    variantSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'changeVariant', variant: variantSelect.value });
    });

    btnGenerateAI.addEventListener('click', () => {
      vscode.postMessage({ command: 'generateAI' });
    });

    linkViewFile?.addEventListener('click', () => {
      vscode.postMessage({ command: 'viewFile' });
    });

    btnPublish.addEventListener('click', () => {
      vscode.postMessage({ command: 'publish', text: postText.value });
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
