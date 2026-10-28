import * as vscode from 'vscode';
import { SettingsService } from '../services/SettingsService';
import { LinkedInAuthService } from '../services/LinkedInAuthService';
import { LinkedInClient } from '../services/LinkedInClient';
import { PublicationOptions, UserProfile } from '../models';

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    private settingsService: SettingsService,
    private authService: LinkedInAuthService,
    private linkedInClient: LinkedInClient
  ) {
    this.panel = panel;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    this.updateContent();
  }

  public static async createOrShow(
    extensionUri: vscode.Uri,
    settingsService: SettingsService,
    authService: LinkedInAuthService,
    linkedInClient: LinkedInClient
  ): Promise<SettingsPanel> {
    const column = vscode.ViewColumn.Beside;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      await SettingsPanel.currentPanel.updateContent();
      return SettingsPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'shareToLinkedInSettings',
      'Share to LinkedIn: Configuración',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    SettingsPanel.currentPanel = new SettingsPanel(
      panel,
      extensionUri,
      settingsService,
      authService,
      linkedInClient
    );

    return SettingsPanel.currentPanel;
  }

  private async handleMessage(message: any) {
    switch (message.command) {
      case 'saveOptions':
        await this.settingsService.updateOptions({
          includeFile: !!message.includeFile,
          showLineNumbers: !!message.showLineNumbers,
          useCodeFormat: !!message.useCodeFormat,
          messageTemplate: message.messageTemplate,
        });
        if (message.clientId !== undefined) {
          await this.authService.saveClientId(message.clientId);
        }
        if (message.clientSecret !== undefined) {
          await this.authService.saveClientSecret(message.clientSecret);
        }
        vscode.window.showInformationMessage('Share to LinkedIn: Configuración y credenciales guardadas.');
        await this.updateContent();
        break;

      case 'copyUri':
        await vscode.env.clipboard.writeText('http://127.0.0.1:54321/callback');
        vscode.window.showInformationMessage('📋 Redirect URI copiado: http://127.0.0.1:54321/callback');
        break;

      case 'login':
        const ok = await this.authService.promptAuthentication();
        if (ok) {
          await this.updateContent();
        }
        break;

      case 'disconnect':
        await this.authService.clearCredentials();
        vscode.window.showInformationMessage('Share to LinkedIn: Sesión cerrada.');
        await this.updateContent();
        break;
    }
  }

  public async updateContent() {
    const options = this.settingsService.getOptions();
    const profile = await this.linkedInClient.getUserProfile();
    const clientId = await this.authService.getClientId();
    const clientSecret = await this.authService.getClientSecret();
    this.panel.webview.html = this.getHtml(options, profile, clientId, clientSecret);
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
    options: PublicationOptions,
    profile: UserProfile,
    clientId = '',
    clientSecret = ''
  ): string {
    const isConnected = profile.isConnected;
    const name = profile.name || 'Joset Manihuari';
    const statusText = isConnected ? 'Conectado a LinkedIn' : 'Sin conectar';
    const statusColor = isConnected ? '#27c93f' : '#888888';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuración - Share to LinkedIn</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #14171d);
      --fg: var(--vscode-editor-foreground, #e1e4ea);
      --card-bg: #1c2029;
      --border: var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      --subtext: var(--vscode-descriptionForeground, #8c93a0);
      --linkedin-blue: #0a66c2;
      --linkedin-hover: #004182;
    }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      line-height: 1.5;
      padding: 20px;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container {
      max-width: 520px;
      width: 100%;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
    }
    .brand-icon {
      width: 20px;
      height: 20px;
      background: var(--linkedin-blue);
      color: white;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 12px;
    }
    .title {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
      color: #ffffff;
    }

    /* Perfil Card (Imagen Mockup: Joset Manihuari + Conectado + [Desconectar]) */
    .profile-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 22px;
    }
    .profile-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0a66c2, #004182);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
    }
    .profile-name {
      font-size: 14px;
      font-weight: 600;
      color: #ffffff;
      margin: 0;
    }
    .profile-status {
      font-size: 11px;
      color: ${statusColor};
      margin: 2px 0 0 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .btn-auth {
      background: rgba(255, 255, 255, 0.08);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s ease;
    }
    .btn-auth:hover {
      background: rgba(255, 255, 255, 0.14);
    }

    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--subtext);
      margin-bottom: 12px;
    }

    /* Switches de Opciones */
    .options-group {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 6px 16px;
      margin-bottom: 22px;
    }
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .switch-row:last-child {
      border-bottom: none;
    }
    .switch-label {
      font-size: 13px;
      color: #ffffff;
      cursor: pointer;
    }

    /* Toggle Switch estilo iOS/VS Code */
    .switch {
      position: relative;
      display: inline-block;
      width: 38px;
      height: 22px;
      flex-shrink: 0;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #383c47;
      transition: .2s;
      border-radius: 22px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .2s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: var(--linkedin-blue);
    }
    input:checked + .slider:before {
      transform: translateX(16px);
    }

    /* Plantilla Textarea */
    .template-box {
      margin-bottom: 20px;
    }
    .template-textarea {
      width: 100%;
      box-sizing: border-box;
      background: var(--card-bg);
      color: #ffffff;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      font-family: inherit;
      line-height: 1.5;
      resize: vertical;
      min-height: 85px;
      outline: none;
    }
    .template-textarea:focus {
      border-color: var(--linkedin-blue);
    }
    .counter-row {
      display: flex;
      justify-content: flex-end;
      font-size: 11px;
      color: var(--subtext);
      margin-top: 4px;
      margin-bottom: 12px;
    }
    .btn-save {
      float: right;
      background: var(--linkedin-blue);
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-save:hover {
      background: var(--linkedin-hover);
    }

    /* Atajos de teclado */
    .shortcuts-card {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      margin-top: 36px;
      font-size: 12px;
    }
    .shortcut-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .shortcut-row:last-child {
      margin-bottom: 0;
    }
    .kbd {
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-row">
      <div class="brand-icon">in</div>
      <h2 class="title">Configuración</h2>
    </div>

    <!-- Tarjeta de Cuenta de LinkedIn -->
    <div class="profile-card">
      <div class="profile-left">
        <div class="avatar">${name.charAt(0).toUpperCase()}</div>
        <div>
          <div class="profile-name">${this.escapeHtml(name)}</div>
          <div class="profile-status">● ${statusText}</div>
        </div>
      </div>
      ${
        isConnected
          ? `<button id="btn-auth" class="btn-auth">Desconectar</button>`
          : `<button id="btn-auth" class="btn-auth" style="background: var(--linkedin-blue); color: #fff;">Conectar</button>`
      }
    </div>

    <!-- Opciones de Publicación -->
    <div class="section-title">Opciones de publicación</div>
    <div class="options-group">
      <div class="switch-row">
        <span class="switch-label">Incluir archivo en el post</span>
        <label class="switch">
          <input type="checkbox" id="chk-include-file" ${options.includeFile ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="switch-row">
        <span class="switch-label">Mostrar número de líneas</span>
        <label class="switch">
          <input type="checkbox" id="chk-show-lines" ${options.showLineNumbers ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="switch-row">
        <span class="switch-label">Usar formato de código</span>
        <label class="switch">
          <input type="checkbox" id="chk-use-code" ${options.useCodeFormat ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <!-- Credenciales de la Aplicación LinkedIn (OAuth 2.0) -->
    <div class="section-title">Credenciales de LinkedIn Developer (OAuth 2.0)</div>
    <div class="options-group" style="padding: 12px 16px;">
      <div style="margin-bottom: 12px;">
        <label class="switch-label" style="display: block; margin-bottom: 4px; font-size: 12px;">Client ID:</label>
        <input type="text" id="input-client-id" class="template-textarea" style="min-height: auto; padding: 6px 10px;" placeholder="Ej: 78kwfia1cbcf7q" value="${this.escapeHtml(clientId)}">
      </div>
      <div style="margin-bottom: 12px;">
        <label class="switch-label" style="display: block; margin-bottom: 4px; font-size: 12px;">Client Secret:</label>
        <input type="password" id="input-client-secret" class="template-textarea" style="min-height: auto; padding: 6px 10px;" placeholder="••••••••••••••••" value="${this.escapeHtml(clientSecret)}">
      </div>
      <div style="font-size: 11px; color: var(--subtext); display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 8px;">
        <span>Redirect URI: <code style="color: #4da3ff;">http://127.0.0.1:54321/callback</code></span>
        <button id="btn-copy-uri" class="btn-auth" style="padding: 3px 8px; font-size: 11px;">Copiar URI</button>
      </div>
    </div>

    <!-- Plantilla de Mensaje -->
    <div class="section-title">Plantilla de mensaje</div>
    <div class="template-box">
      <textarea id="template-text" class="template-textarea" maxlength="300">${this.escapeHtml(
        options.messageTemplate
      )}</textarea>
      <div class="counter-row">
        <span id="char-count">0/300</span>
      </div>
      <button id="btn-save" class="btn-save">Guardar</button>
    </div>

    <!-- Atajos Rápidos -->
    <div class="shortcuts-card">
      <div style="font-weight: 600; margin-bottom: 8px;">Atajos de teclado configurados:</div>
      <div class="shortcut-row">
        <span>Compartir selección:</span>
        <span class="kbd">Ctrl + Alt + L</span>
      </div>
      <div class="shortcut-row">
        <span>Compartir último commit:</span>
        <span class="kbd">Ctrl + Alt + C</span>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const btnAuth = document.getElementById('btn-auth');
    const chkIncludeFile = document.getElementById('chk-include-file');
    const chkShowLines = document.getElementById('chk-show-lines');
    const chkUseCode = document.getElementById('chk-use-code');
    const templateText = document.getElementById('template-text');
    const charCount = document.getElementById('char-count');
    const btnSave = document.getElementById('btn-save');
    const inputClientId = document.getElementById('input-client-id');
    const inputClientSecret = document.getElementById('input-client-secret');
    const btnCopyUri = document.getElementById('btn-copy-uri');

    btnCopyUri?.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyUri' });
    });

    function updateCount() {
      charCount.innerText = \`\${templateText.value.length}/300\`;
    }
    updateCount();

    templateText.addEventListener('input', updateCount);

    btnAuth.addEventListener('click', () => {
      ${isConnected ? "vscode.postMessage({ command: 'disconnect' });" : "vscode.postMessage({ command: 'login' });"}
    });

    btnSave.addEventListener('click', () => {
      vscode.postMessage({
        command: 'saveOptions',
        includeFile: chkIncludeFile.checked,
        showLineNumbers: chkShowLines.checked,
        useCodeFormat: chkUseCode.checked,
        messageTemplate: templateText.value.trim(),
        clientId: inputClientId ? inputClientId.value.trim() : undefined,
        clientSecret: inputClientSecret ? inputClientSecret.value.trim() : undefined,
      });
    });
  </script>
</body>
</html>`;
  }

  public dispose() {
    SettingsPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}

