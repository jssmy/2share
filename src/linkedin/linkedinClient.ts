import * as vscode from 'vscode';
import { LinkedInPublishResult } from '../types';
import { OAuthServer } from './oauthServer';

export class LinkedInClient {
  private static readonly TOKEN_SECRET_KEY = '2share.linkedin.token';
  private static readonly PERSON_URN_SECRET_KEY = '2share.linkedin.personUrn';
  private static readonly PERSON_NAME_SECRET_KEY = '2share.linkedin.personName';
  private static readonly CLIENT_ID_SECRET_KEY = '2share.linkedin.clientId';
  private static readonly CLIENT_SECRET_KEY = '2share.linkedin.clientSecret';
  private static readonly DEFAULT_CLIENT_ID = '78kwfia1cbcf7q';
  private static readonly DEFAULT_CLIENT_SECRET = Buffer.from(
    'V1BMX0FQMS5xQlkzSnIyRjZBRmEyMGY4LlhMc0dpQT09',
    'base64'
  ).toString('utf8');
  private static readonly LINKEDIN_API_VERSION = '202401';
  private static readonly OAUTH_PORT = 54321;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Obtiene el token de acceso guardado en el SecretStorage de VS Code
   */
  public async getAccessToken(): Promise<string | undefined> {
    return await this.context.secrets.get(LinkedInClient.TOKEN_SECRET_KEY);
  }

  public async saveAccessToken(token: string): Promise<void> {
    await this.context.secrets.store(LinkedInClient.TOKEN_SECRET_KEY, token.trim());
  }

  public async getAuthorUrn(): Promise<string | undefined> {
    const savedUrn = await this.context.secrets.get(LinkedInClient.PERSON_URN_SECRET_KEY);
    if (savedUrn) {
      return savedUrn;
    }
    const config = vscode.workspace.getConfiguration('2share');
    const configUrn = config.get<string>('authorPersonUrn');
    if (configUrn && configUrn.trim()) {
      return configUrn.trim();
    }
    return undefined;
  }

  public async saveAuthorUrn(urn: string): Promise<void> {
    await this.context.secrets.store(LinkedInClient.PERSON_URN_SECRET_KEY, urn.trim());
  }

  public async getAuthorName(): Promise<string | undefined> {
    return await this.context.secrets.get(LinkedInClient.PERSON_NAME_SECRET_KEY);
  }

  public async saveAuthorName(name: string): Promise<void> {
    await this.context.secrets.store(LinkedInClient.PERSON_NAME_SECRET_KEY, name.trim());
  }

  public async getClientId(): Promise<string> {
    const fromSecrets = await this.context.secrets.get(LinkedInClient.CLIENT_ID_SECRET_KEY);
    if (fromSecrets && fromSecrets.trim()) {
      return fromSecrets.trim();
    }
    const config = vscode.workspace.getConfiguration('2share');
    const fromConfig = config.get<string>('clientId');
    if (fromConfig && fromConfig.trim()) {
      return fromConfig.trim();
    }
    return LinkedInClient.DEFAULT_CLIENT_ID;
  }

  public async saveClientId(clientId: string): Promise<void> {
    await this.context.secrets.store(LinkedInClient.CLIENT_ID_SECRET_KEY, clientId.trim());
  }

  public async getClientSecret(): Promise<string> {
    const fromSecrets = await this.context.secrets.get(LinkedInClient.CLIENT_SECRET_KEY);
    if (fromSecrets && fromSecrets.trim()) {
      return fromSecrets.trim();
    }
    const config = vscode.workspace.getConfiguration('2share');
    const fromConfig = config.get<string>('clientSecret');
    if (fromConfig && fromConfig.trim()) {
      return fromConfig.trim();
    }
    return LinkedInClient.DEFAULT_CLIENT_SECRET;
  }

  public async saveClientSecret(secret: string): Promise<void> {
    await this.context.secrets.store(LinkedInClient.CLIENT_SECRET_KEY, secret.trim());
  }

  public async clearCredentials(): Promise<void> {
    await this.context.secrets.delete(LinkedInClient.TOKEN_SECRET_KEY);
    await this.context.secrets.delete(LinkedInClient.PERSON_URN_SECRET_KEY);
    await this.context.secrets.delete(LinkedInClient.PERSON_NAME_SECRET_KEY);
  }

  /**
   * Flujo OAuth2 completo:
   * 1. Abre el navegador web en LinkedIn para que el usuario autorice.
   * 2. El navegador redirige al servidor local (http://127.0.0.1:54321/callback).
   * 3. Se intercambia el código por el Access Token y se guarda en SecretStorage.
   * 4. Retorna a VS Code con la sesión iniciada.
   */
  public async loginWithBrowser(): Promise<boolean> {
    // 1. Obtener o solicitar Client ID y Client Secret
    let clientId = await this.getClientId();
    let clientSecret = await this.getClientSecret();

    if (!clientId || !clientSecret) {
      const setupChoice = await vscode.window.showInformationMessage(
        '2share: Para autenticarte mediante el navegador se requiere el Client ID y Client Secret de tu App de LinkedIn (Redirect URI: http://127.0.0.1:54321/callback).',
        'Configurar Credenciales',
        'Crear App en LinkedIn'
      );

      if (setupChoice === 'Crear App en LinkedIn') {
        await vscode.env.openExternal(
          vscode.Uri.parse('https://www.linkedin.com/developers/apps/new')
        );
      }

      if (setupChoice !== 'Configurar Credenciales' && setupChoice !== 'Crear App en LinkedIn') {
        return false;
      }

      if (!clientId) {
        const inputId = await vscode.window.showInputBox({
          title: 'LinkedIn OAuth - Client ID',
          prompt: 'Ingresa el Client ID de tu App de LinkedIn',
          placeHolder: 'Ej: 77xxxxxxxxxxxx',
          ignoreFocusOut: true,
        });
        if (!inputId || !inputId.trim()) {
          return false;
        }
        clientId = inputId.trim();
        await this.saveClientId(clientId);
      }

      if (!clientSecret) {
        const inputSecret = await vscode.window.showInputBox({
          title: 'LinkedIn OAuth - Client Secret',
          prompt: 'Ingresa el Client Secret de tu App de LinkedIn',
          password: true,
          ignoreFocusOut: true,
        });
        if (!inputSecret || !inputSecret.trim()) {
          return false;
        }
        clientSecret = inputSecret.trim();
        await this.saveClientSecret(clientSecret);
      }
    }

    // 2. Levantar servidor local en el puerto designado
    const oauthServer = new OAuthServer(LinkedInClient.OAUTH_PORT);
    const redirectUri = oauthServer.getRedirectUri();
    const state = oauthServer.generateState();
    const scopes = encodeURIComponent('openid profile w_member_social');

    const authorizationUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}&scope=${scopes}`;

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '2share: Esperando autorización en el navegador...',
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          oauthServer.stop();
        });

        // 3. Abrir el navegador hacia LinkedIn
        progress.report({ message: 'Abriendo navegador para iniciar sesión con LinkedIn...' });
        await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl));

        try {
          // 4. Esperar el código desde el navegador
          const authResult = await oauthServer.waitForAuthorizationCode(state);

          progress.report({ message: 'Intercambiando código de autorización por token...' });

          // 5. Intercambiar code por Access Token (POST a LinkedIn OAuth)
          const tokenBody = new URLSearchParams({
            grant_type: 'authorization_code',
            code: authResult.code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
          });

          const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenBody.toString(),
          });

          if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            throw new Error(`Fallo al obtener token (${tokenResponse.status}): ${errText}`);
          }

          const tokenData: any = await tokenResponse.json();
          const accessToken = tokenData.access_token;

          if (!accessToken) {
            throw new Error('La respuesta de LinkedIn no contenía un token de acceso.');
          }

          // 6. Obtener información del usuario (sub y nombre)
          let authorUrn: string | undefined;
          let authorName: string | undefined;

          try {
            const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (userRes.ok) {
              const userData: any = await userRes.json();
              if (userData.sub) {
                authorUrn = `urn:li:person:${userData.sub}`;
              }
              if (userData.name) {
                authorName = userData.name;
              }
            }
          } catch {
            // Ignorar y solicitar URN si no viene
          }

          if (!authorUrn) {
            authorUrn = await vscode.window.showInputBox({
              title: '2share: LinkedIn Person URN',
              prompt: 'Ingresa tu identificador URN de LinkedIn (ej: urn:li:person:XXXXXX)',
              placeHolder: 'urn:li:person:XXXXXX',
              ignoreFocusOut: true,
            });
          }

          // 7. Guardar en SecretStorage de VS Code
          await this.saveAccessToken(accessToken);
          if (authorUrn) {
            await this.saveAuthorUrn(authorUrn);
          }
          if (authorName) {
            await this.saveAuthorName(authorName);
          }

          vscode.window.showInformationMessage(
            `🎉 ¡Conectado exitosamente con LinkedIn${authorName ? ` (${authorName})` : ''}!`
          );
          return true;
        } catch (error: any) {
          vscode.window.showErrorMessage(`2share: Error de autenticación: ${error.message}`);
          return false;
        } finally {
          oauthServer.stop();
        }
      }
    );
  }

  /**
   * Método de autenticación interactivo (utiliza el flujo de navegador)
   */
  public async promptAuthentication(): Promise<boolean> {
    return await this.loginWithBrowser();
  }

  /**
   * Inicializa la carga de imagen en LinkedIn Assets API y sube el archivo
   */
  public async uploadImage(imageBuffer: Buffer, mimeType = 'image/png'): Promise<string> {
    const token = await this.getAccessToken();
    const authorUrn = await this.getAuthorUrn();

    if (!token || !authorUrn) {
      throw new Error('No se han configurado las credenciales de LinkedIn.');
    }

    const initResponse = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'LinkedIn-Version': LinkedInClient.LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: authorUrn,
        },
      }),
    });

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      if (initResponse.status === 401 || initResponse.status === 403) {
        await this.handleAuthError();
      }
      throw new Error(`Error al inicializar carga de imagen (${initResponse.status}): ${errText}`);
    }

    const initData: any = await initResponse.json();
    const uploadUrl = initData?.value?.uploadUrl;
    const imageUrn = initData?.value?.image;

    if (!uploadUrl || !imageUrn) {
      throw new Error('La respuesta de LinkedIn no contenía una URL de subida válida.');
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      const uploadErr = await uploadResponse.text();
      throw new Error(`Error al transferir imagen a LinkedIn (${uploadResponse.status}): ${uploadErr}`);
    }

    return imageUrn;
  }

  /**
   * Crea y publica el post en LinkedIn
   */
  public async createPost(commentary: string, imageUrn?: string): Promise<LinkedInPublishResult> {
    let token = await this.getAccessToken();
    let authorUrn = await this.getAuthorUrn();

    if (!token || !authorUrn) {
      const configured = await this.promptAuthentication();
      if (!configured) {
        return { success: false, error: 'Autenticación cancelada por el usuario.' };
      }
      token = await this.getAccessToken();
      authorUrn = await this.getAuthorUrn();
    }

    if (!token || !authorUrn) {
      return { success: false, error: 'Faltan credenciales de LinkedIn.' };
    }

    const payload: any = {
      author: authorUrn,
      commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
    };

    if (imageUrn) {
      payload.content = {
        media: {
          title: 'Code Snapshot - 2share',
          id: imageUrn,
        },
      };
    }

    const res = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'LinkedIn-Version': LinkedInClient.LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401 || res.status === 403) {
        await this.handleAuthError();
      }
      return {
        success: false,
        error: `Error al publicar en LinkedIn (${res.status}): ${errText}`,
      };
    }

    const postUrn = res.headers.get('x-restli-id') || '';
    const postUrl = postUrn
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`
      : 'https://www.linkedin.com/feed/';

    return {
      success: true,
      postUrn,
      postUrl,
    };
  }

  private async handleAuthError() {
    const choice = await vscode.window.showErrorMessage(
      '2share: Tu sesión de LinkedIn ha expirado o las credenciales no tienen permisos válidos.',
      'Reautenticar'
    );
    if (choice === 'Reautenticar') {
      await this.promptAuthentication();
    }
  }
}
