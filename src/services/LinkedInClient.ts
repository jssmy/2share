import * as vscode from 'vscode';
import { LinkedInPublishResult, UserProfile } from '../models';
import { LinkedInAuthService } from './LinkedInAuthService';

export class LinkedInClient {
  private static readonly LINKEDIN_API_VERSION = '202401';

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

      const response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': LinkedInClient.LINKEDIN_API_VERSION,
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

      const errorText = await response.text();
      return {
        success: false,
        error: `Error de API de LinkedIn (${response.status}): ${errorText}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Error de red al publicar en LinkedIn: ${err.message}`,
      };
    }
  }

  /**
   * Sube una imagen a LinkedIn usando Assets API
   */
  public async uploadImage(imageBuffer: Buffer, mimeType = 'image/png'): Promise<string> {
    const accessToken = await this.authService.getAccessToken();
    const authorUrn = await this.authService.getAuthorUrn();

    if (!accessToken || !authorUrn) {
      throw new Error('Debes iniciar sesión con LinkedIn para subir imágenes.');
    }

    // 1. Registrar upload
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

    if (!registerResponse.ok) {
      const err = await registerResponse.text();
      throw new Error(`Error registrando imagen: ${registerResponse.status} ${err}`);
    }

    const regData: any = await registerResponse.json();
    const uploadUrl =
      regData.value?.uploadMechanism?.[
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
      ]?.uploadUrl;
    const assetUrn = regData.value?.asset;

    if (!uploadUrl || !assetUrn) {
      throw new Error('Respuesta inválida al registrar imagen en LinkedIn.');
    }

    // 2. Subir buffer
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
      throw new Error(`Error cargando imagen: ${uploadResponse.status} ${err}`);
    }

    return assetUrn;
  }
}

