import * as vscode from 'vscode';
import { LinkedInClient } from '../linkedin/linkedinClient';

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = '2share.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly linkedInClient: LinkedInClient
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
        case 'createPost': {
          await vscode.commands.executeCommand('2share.createPost');
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
    const isConnected = !!token;

    this._view.webview.html = this.getHtml(isConnected, authorUrn);
  }

  private async sendStatus(): Promise<void> {
    if (!this._view) {
      return;
    }
    const token = await this.linkedInClient.getAccessToken();
    const authorUrn = await this.linkedInClient.getAuthorUrn();
    this._view.webview.postMessage({
      command: 'statusUpdate',
      isConnected: !!token,
      authorUrn: authorUrn || '',
    });
  }

  private getHtml(isConnected: boolean, authorUrn?: string): string {
    const statusText = isConnected
      ? '🟢 Conectado con LinkedIn'
      : '⚪ Sin vincular';
    const statusClass = isConnected ? 'status-connected' : 'status-disconnected';
    const authorDisplay = authorUrn ? authorUrn.replace('urn:li:person:', '') : '';

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
    }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.5;
      padding: 16px 12px;
      margin: 0;
      box-sizing: border-box;
    }
    .header {
      text-align: center;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--vscode-editor-foreground, #ffffff);
      margin: 0 0 4px 0;
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
      padding: 4px 10px;
      border-radius: 12px;
      margin-top: 10px;
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
      margin-bottom: 18px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888888);
      margin-bottom: 8px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .card p {
      margin: 0 0 10px 0;
      font-size: 12px;
    }
    .feature-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .feature-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .feature-icon {
      font-size: 14px;
      line-height: 1.2;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 9px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      border: none;
      box-sizing: border-box;
      margin-bottom: 8px;
      transition: background 0.15s ease;
      font-family: inherit;
    }
    .btn-linkedin {
      background: var(--accent);
      color: #ffffff;
    }
    .btn-linkedin:hover {
      background: var(--accent-hover);
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
    .btn-danger {
      background: transparent;
      color: #d32f2f;
      border: 1px solid rgba(211, 47, 47, 0.4);
      margin-top: 4px;
    }
    .btn-danger:hover {
      background: rgba(211, 47, 47, 0.1);
    }
    .footer {
      text-align: center;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #777);
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="header">
    <h2 class="brand-title">🚀 2share</h2>
    <p class="brand-tagline">Git Commits ➔ LinkedIn Posts en 30s</p>
    <div class="status-badge ${statusClass}">
      ${statusText} ${authorDisplay ? `(${authorDisplay})` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">¿Para qué sirve 2share?</div>
    <div class="card">
      <ul class="feature-list">
        <li class="feature-item">
          <span class="feature-icon">✨</span>
          <span><strong>De Commit a Post:</strong> Selecciona un cambio de Git y genera una publicación atractiva y profesional.</span>
        </li>
        <li class="feature-item">
          <span class="feature-icon">🤖</span>
          <span><strong>IA Integrada:</strong> Redacta con Copilot o GPT-4o usando la API nativa de VS Code (cero costo extra).</span>
        </li>
        <li class="feature-item">
          <span class="feature-icon">🎨</span>
          <span><strong>Snapshots Estéticos:</strong> Capturas con marco macOS y resaltado de código estilo Ray.so / Carbon.</span>
        </li>
        <li class="feature-item">
          <span class="feature-icon">📱</span>
          <span><strong>Simulador LinkedIn:</strong> Edita texto en vivo, cambia de tema visual y publica en 1 clic.</span>
        </li>
      </ul>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Acciones Principales</div>
    <button id="btn-create" class="btn btn-primary">
      🚀 Compartir un Commit ahora
    </button>

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
    2share v0.1.0 • Maker-Checker Architecture
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-create')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'createPost' });
    });

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

