import * as vscode from 'vscode';
import { LinkedInClient } from '../linkedin/linkedinClient';
import { GitService, CommitSummary } from '../git/gitService';

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = '2share.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly linkedInClient: LinkedInClient,
    private readonly gitService: GitService
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'loginLinkedIn': {
          const success = await this.linkedInClient.promptAuthentication();
          if (success) {
            await this.updateView();
          }
          break;
        }
        case 'disconnectLinkedIn': {
          await this.linkedInClient.clearCredentials();
          vscode.window.showInformationMessage('2share: Sesión de LinkedIn cerrada.');
          await this.updateView();
          break;
        }
        case 'generatePostFromSidebar': {
          await vscode.commands.executeCommand('2share.createPost', {
            mode: message.mode,
            selectedHashes: message.selectedHashes,
            selectedFiles: message.selectedFiles,
            userContext: message.userContext,
          });
          break;
        }
        case 'refresh': {
          await this.updateView();
          break;
        }
        case 'checkStatus': {
          await this.sendStatus();
          break;
        }
      }
    });

    await this.updateView();
  }

  public async refresh(): Promise<void> {
    if (this._view) {
      await this.updateView();
    }
  }

  private async updateView(): Promise<void> {
    if (!this._view) {
      return;
    }
    const token = await this.linkedInClient.getAccessToken();
    const authorUrn = await this.linkedInClient.getAuthorUrn();
    const authorName = await this.linkedInClient.getAuthorName();
    const isConnected = !!token;

    let commits: CommitSummary[] = [];
    try {
      commits = await this.gitService.getRecentCommits(15);
    } catch {
      // Ignorar si no hay git
    }

    let files: { relativePath: string; status: string }[] = [];
    try {
      files = await this.gitService.getWorkspaceFiles();
    } catch {
      // Ignorar si falla
    }

    this._view.webview.html = this.getHtml(isConnected, commits, files, authorUrn, authorName);
  }

  private async sendStatus(): Promise<void> {
    if (!this._view) {
      return;
    }
    const token = await this.linkedInClient.getAccessToken();
    const authorUrn = await this.linkedInClient.getAuthorUrn();
    const authorName = await this.linkedInClient.getAuthorName();
    this._view.webview.postMessage({
      command: 'statusUpdate',
      isConnected: !!token,
      authorUrn: authorUrn || '',
      authorName: authorName || '',
    });
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private getHtml(
    isConnected: boolean,
    commits: CommitSummary[],
    files: { relativePath: string; status: string }[],
    authorUrn?: string,
    authorName?: string
  ): string {
    const statusText = isConnected
      ? `🟢 Conectado ${authorName ? `(${this.escapeHtml(authorName)})` : ''}`
      : '⚪ Sin vincular';
    const statusClass = isConnected ? 'status-connected' : 'status-disconnected';
    const authorDisplay = authorUrn ? authorUrn.replace('urn:li:person:', '') : '';

    const commitsJson = JSON.stringify(commits);
    const filesJson = JSON.stringify(files);

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2share</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #1e1e1e);
      --fg: var(--vscode-sideBar-foreground, #cccccc);
      --accent: #0a66c2;
      --accent-hover: #004182;
      --border: var(--vscode-widget-border, #333333);
      --card-bg: var(--vscode-editor-background, #252526);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #444444);
    }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.4;
      padding: 12px 10px;
      margin: 0;
      box-sizing: border-box;
    }
    .header {
      text-align: center;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }
    .brand-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--vscode-editor-foreground, #ffffff);
      margin: 0 0 2px 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .brand-tagline {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888888);
      margin: 0;
    }
    .status-badge {
      display: inline-block;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      margin-top: 8px;
      font-weight: 600;
    }
    .status-connected {
      background: rgba(39, 201, 63, 0.15);
      color: #27c93f;
      border: 1px solid rgba(39, 201, 63, 0.3);
    }
    .status-disconnected {
      background: rgba(255, 255, 255, 0.08);
      color: var(--vscode-descriptionForeground, #aaaaaa);
      border: 1px solid var(--border);
    }
    .section {
      margin-bottom: 14px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888888);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tabs {
      display: flex;
      background: var(--input-bg);
      border-radius: 6px;
      padding: 2px;
      margin-bottom: 10px;
      border: 1px solid var(--border);
    }
    .tab-btn {
      flex: 1;
      padding: 6px 4px;
      font-size: 11px;
      font-weight: 600;
      background: transparent;
      border: none;
      color: var(--fg);
      cursor: pointer;
      border-radius: 4px;
      text-align: center;
      transition: background 0.15s ease;
    }
    .tab-btn.active {
      background: var(--vscode-button-background, #0e639c);
      color: #ffffff;
    }
    .selection-list {
      max-height: 180px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--card-bg);
      padding: 4px;
      margin-bottom: 10px;
    }
    .list-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      margin-bottom: 3px;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .list-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    .list-item input[type="checkbox"] {
      margin-top: 2px;
      cursor: pointer;
    }
    .list-content {
      flex: 1;
      min-width: 0;
    }
    .item-title {
      font-weight: 600;
      color: var(--vscode-editor-foreground, #ffffff);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-hash {
      color: #79c0ff;
      font-family: monospace;
      font-size: 10px;
      margin-right: 4px;
    }
    .item-meta {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #888888);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-tag {
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.1);
      margin-left: 4px;
    }
    .search-input {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      font-size: 11px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      margin-bottom: 6px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
    .form-group {
      margin-bottom: 10px;
    }
    .form-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--vscode-editor-foreground, #e0e0e0);
    }
    .context-textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 8px;
      font-size: 11px;
      font-family: inherit;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      resize: vertical;
      min-height: 55px;
      outline: none;
    }
    .context-textarea:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
    .btn {
      display: block;
      width: 100%;
      padding: 8px 10px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      border: none;
      box-sizing: border-box;
      margin-bottom: 6px;
      transition: background 0.15s ease;
      font-family: inherit;
    }
    .btn-primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .btn-linkedin {
      background: var(--accent);
      color: #ffffff;
    }
    .btn-linkedin:hover {
      background: var(--accent-hover);
    }
    .btn-danger {
      background: transparent;
      color: #f85149;
      border: 1px solid rgba(248, 81, 73, 0.3);
    }
    .btn-danger:hover {
      background: rgba(248, 81, 73, 0.1);
    }
    .btn-text {
      background: transparent;
      color: var(--vscode-textLink-foreground, #3794ff);
      font-size: 11px;
      padding: 4px;
      border: none;
      cursor: pointer;
    }
    .btn-text:hover {
      text-decoration: underline;
    }
    .empty-notice {
      padding: 14px 8px;
      text-align: center;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888888);
    }
    .error-hint {
      color: #f85149;
      font-size: 11px;
      margin-bottom: 6px;
      display: none;
    }
    .footer {
      text-align: center;
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #666666);
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="header">
    <h2 class="brand-title">🚀 2share</h2>
    <p class="brand-tagline">Git & Archivos ➔ LinkedIn en 30s</p>
    <div class="status-badge ${statusClass}">
      ${statusText} ${authorDisplay ? `(${this.escapeHtml(authorDisplay)})` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">
      <span>1. Seleccionar Origen</span>
      <button id="btn-refresh" class="btn-text" title="Refrescar commits y archivos">🔄 Recargar</button>
    </div>

    <!-- Pestañas de modo -->
    <div class="tabs">
      <button id="tab-commits" class="tab-btn active">🔀 Commits (${commits.length})</button>
      <button id="tab-files" class="tab-btn">📁 Archivos (${files.length})</button>
    </div>

    <!-- Panel de Commits -->
    <div id="panel-commits">
      <input type="text" id="search-commits" class="search-input" placeholder="Filtrar commits..." />
      <div id="commits-list" class="selection-list">
        ${
          commits.length === 0
            ? '<div class="empty-notice">No se detectaron commits en el repositorio actual.</div>'
            : commits
                .map(
                  (c, idx) => `
          <label class="list-item" data-search="${this.escapeHtml((c.shortHash + ' ' + c.message + ' ' + c.author).toLowerCase())}">
            <input type="checkbox" name="commit-item" value="${this.escapeHtml(c.hash)}" ${idx === 0 ? 'checked' : ''} />
            <div class="list-content">
              <div class="item-title">
                <span class="item-hash">${this.escapeHtml(c.shortHash)}</span>
                ${this.escapeHtml(c.message)}
              </div>
              <div class="item-meta">${this.escapeHtml(c.author)} • ${this.escapeHtml(c.date)}</div>
            </div>
          </label>
        `
                )
                .join('')
        }
      </div>
    </div>

    <!-- Panel de Archivos -->
    <div id="panel-files" style="display: none;">
      <input type="text" id="search-files" class="search-input" placeholder="Filtrar o buscar archivos..." />
      <div id="files-list" class="selection-list">
        ${
          files.length === 0
            ? '<div class="empty-notice">No se detectaron archivos de proyecto disponibles.</div>'
            : files
                .map(
                  (f) => `
          <label class="list-item" data-search="${this.escapeHtml(f.relativePath.toLowerCase())}">
            <input type="checkbox" name="file-item" value="${this.escapeHtml(f.relativePath)}" />
            <div class="list-content">
              <div class="item-title">
                📄 ${this.escapeHtml(f.relativePath)}
                <span class="item-tag">${this.escapeHtml(f.status)}</span>
              </div>
            </div>
          </label>
        `
                )
                .join('')
        }
      </div>
    </div>

    <!-- Campo de Contexto / Reto Técnico -->
    <div class="form-group">
      <label class="form-label" for="user-context">
        ✍️ Contexto o reto a destacar (opcional):
      </label>
      <textarea
        id="user-context"
        class="context-textarea"
        placeholder="Ej: Redujimos la latencia 60% usando un cache local, superando memory leaks..."
      ></textarea>
    </div>

    <div id="validation-error" class="error-hint"></div>

    <button id="btn-generate" class="btn btn-primary">
      🚀 Generar Post con IA
    </button>
  </div>

  <div class="section">
    <div class="section-title">
      <span>2. Conexión LinkedIn</span>
    </div>
    ${
      isConnected
        ? `
      <button id="btn-login" class="btn btn-secondary">
        ⚙️ Actualizar Credenciales de LinkedIn
      </button>
      <button id="btn-disconnect" class="btn btn-danger">
        Cerrar sesión de LinkedIn
      </button>
      `
        : `
      <button id="btn-login" class="btn btn-linkedin">
        🔗 Iniciar sesión con LinkedIn
      </button>
      `
    }
  </div>

  <div class="footer">
    2share v0.1.0 • Maker-Checker Protocol
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentMode = 'commits';

    // Tabs logic
    const tabCommits = document.getElementById('tab-commits');
    const tabFiles = document.getElementById('tab-files');
    const panelCommits = document.getElementById('panel-commits');
    const panelFiles = document.getElementById('panel-files');
    const validationError = document.getElementById('validation-error');

    tabCommits.addEventListener('click', () => {
      currentMode = 'commits';
      tabCommits.classList.add('active');
      tabFiles.classList.remove('active');
      panelCommits.style.display = 'block';
      panelFiles.style.display = 'none';
      validationError.style.display = 'none';
    });

    tabFiles.addEventListener('click', () => {
      currentMode = 'files';
      tabFiles.classList.add('active');
      tabCommits.classList.remove('active');
      panelFiles.style.display = 'block';
      panelCommits.style.display = 'none';
      validationError.style.display = 'none';
    });

    // Filtros de búsqueda en listas
    const searchCommits = document.getElementById('search-commits');
    searchCommits.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      document.querySelectorAll('#commits-list .list-item').forEach(item => {
        const text = item.getAttribute('data-search') || '';
        item.style.display = text.includes(term) ? 'flex' : 'none';
      });
    });

    const searchFiles = document.getElementById('search-files');
    searchFiles.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      document.querySelectorAll('#files-list .list-item').forEach(item => {
        const text = item.getAttribute('data-search') || '';
        item.style.display = text.includes(term) ? 'flex' : 'none';
      });
    });

    // Botón Recargar
    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    // Generar Post con IA
    document.getElementById('btn-generate')?.addEventListener('click', () => {
      const contextText = document.getElementById('user-context').value;
      validationError.style.display = 'none';

      if (currentMode === 'commits') {
        const checked = Array.from(document.querySelectorAll('input[name="commit-item"]:checked'))
          .map(cb => cb.value);

        if (checked.length === 0) {
          validationError.innerText = 'Selecciona al menos un commit para continuar.';
          validationError.style.display = 'block';
          return;
        }

        vscode.postMessage({
          command: 'generatePostFromSidebar',
          mode: 'commits',
          selectedHashes: checked,
          userContext: contextText.trim(),
        });
      } else {
        const checked = Array.from(document.querySelectorAll('input[name="file-item"]:checked'))
          .map(cb => cb.value);

        if (checked.length === 0) {
          validationError.innerText = 'Selecciona al menos un archivo para continuar.';
          validationError.style.display = 'block';
          return;
        }

        vscode.postMessage({
          command: 'generatePostFromSidebar',
          mode: 'files',
          selectedFiles: checked,
          userContext: contextText.trim(),
        });
      }
    });

    // LinkedIn login & disconnect
    document.getElementById('btn-login')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'loginLinkedIn' });
    });

    document.getElementById('btn-disconnect')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'disconnectLinkedIn' });
    });
  </script>
</body>
</html>`;
  }
}
