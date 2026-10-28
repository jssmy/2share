import * as vscode from 'vscode';
import { OAuthServer } from '../linkedin/oauthServer';

export class LinkedInAuthService {
  private static readonly TOKEN_SECRET_KEY = 'share-to-linkedin.token';
  private static readonly PERSON_URN_SECRET_KEY = 'share-to-linkedin.personUrn';
  private static readonly PERSON_NAME_SECRET_KEY = 'share-to-linkedin.personName';
  private static readonly CLIENT_ID_SECRET_KEY = 'share-to-linkedin.clientId';
  private static readonly CLIENT_SECRET_KEY = 'share-to-linkedin.clientSecret';

  // Fallbacks de desarrollo
  private static readonly DEFAULT_CLIENT_ID = '78kwfia1cbcf7q';
  private static readonly DEFAULT_CLIENT_SECRET = Buffer.from(
    'V1BMX0FQMS5xQlkzSnIyRjZBRmEyMGY4LlhMc0dpQT09',
    'base64'
  ).toString('utf8');
  private static readonly OAUTH_PORT = 54321;

  constructor(private context: vscode.ExtensionContext) {}

  public async getAccessToken(): Promise<string | undefined> {
    return (
      (await this.context.secrets.get(LinkedInAuthService.TOKEN_SECRET_KEY)) ||
      (await this.context.secrets.get('2share.linkedin.token'))
    );
  }

  public async saveAccessToken(token: string): Promise<void> {
    await this.context.secrets.store(LinkedInAuthService.TOKEN_SECRET_KEY, token.trim());
  }

  public async getAuthorUrn(): Promise<string | undefined> {
    return (
      (await this.context.secrets.get(LinkedInAuthService.PERSON_URN_SECRET_KEY)) ||
      (await this.context.secrets.get('2share.linkedin.personUrn'))
    );
  }

  public async saveAuthorUrn(urn: string): Promise<void> {
    await this.context.secrets.store(LinkedInAuthService.PERSON_URN_SECRET_KEY, urn.trim());
  }

  public async getAuthorName(): Promise<string | undefined> {
    return (
      (await this.context.secrets.get(LinkedInAuthService.PERSON_NAME_SECRET_KEY)) ||
      (await this.context.secrets.get('2share.linkedin.personName'))
    );
  }

  public async saveAuthorName(name: string): Promise<void> {
    await this.context.secrets.store(LinkedInAuthService.PERSON_NAME_SECRET_KEY, name.trim());
  }

  public async getClientId(): Promise<string> {
    const fromSecret = await this.context.secrets.get(LinkedInAuthService.CLIENT_ID_SECRET_KEY);
    if (fromSecret?.trim()) return fromSecret.trim();

    const config = vscode.workspace.getConfiguration('share-to-linkedin');
    const legacyConfig = vscode.workspace.getConfiguration('2share');
    return (
      config.get<string>('clientId') ||
      legacyConfig.get<string>('clientId') ||
      LinkedInAuthService.DEFAULT_CLIENT_ID
    );
  }

  public async saveClientId(clientId: string): Promise<void> {
    await this.context.secrets.store(LinkedInAuthService.CLIENT_ID_SECRET_KEY, clientId.trim());
    try {
      if (vscode.ConfigurationTarget) {
        const config = vscode.workspace.getConfiguration('share-to-linkedin');
        await config.update('clientId', clientId.trim(), vscode.ConfigurationTarget.Global);
      }
    } catch {
      // Ignorar fallo de configuración en entornos sin workspace activo
    }
  }

  public async getClientSecret(): Promise<string> {
    const fromSecret = await this.context.secrets.get(LinkedInAuthService.CLIENT_SECRET_KEY);
    if (fromSecret?.trim()) return fromSecret.trim();

    const config = vscode.workspace.getConfiguration('share-to-linkedin');
    const legacyConfig = vscode.workspace.getConfiguration('2share');
    return (
      config.get<string>('clientSecret') ||
      legacyConfig.get<string>('clientSecret') ||
      LinkedInAuthService.DEFAULT_CLIENT_SECRET
    );
  }

  public async saveClientSecret(clientSecret: string): Promise<void> {
    await this.context.secrets.store(LinkedInAuthService.CLIENT_SECRET_KEY, clientSecret.trim());
    try {
      if (vscode.ConfigurationTarget) {
        const config = vscode.workspace.getConfiguration('share-to-linkedin');
        await config.update('clientSecret', clientSecret.trim(), vscode.ConfigurationTarget.Global);
      }
    } catch {
      // Ignorar fallo de configuración en entornos sin workspace activo
    }
  }

  public async clearCredentials(): Promise<void> {
    await this.context.secrets.delete(LinkedInAuthService.TOKEN_SECRET_KEY);
    await this.context.secrets.delete(LinkedInAuthService.PERSON_URN_SECRET_KEY);
    await this.context.secrets.delete(LinkedInAuthService.PERSON_NAME_SECRET_KEY);
    await this.context.secrets.delete('2share.linkedin.token');
    await this.context.secrets.delete('2share.linkedin.personUrn');
    await this.context.secrets.delete('2share.linkedin.personName');
  }

  /**
   * Ejecuta el flujo interactivo de OAuth 2.0 en navegador
   */
  public async promptAuthentication(): Promise<boolean> {
    const clientId = await this.getClientId();
    const clientSecret = await this.getClientSecret();

    const oauthServer = new OAuthServer(LinkedInAuthService.OAUTH_PORT);
    const redirectUri = oauthServer.getRedirectUri();
    const state = oauthServer.generateState();
    const scopes = encodeURIComponent('openid profile w_member_social');

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scopes}`;

    try {
      await vscode.env.openExternal(vscode.Uri.parse(authUrl));

      const authResult = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Share to LinkedIn: Esperando autorización en el navegador...',
          cancellable: true,
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => {
            oauthServer.stop();
          });
          return await oauthServer.waitForAuthorizationCode(state);
        }
      );

      // Intercambiar código por token
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authResult.code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Fallo en intercambio de token: ${tokenResponse.status} ${errorText}`);
      }

      const tokenData: any = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      await this.saveAccessToken(accessToken);

      // Obtener datos del perfil del usuario (OpenID UserInfo)
      await this.fetchAndStoreProfile(accessToken);

      vscode.window.showInformationMessage('🎉 ¡Autenticado exitosamente con LinkedIn!');
      return true;
    } catch (err: any) {
      oauthServer.stop();
      vscode.window.showErrorMessage(`Share to LinkedIn: Error en OAuth: ${err.message}`);
      return false;
    }
  }

  private async fetchAndStoreProfile(accessToken: string): Promise<void> {
    try {
      const response = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (response.ok) {
        const data: any = await response.json();
        const sub = data.sub;
        const name = data.name || `${data.given_name || ''} ${data.family_name || ''}`.trim();
        if (sub) {
          await this.saveAuthorUrn(`urn:li:person:${sub}`);
        }
        if (name) {
          await this.saveAuthorName(name);
        }
      }
    } catch {
      // Ignorar error no crítico
    }
  }
}
