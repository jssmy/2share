import * as vscode from 'vscode';
import { LinkedInAuthService } from '../services/LinkedInAuthService';

export class ShareViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'share-to-linkedin.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly authService: LinkedInAuthService
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
        case 'shareSelection':
          await vscode.commands.executeCommand('share-to-linkedin.shareSelection');
          break;
        case 'shareLastCommit':
          await vscode.commands.executeCommand('share-to-linkedin.shareLastCommit');
          break;
        case 'openSettings':
          await vscode.commands.executeCommand('share-to-linkedin.openSettings');
          break;
        case 'openHelp':
          await vscode.commands.executeCommand('share-to-linkedin.help');
          break;
        case 'login':
          const success = await this.authService.promptAuthentication();
          if (success) {
            await this.refresh();
          }
          break;
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
    const token = await this.authService.getAccessToken();
    const isConnected = !!token;
    const authorName = (await this.authService.getAuthorName()) || 'Joset Manihuari';

    this._view.webview.html = this.getHtml(isConnected, authorName);
  }

  private getHtml(isConnected: boolean, authorName: string): string {
    const statusText = isConnected ? `Conectado a LinkedIn` : 'Sin conectar';
    const statusDot = isConnected ? '🟢' : '⚪';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Share to LinkedIn</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #181a1f);
      --fg: var(--vscode-sideBar-foreground, #cccccc);
      --border: var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
      --linkedin-blue: #0a66c2;
      --linkedin-hover: #004182;
      --card-bg: var(--vscode-editor-background, #1e1e1e);
    }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.4;
      padding: 16px 14px;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-height: 94vh;
      justify-content: space-between;
    }
    .header {
      margin-bottom: 20px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .brand-icon {
      width: 22px;
      height: 22px;
      background-color: var(--linkedin-blue);
      color: white;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 13px;
      font-family: sans-serif;
    }
    .brand-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--vscode-editor-foreground, #ffffff);
      margin: 0;
    }
    .brand-desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #999999);
      margin: 0;
      line-height: 1.45;
    }
    .btn-share {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      background: var(--linkedin-blue);
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-sizing: border-box;
      margin-top: 18px;
      margin-bottom: 20px;
      transition: background 0.15s ease;
      font-family: inherit;
    }
    .btn-share:hover {
      background: var(--linkedin-hover);
    }
    .action-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .action-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 5px;
      cursor: pointer;
      color: var(--fg);
      font-size: 12px;
      user-select: none;
      transition: background 0.15s ease;
    }
    .action-item:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #ffffff;
    }
    .action-icon {
      font-size: 14px;
      opacity: 0.85;
      width: 16px;
      text-align: center;
    }
    .footer {
      border-top: 1px solid var(--border);
      padding-top: 14px;
      margin-top: auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
    }
    .status-left {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-descriptionForeground, #aaaaaa);
    }
    .status-badge-in {
      background: rgba(10, 102, 194, 0.15);
      color: var(--linkedin-blue);
      font-weight: bold;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <div>
    <div class="header">
      <div class="brand-row">
        <div class="brand-icon">in</div>
        <h3 class="brand-title">Share to LinkedIn</h3>
      </div>
      <p class="brand-desc">
        Comparte tus commits o líneas de código en LinkedIn de forma rápida y profesional.
      </p>
    </div>

    <button id="btn-share-selection" class="btn-share">
      <span>🔗</span>
      <span>Compartir selección</span>
    </button>

    <div class="action-list">
      <div id="btn-share-commit" class="action-item">
        <span class="action-icon">📦</span>
        <span>Compartir último commit</span>
      </div>
      <div id="btn-open-settings" class="action-item">
        <span class="action-icon">⚙️</span>
        <span>Configuración</span>
      </div>
      <div id="btn-open-help" class="action-item">
        <span class="action-icon">❓</span>
        <span>Ayuda</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <div class="status-left">
      <span>${statusDot}</span>
      <span>${statusText}</span>
    </div>
    <div class="status-badge-in" id="btn-status" title="${isConnected ? authorName : 'Hacer clic para conectar'}">
      in
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-share-selection')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'shareSelection' });
    });

    document.getElementById('btn-share-commit')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'shareLastCommit' });
    });

    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'openSettings' });
    });

    document.getElementById('btn-open-help')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'openHelp' });
    });

    document.getElementById('btn-status')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'login' });
    });
  </script>
</body>
</html>`;
  }
}
