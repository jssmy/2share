import * as vscode from 'vscode';
import { GitService } from './git/gitService';
import { AIService } from './ai/aiService';
import { SnapshotService } from './snapshot/snapshotService';
import { PreviewPanel } from './webview/previewPanel';
import { LinkedInClient } from './linkedin/linkedinClient';
import { SidebarProvider } from './sidebar/sidebarProvider';
import { SnapshotTheme } from './types';

export function activate(context: vscode.ExtensionContext) {
  const gitService = new GitService();
  const aiService = new AIService();
  const snapshotService = new SnapshotService();
  const linkedInClient = new LinkedInClient(context);

  // Registrar panel lateral en la Activity Bar
  const sidebarProvider = new SidebarProvider();
  vscode.window.registerTreeDataProvider('2share.mainView', sidebarProvider);

  // Botón rápido en la barra de estado inferior
  const statusBarItem = vscode.window.createStatusBarItem(
    '2share.statusBar',
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = '2share.createPost';
  statusBarItem.text = '$(send) 2share';
  statusBarItem.tooltip = '2share: Compartir Commit en LinkedIn';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Comando: Configurar LinkedIn
  const configCommand = vscode.commands.registerCommand(
    '2share.configureLinkedIn',
    async () => {
      await linkedInClient.promptAuthentication();
    }
  );
  context.subscriptions.push(configCommand);

  // Comando Principal: Crear Post
  const createPostCommand = vscode.commands.registerCommand(
    '2share.createPost',
    async () => {
      try {
        // Paso 1: Selección y extracción del commit (REQ-001)
        const commitContext = await gitService.pickCommit();
        if (!commitContext) {
          return;
        }

        // Paso 2: Generación paralela de contenido IA e Imagen (REQ-002 y REQ-003)
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '2share: Procesando commit para LinkedIn...',
            cancellable: false,
          },
          async (progress) => {
            progress.report({ increment: 20, message: 'Extrayendo fragmento de código...' });
            const snippet = snapshotService.extractBestSnippet(commitContext);

            const config = vscode.workspace.getConfiguration('2share');
            const defaultTheme = config.get<SnapshotTheme>('defaultTheme', 'nord');
            let initialSnapshot = snapshotService.generateSnapshot(
              snippet.fileName,
              snippet.language,
              snippet.code,
              defaultTheme
            );

            progress.report({ increment: 40, message: 'Generando borrador con IA de VS Code...' });
            let initialText = '';
            try {
              initialText = await aiService.generatePost(commitContext);
            } catch (aiErr: any) {
              vscode.window.showWarningMessage(
                `2share: No se pudo consultar la IA (${aiErr.message}). Usando plantilla base.`
              );
              initialText = aiService.generateManualTemplate(commitContext);
            }

            progress.report({ increment: 40, message: 'Abriendo simulador de vista previa...' });

            // Paso 3: Abrir simulador de vista previa y edición (REQ-004)
            PreviewPanel.createOrShow(
              context.extensionUri,
              commitContext,
              initialText,
              initialSnapshot,
              {
                onRegenerateAI: async () => {
                  return await aiService.generatePost(commitContext);
                },
                onChangeTheme: async (newTheme: SnapshotTheme) => {
                  initialSnapshot = snapshotService.generateSnapshot(
                    snippet.fileName,
                    snippet.language,
                    snippet.code,
                    newTheme
                  );
                  return initialSnapshot;
                },
                onPublish: async (finalText: string, currentSnapshot) => {
                  // Paso 4: Publicación en LinkedIn (REQ-005)
                  let imageUrn: string | undefined;

                  try {
                    // Subir imagen a LinkedIn Assets API
                    if (currentSnapshot.imageBuffer) {
                      imageUrn = await linkedInClient.uploadImage(
                        currentSnapshot.imageBuffer,
                        currentSnapshot.mimeType === 'image/svg+xml'
                          ? 'image/svg+xml'
                          : 'image/png'
                      );
                    }
                  } catch (imgError: any) {
                    const proceed = await vscode.window.showWarningMessage(
                      `No se pudo cargar la imagen a LinkedIn (${imgError.message}). ¿Deseas publicar únicamente el texto?`,
                      'Publicar solo texto',
                      'Cancelar'
                    );
                    if (proceed !== 'Publicar solo texto') {
                      return;
                    }
                  }

                  // Publicar post en LinkedIn
                  const publishResult = await linkedInClient.createPost(finalText, imageUrn);

                  if (publishResult.success) {
                    const action = await vscode.window.showInformationMessage(
                      '🎉 ¡Post publicado exitosamente en LinkedIn!',
                      'Ver Publicación',
                      'Cerrar'
                    );
                    if (action === 'Ver Publicación' && publishResult.postUrl) {
                      await vscode.env.openExternal(vscode.Uri.parse(publishResult.postUrl));
                    }
                  } else {
                    vscode.window.showErrorMessage(
                      `2share: Falló la publicación (${publishResult.error})`
                    );
                  }
                },
              }
            );
          }
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`2share: Error en el flujo: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(createPostCommand);
}

export function deactivate() {
  if (PreviewPanel.currentPanel) {
    PreviewPanel.currentPanel.dispose();
  }
}

