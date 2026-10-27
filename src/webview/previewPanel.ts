import * as vscode from 'vscode';
import { CodeSnippetSnapshot, GitCommitContext, SnapshotTheme, WebviewMessage } from '../types';

export interface PreviewPanelCallbacks {
  onRegenerateAI: () => Promise<string>;
  onChangeTheme: (theme: SnapshotTheme) => Promise<CodeSnippetSnapshot>;
  onPublish: (text: string, snapshot: CodeSnippetSnapshot) => Promise<void>;
}

export class PreviewPanel {
  public static currentPanel: PreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private currentText: string;
  private currentSnapshot: CodeSnippetSnapshot;
  private commitContext: GitCommitContext;
  private callbacks: PreviewPanelCallbacks;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    commitContext: GitCommitContext,
    initialText: string,
    initialSnapshot: CodeSnippetSnapshot,
    callbacks: PreviewPanelCallbacks
  ) {
    this.panel = panel;
    this.commitContext = commitContext;
    this.currentText = initialText;
    this.currentSnapshot = initialSnapshot;
    this.callbacks = callbacks;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message: any) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    this.updateWebviewContent();
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    commitContext: GitCommitContext,
    initialText: string,
    initialSnapshot: CodeSnippetSnapshot,
    callbacks: PreviewPanelCallbacks
  ): PreviewPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (PreviewPanel.currentPanel) {
      PreviewPanel.currentPanel.panel.reveal(column);
      PreviewPanel.currentPanel.updateData(commitContext, initialText, initialSnapshot, callbacks);
      return PreviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      '2sharePreview',
      '2share - Vista Previa de Publicación',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    PreviewPanel.currentPanel = new PreviewPanel(
      panel,
      extensionUri,
      commitContext,
      initialText,
      initialSnapshot,
      callbacks
    );

    return PreviewPanel.currentPanel;
  }

  public updateData(
    commitContext: GitCommitContext,
    text: string,
    snapshot: CodeSnippetSnapshot,
    callbacks: PreviewPanelCallbacks
  ) {
    this.commitContext = commitContext;
    this.currentText = text;
    this.currentSnapshot = snapshot;
    this.callbacks = callbacks;
    this.updateWebviewContent();
  }

  private async handleMessage(message: any) {
    switch (message.command) {
      case 'updateText':
        this.currentText = message.text;
        break;

      case 'regenerateAI':
        this.setLoading(true, 'Consultando modelo de IA de VS Code...');
        try {
          const newText = await this.callbacks.onRegenerateAI();
          this.currentText = newText;
          this.panel.webview.postMessage({ command: 'setText', text: newText });
        } catch (err: any) {
          vscode.window.showErrorMessage(`2share: Error al regenerar post: ${err.message}`);
        } finally {
          this.setLoading(false);
        }
        break;

      case 'changeTheme':
        try {
          const newSnapshot = await this.callbacks.onChangeTheme(message.theme);
          this.currentSnapshot = newSnapshot;
          this.panel.webview.postMessage({
            command: 'setImage',
            dataUri: newSnapshot.dataUri,
            theme: newSnapshot.theme,
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`2share: Error al cambiar tema: ${err.message}`);
        }
        break;

      case 'publish':
        this.setLoading(true, 'Publicando en LinkedIn...');
        try {
          await this.callbacks.onPublish(message.text || this.currentText, this.currentSnapshot);
        } catch (err: any) {
          vscode.window.showErrorMessage(`2share: ${err.message}`);
        } finally {
          this.setLoading(false);
        }
        break;
    }
  }

  private setLoading(loading: boolean, text = 'Procesando...') {
    this.panel.webview.postMessage({ command: 'setLoading', loading, text });
  }

  private updateWebviewContent() {
    this.panel.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const author = this.commitContext.author || 'Tú (Desarrollador)';
    const dateStr = this.commitContext.date || 'Hace unos momentos';
    const shortHash = this.commitContext.shortHash;
    const commitMsg = this.commitContext.message;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2share - Vista Previa</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --card-bg: #ffffff;
      --card-text: #191919;
      --border: #e0e0e0;
      --accent: #0a66c2;
      --accent-hover: #004182;
      --subtext: #666666;
    }
    body {
      background-color: var(--bg);
      color: var(--vscode-editor-foreground, #cccccc);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container {
      max-width: 680px;
      width: 100%;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-widget-border, #333);
    }
    .badge {
      background: var(--vscode-badge-background, #0e639c);
      color: var(--vscode-badge-foreground, #ffffff);
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-family: monospace;
    }
    /* Simulador de Tarjeta de LinkedIn */
    .linkedin-card {
      background-color: var(--card-bg);
      color: var(--card-text);
      border-radius: 8px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      overflow: hidden;
      margin-bottom: 20px;
    }
    .linkedin-header {
      display: flex;
      align-items: center;
      padding: 14px 16px 8px 16px;
    }
    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #0a66c2;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 20px;
      margin-right: 12px;
    }
    .user-meta h4 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #191919;
    }
    .user-meta p {
      margin: 2px 0 0 0;
      font-size: 12px;
      color: var(--subtext);
    }
    .editor-wrapper {
      padding: 12px 16px;
    }
    .post-editor {
      width: 100%;
      min-height: 140px;
      border: 1px solid #dcdcdc;
      border-radius: 6px;
      padding: 10px;
      font-size: 14px;
      line-height: 1.5;
      font-family: inherit;
      resize: vertical;
      box-sizing: border-box;
      outline: none;
    }
    .post-editor:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(10, 102, 194, 0.2);
    }
    .char-counter {
      text-align: right;
      font-size: 12px;
      color: var(--subtext);
      margin-top: 4px;
    }
    .char-counter.limit {
      color: #d32f2f;
      font-weight: bold;
    }
    .image-preview-area {
      background: #0d1117;
      text-align: center;
      padding: 12px;
      border-top: 1px solid #eee;
    }
    .image-preview-area img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    /* Acciones y Controles */
    .toolbar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
    }
    .theme-selector {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    select, button {
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
    }
    select {
      background: var(--vscode-dropdown-background, #252526);
      color: var(--vscode-dropdown-foreground, #fff);
      border: 1px solid var(--vscode-dropdown-border, #454545);
    }
    .btn {
      font-weight: 600;
      transition: background 0.2s;
      border: none;
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .btn-primary {
      background: #0a66c2;
      color: #ffffff;
      padding: 10px 20px;
      font-size: 14px;
    }
    .btn-primary:hover {
      background: #004182;
    }
    /* Overlay de carga */
    #loading-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.65);
      z-index: 100;
      justify-content: center;
      align-items: center;
      flex-direction: column;
      color: #fff;
    }
    .spinner {
      border: 4px solid rgba(255,255,255,0.2);
      border-left-color: #0a66c2;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      animation: spin 0.8s linear infinite;
      margin-bottom: 12px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-bar">
      <div>
        <h3 style="margin: 0;">2share: Simulador de Publicación LinkedIn</h3>
        <small style="color: var(--vscode-descriptionForeground, #999);">Commit: <strong>${escapeHtml(commitMsg)}</strong></small>
      </div>
      <span class="badge">${shortHash}</span>
    </div>

    <!-- Simulador LinkedIn -->
    <div class="linkedin-card">
      <div class="linkedin-header">
        <div class="avatar">${escapeHtml(author.charAt(0).toUpperCase())}</div>
        <div class="user-meta">
          <h4>${escapeHtml(author)}</h4>
          <p>Desarrollador de Software • ${escapeHtml(dateStr)} • 🌐 Público</p>
        </div>
      </div>

      <div class="editor-wrapper">
        <textarea id="post-text" class="post-editor" placeholder="Escribe o afina tu post aquí...">${escapeHtml(this.currentText)}</textarea>
        <div id="char-counter" class="char-counter">0 / 3000 caracteres</div>
      </div>

      <div class="image-preview-area">
        <img id="snippet-img" src="${this.currentSnapshot.dataUri}" alt="Captura de código" />
      </div>
    </div>

    <!-- Barra de Herramientas -->
    <div class="toolbar">
      <div class="theme-selector">
        <label for="theme-select">Tema de código:</label>
        <select id="theme-select">
          <option value="nord" ${this.currentSnapshot.theme === 'nord' ? 'selected' : ''}>Nord</option>
          <option value="one-dark-pro" ${this.currentSnapshot.theme === 'one-dark-pro' ? 'selected' : ''}>One Dark Pro</option>
          <option value="github-dark" ${this.currentSnapshot.theme === 'github-dark' ? 'selected' : ''}>GitHub Dark</option>
          <option value="dracula" ${this.currentSnapshot.theme === 'dracula' ? 'selected' : ''}>Dracula</option>
        </select>
        <button id="btn-regenerate" class="btn btn-secondary">✨ Regenerar con IA</button>
      </div>

      <button id="btn-publish" class="btn btn-primary">🚀 Publicar en LinkedIn</button>
    </div>
  </div>

  <div id="loading-overlay">
    <div class="spinner"></div>
    <div id="loading-text">Cargando...</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const textArea = document.getElementById('post-text');
    const charCounter = document.getElementById('char-counter');
    const imgPreview = document.getElementById('snippet-img');
    const themeSelect = document.getElementById('theme-select');
    const btnRegenerate = document.getElementById('btn-regenerate');
    const btnPublish = document.getElementById('btn-publish');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    function updateCounter() {
      const len = textArea.value.length;
      charCounter.innerText = \`\${len} / 3000 caracteres\`;
      if (len > 3000) {
        charCounter.classList.add('limit');
      } else {
        charCounter.classList.remove('limit');
      }
    }

    updateCounter();

    textArea.addEventListener('input', () => {
      updateCounter();
      vscode.postMessage({ command: 'updateText', text: textArea.value });
    });

    themeSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'changeTheme', theme: themeSelect.value });
    });

    btnRegenerate.addEventListener('click', () => {
      vscode.postMessage({ command: 'regenerateAI' });
    });

    btnPublish.addEventListener('click', () => {
      vscode.postMessage({ command: 'publish', text: textArea.value });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.command) {
        case 'setText':
          textArea.value = msg.text;
          updateCounter();
          break;
        case 'setImage':
          imgPreview.src = msg.dataUri;
          break;
        case 'setLoading':
          if (msg.loading) {
            loadingText.innerText = msg.text || 'Cargando...';
            loadingOverlay.style.display = 'flex';
          } else {
            loadingOverlay.style.display = 'none';
          }
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  public dispose() {
    PreviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}

function escapeHtml(unsafe: string): string {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
