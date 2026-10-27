import * as vscode from 'vscode';
import { LinkedInPublishResult } from '../types';

export class LinkedInClient {
  private static readonly TOKEN_SECRET_KEY = '2share.linkedin.token';
  private static readonly PERSON_URN_SECRET_KEY = '2share.linkedin.personUrn';
  private static readonly LINKEDIN_API_VERSION = '202401';

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Obtiene el token de acceso guardado en el SecretStorage de VS Code
   * Cumple con REQ-005 Escenario 1
   */
  public async getAccessToken(): Promise<string | undefined> {
    return await this.context.secrets.get(LinkedInClient.TOKEN_SECRET_KEY);
  }

  /**
   * Guarda el token de acceso cifrado en el SecretStorage de VS Code
   */
  public async saveAccessToken(token: string): Promise<void> {
    await this.context.secrets.store(LinkedInClient.TOKEN_SECRET_KEY, token.trim());
  }

  /**
   * Obtiene el URN del autor configurado (persona u organización)
   */
  public async getAuthorUrn(): Promise<string | undefined> {
    // 1. Verificar si está en secrets
    const savedUrn = await this.context.secrets.get(LinkedInClient.PERSON_URN_SECRET_KEY);
    if (savedUrn) {
      return savedUrn;
    }

    // 2. Verificar configuración de settings
    const config = vscode.workspace.getConfiguration('2share');
    const configUrn = config.get<string>('authorPersonUrn');
    if (configUrn && configUrn.trim()) {
      return configUrn.trim();
    }

    return undefined;
  }

  /**
   * Guarda el URN del autor en secrets
   */
  public async saveAuthorUrn(urn: string): Promise<void> {
    await this.context.secrets.store(LinkedInClient.PERSON_URN_SECRET_KEY, urn.trim());
  }

  /**
   * Elimina las credenciales guardadas (Cerrar sesión)
   */
  public async clearCredentials(): Promise<void> {
    await this.context.secrets.delete(LinkedInClient.TOKEN_SECRET_KEY);
    await this.context.secrets.delete(LinkedInClient.PERSON_URN_SECRET_KEY);
  }

  /**
   * Solicita al usuario autenticarse o ingresar sus credenciales
   * Cumple con REQ-005 Escenarios 1 y 4
   */
  public async promptAuthentication(): Promise<boolean> {
    const action = await vscode.window.showInformationMessage(
      '2share: Configuración de cuenta de LinkedIn. ¿Deseas ingresar tu Access Token de OAuth2?',
      'Ingresar Token',
      'Ver Guía de Creación de App'
    );

    if (action === 'Ver Guía de Creación de App') {
      await vscode.env.openExternal(
        vscode.Uri.parse('https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow')
      );
    }

    if (action === 'Ingresar Token' || action === 'Ver Guía de Creación de App') {
      const token = await vscode.window.showInputBox({
        title: '2share: Token de Acceso OAuth2 de LinkedIn',
        prompt: 'Pega tu token de acceso OAuth2 (con scopes: w_member_social, openid, profile)',
        password: true,
        ignoreFocusOut: true,
      });

      if (!token || !token.trim()) {
        return false;
      }

      let authorUrn = await this.getAuthorUrn();
      if (!authorUrn) {
        // Intentar obtener el perfil del usuario mediante la API de userInfo
        try {
          const profileUrn = await this.fetchUserUrn(token.trim());
          if (profileUrn) {
            authorUrn = profileUrn;
          }
        } catch {
          // Si falla, pedirlo al usuario
        }

        if (!authorUrn) {
          const manualUrn = await vscode.window.showInputBox({
            title: '2share: LinkedIn Person URN',
            prompt: 'Ingresa tu identificador URN de LinkedIn (ej: urn:li:person:abcdef123)',
            placeHolder: 'urn:li:person:XXXXXX',
            ignoreFocusOut: true,
          });
          if (manualUrn && manualUrn.trim()) {
            authorUrn = manualUrn.trim();
          }
        }
      }

      await this.saveAccessToken(token);
      if (authorUrn) {
        await this.saveAuthorUrn(authorUrn);
      }

      vscode.window.showInformationMessage('2share: ¡Credenciales de LinkedIn configuradas con éxito!');
      return true;
    }

    return false;
  }

  /**
   * Consulta el sub/id del usuario autenticado vía UserInfo de LinkedIn
   */
  private async fetchUserUrn(token: string): Promise<string | undefined> {
    try {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data: any = await res.json();
        if (data.sub) {
          return `urn:li:person:${data.sub}`;
        }
      }
    } catch {
      // Ignorar fallback
    }
    return undefined;
  }

  /**
   * Inicializa la carga de imagen en LinkedIn Assets API y sube el archivo
   * Cumple con REQ-005 Escenario 2
   */
  public async uploadImage(imageBuffer: Buffer, mimeType = 'image/png'): Promise<string> {
    const token = await this.getAccessToken();
    const authorUrn = await this.getAuthorUrn();

    if (!token || !authorUrn) {
      throw new Error('No se han configurado las credenciales de LinkedIn.');
    }

    // 1. Inicializar carga
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

    // 2. Subir buffer binario de la imagen
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
   * Cumple con REQ-005 Escenario 3
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

