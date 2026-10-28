import * as vscode from 'vscode';
import { LinkedInPublishResult, UserProfile } from '../models';
import { LinkedInAuthService } from './LinkedInAuthService';

export class LinkedInClient {
  /**
   * Obtiene la lista de versiones candidatas de la API de LinkedIn.
   * LinkedIn requiere el encabezado 'LinkedIn-Version: YYYYMM'.
   * Las versiones expiran a los 12 meses; por ello se genera dinámicamente
   * el mes actual y los últimos 6 meses precedentes, garantizando una versión activa.
   */
  public static getCandidateVersions(): string[] {
    const versions: string[] = [];
    const config = vscode.workspace.getConfiguration('share-to-linkedin');
    const customVersion = config.get<string>('apiVersion');
    if (customVersion && customVersion.trim()) {
      versions.push(customVersion.trim());
    }

    const now = new Date();
    // Mes actual y los 6 meses anteriores (YYYYMM)
    for (let i = 0; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const v = `${year}${month}`;
      if (!versions.includes(v)) {
        versions.push(v);
      }
    }

    // Versiones de respaldo
    const fallbacks = ['202601', '202512', '202510'];
    for (const fb of fallbacks) {
      if (!versions.includes(fb)) {
        versions.push(fb);
      }
    }

    return versions;
  }

  constructor(
    private context: vscode.ExtensionContext,
    private authService: LinkedInAuthService
  ) {}

  public async getUserProfile(): Promise<UserProfile> {
    const token = await this.authService.getAccessToken();
    const name = await this.authService.getAuthorName();
    const authorUrn = await this.authService.getAuthorUrn();

    // Obtener headline de configuración
    const config = vscode.workspace.getConfiguration('share-to-linkedin');
    const headline = config.get<string>(
      'userHeadline',
      'Full Stack Developer | Angular • Laravel'
    );

    return {
      name: name || 'Joset Manihuari',
      headline,
      authorUrn,
      isConnected: !!token,
    };
  }

  /**
   * Publica un post en LinkedIn mediante los endpoints oficiales
   * Con gestión dinámica de versiones activas y fallback a v2 / portapapeles
   * (Cumple con Prompt Maestro Sección 8)
   */
  public async createPost(
    commentary: string,
    imageUrn?: string
  ): Promise<LinkedInPublishResult> {
    const accessToken = await this.authService.getAccessToken();
    const authorUrn = await this.authService.getAuthorUrn();

    // Modo sin credenciales / desarrollo
    if (!accessToken || !authorUrn) {
      const copy = await vscode.window.showWarningMessage(
        'Share to LinkedIn: No has conectado tu cuenta de LinkedIn aún. ¿Deseas copiar el post al portapapeles y abrir LinkedIn en el navegador?',
        'Copiar y Abrir LinkedIn',
        'Conectar Cuenta'
      );

      if (copy === 'Copiar y Abrir LinkedIn') {
        await vscode.env.clipboard.writeText(commentary);
        await vscode.env.openExternal(vscode.Uri.parse('https://www.linkedin.com/feed/'));
        return { success: true, isMock: true };
      } else if (copy === 'Conectar Cuenta') {
        await this.authService.promptAuthentication();
      }

      return {
        success: false,
        error: 'Cuenta no conectada.',
      };
    }

    try {
      const payload: any = {
        author: authorUrn,
        commentary: commentary.trim(),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };

      if (imageUrn) {
        payload.content = {
          media: {
            id: imageUrn,
          },
        };
      }

      // 1. Intentar con las versiones REST activas de LinkedIn
      const candidateVersions = LinkedInClient.getCandidateVersions();
      let lastError = '';
      let lastStatus = 0;

      for (const version of candidateVersions) {
        const response = await fetch('https://api.linkedin.com/rest/posts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'LinkedIn-Version': version,
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 201) {
          const postUrn = response.headers.get('x-restli-id') || undefined;
          let postUrl: string | undefined;
          if (postUrn) {
            postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`;
          }
          return { success: true, postUrn, postUrl };
        }

        // Si es 426 (versión inactiva), continuar con la siguiente versión candidata
        if (response.status === 426) {
          const errText = await response.text();
          lastError = errText;
          lastStatus = 426;
          continue;
        }

        // Si falla 401, token expirado
        if (response.status === 401) {
          await this.authService.clearCredentials();
          return {
            success: false,
            error: 'Sesión expirada (401). Vuelve a conectar tu cuenta de LinkedIn.',
          };
        }

        // 403 Forbidden
        if (response.status === 403) {
          const errorBody = await response.text();
          return {
            success: false,
            error: `Permisos insuficientes en LinkedIn (403): ${errorBody}. Asegúrate de tener concedido w_member_social.`,
          };
        }

        lastStatus = response.status;
        lastError = await response.text();
        break;
      }

      // 2. Intento de fallback mediante la API v2/ugcPosts si /rest/posts fue rechazado
      try {
        const v2Payload: any = {
          author: authorUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: {
                text: commentary.trim(),
              },
              shareMediaCategory: imageUrn ? 'IMAGE' : 'NONE',
            },
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
          },
        };

        if (imageUrn) {
          v2Payload.specificContent['com.linkedin.ugc.ShareContent'].media = [
            {
              status: 'READY',
              description: { text: 'Code Snapshot' },
              media: imageUrn,
              title: { text: 'Share to LinkedIn' },
            },
          ];
        }

        const v2Response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify(v2Payload),
        });

        if (v2Response.status === 201) {
          const postUrn = v2Response.headers.get('x-restli-id') || undefined;
          let postUrl: string | undefined;
          if (postUrn) {
            postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`;
          }
          return { success: true, postUrn, postUrl };
        }
      } catch {
        // Fallback ignorado si no hay conectividad a v2
      }

      // 3. Prompt Maestro Sección 8: Ofrecer copiar al portapapeles y abrir feed
      const action = await vscode.window.showErrorMessage(
        `Share to LinkedIn: Error de API (${lastStatus || 400}). ${lastError || ''}`,
        'Copiar y abrir LinkedIn',
        'Cerrar'
      );

      if (action === 'Copiar y abrir LinkedIn') {
        await vscode.env.clipboard.writeText(commentary);
        await vscode.env.openExternal(vscode.Uri.parse('https://www.linkedin.com/feed/'));
        return { success: true, isMock: true };
      }

      return {
        success: false,
        error: `Error de API de LinkedIn (${lastStatus}): ${lastError}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Error de red al publicar en LinkedIn: ${err.message}`,
      };
    }
  }

  /**
   * Sube una imagen a LinkedIn usando REST Images API oficial
   * (con soporte dinámico de versiones y fallback a v2/assets)
   */
  public async uploadImage(imageBuffer: Buffer, mimeType = 'image/png'): Promise<string> {
    const accessToken = await this.authService.getAccessToken();
    const authorUrn = await this.authService.getAuthorUrn();

    if (!accessToken || !authorUrn) {
      throw new Error('Debes iniciar sesión con LinkedIn para subir imágenes.');
    }

    const candidateVersions = LinkedInClient.getCandidateVersions();
    let lastError = '';

    // 1. Intentar con REST Images API oficial de LinkedIn (/rest/images?action=initializeUpload)
    for (const version of candidateVersions) {
      try {
        const initResponse = await fetch(
          'https://api.linkedin.com/rest/images?action=initializeUpload',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'LinkedIn-Version': version,
              'X-Restli-Protocol-Version': '2.0.0',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              initializeUploadRequest: {
                owner: authorUrn,
              },
            }),
          }
        );

        if (initResponse.status === 426) {
          lastError = await initResponse.text();
          continue;
        }

        if (!initResponse.ok) {
          lastError = await initResponse.text();
          break;
        }

        const initData: any = await initResponse.json();
        const uploadUrl = initData?.value?.uploadUrl;
        const imageUrn = initData?.value?.image;

        if (!uploadUrl || !imageUrn) {
          throw new Error('Respuesta inválida de LinkedIn al inicializar carga de imagen.');
        }

        // Subir binario crudo a la URL devuelta por LinkedIn
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': mimeType,
          },
          body: new Uint8Array(imageBuffer),
        });

        if (!uploadResponse.ok) {
          const err = await uploadResponse.text();
          throw new Error(`Error cargando binario de imagen (${uploadResponse.status}): ${err}`);
        }

        return imageUrn; // Formato oficial urn:li:image:...
      } catch (err: any) {
        lastError = err.message;
      }
    }

    // 2. Fallback a v2/assets si /rest/images fue rechazado
    try {
      const registerResponse = await fetch(
        'https://api.linkedin.com/v2/assets?action=registerUpload',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            registerUploadRequest: {
              recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
              owner: authorUrn,
              serviceRelationships: [
                {
                  relationshipType: 'OWNER',
                  identifier: 'urn:li:userGeneratedContent',
                },
              ],
            },
          }),
        }
      );

      if (registerResponse.ok) {
        const regData: any = await registerResponse.json();
        const uploadUrl =
          regData.value?.uploadMechanism?.[
            'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
          ]?.uploadUrl;
        const assetUrn = regData.value?.asset;

        if (uploadUrl && assetUrn) {
          const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': mimeType,
            },
            body: new Uint8Array(imageBuffer),
          });

          if (uploadResponse.ok) {
            return assetUrn;
          }
        }
      }
    } catch {
      // Ignorar fallback si falla la red
    }

    throw new Error(`No se pudo subir la imagen a LinkedIn: ${lastError}`);
  }
}

