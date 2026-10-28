import * as vscode from 'vscode';
import { GitService } from './git/gitService';
import { AIService } from './ai/aiService';
import { SnapshotService } from './snapshot/snapshotService';
import { PreviewPanel } from './webview/previewPanel';
import { LinkedInClient } from './linkedin/linkedinClient';
import { SidebarWebviewProvider } from './sidebar/sidebarWebviewProvider';
import { SnapshotTheme, GitCommitContext } from './types';

export function activate(context: vscode.ExtensionContext) {
  const gitService = new GitService();
  const aiService = new AIService();
  const snapshotService = new SnapshotService();
  const linkedInClient = new LinkedInClient(context);

  // Registrar panel lateral Webview en la Activity Bar
  const sidebarWebviewProvider = new SidebarWebviewProvider(
    context.extensionUri,
    linkedInClient,
    gitService
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarWebviewProvider.viewType,
      sidebarWebviewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // Comando: Abrir panel lateral
  const openSidebarCommand = vscode.commands.registerCommand(
    '2share.openSidebar',
    async () => {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.2share-view-container');
      } catch (err: any) {
        // Fallback para enfocar la vista directamente
        await vscode.commands.executeCommand('2share.sidebarView.focus');
      }
    }
  );
  context.subscriptions.push(openSidebarCommand);

  // Menú rápido de la barra de estado
  const showMenuCommand = vscode.commands.registerCommand(
    '2share.showMenu',
    async () => {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '$(layout-sidebar-left) Abrir Panel 2share',
            description: 'Vista general, guía e inicio de sesión con LinkedIn',
            id: 'openSidebar',
          },
          {
            label: '$(send) Crear Post desde Commit',
            description: 'Selecciona commit de Git y abre vista previa',
            id: 'createPost',
          },
          {
            label: '$(settings-gear) Configurar LinkedIn',
            description: 'Gestionar token de acceso y credenciales',
            id: 'configureLinkedIn',
          },
        ],
        {
          placeHolder: '2share: ¿Qué deseas hacer?',
        }
      );

      if (choice) {
        if (choice.id === 'openSidebar') {
          await vscode.commands.executeCommand('2share.openSidebar');
        } else if (choice.id === 'createPost') {
          await vscode.commands.executeCommand('2share.createPost');
        } else if (choice.id === 'configureLinkedIn') {
          await vscode.commands.executeCommand('2share.configureLinkedIn');
        }
      }
    }
  );
  context.subscriptions.push(showMenuCommand);

  // Botón rápido en la barra de estado inferior
  const statusBarItem = vscode.window.createStatusBarItem(
    '2share.statusBar',
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = '2share.showMenu';
  statusBarItem.text = '$(send) 2share';
  statusBarItem.tooltip = '2share: Haz clic para abrir el panel o compartir commits';
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

  // Comando Principal: Crear Post (soporta invocación directa desde panel lateral o wizard guiado)
  const createPostCommand = vscode.commands.registerCommand(
    '2share.createPost',
    async (options?: {
      mode?: 'commits' | 'files';
      selectedHashes?: string[];
      selectedFiles?: string[];
      userContext?: string;
      includeImage?: boolean;
      customSnippetCode?: string;
      customSnippetFileName?: string;
    }) => {
      try {
        let commitContext: GitCommitContext | undefined;

        if (
          options &&
          options.mode === 'commits' &&
          options.selectedHashes &&
          options.selectedHashes.length > 0
        ) {
          commitContext = await gitService.getMultiCommitContext(
            options.selectedHashes,
            options.userContext
          );
        } else if (
          options &&
          options.mode === 'files' &&
          options.selectedFiles &&
          options.selectedFiles.length > 0
        ) {
          commitContext = await gitService.getFilesContext(
            options.selectedFiles,
            options.userContext
          );
        } else {
          // Si no se pasaron opciones (se invocó desde paleta de comandos o menú), lanzar wizard
          commitContext = await gitService.promptPostCreation();
        }

        if (!commitContext) {
          return;
        }

        if (options) {
          if (typeof options.includeImage === 'boolean') {
            commitContext.includeImage = options.includeImage;
          }
          if (options.customSnippetCode) {
            commitContext.customSnippet = {
              code: options.customSnippetCode,
              fileName: options.customSnippetFileName || 'snippet.ts',
            };
          }
        }

        // Paso 2: Generación paralela de contenido IA e Imagen (REQ-002 y REQ-003)
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '2share: Procesando contenido para LinkedIn...',
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

            const initialIncludeImage = commitContext.includeImage !== false;

            // Paso 3: Abrir simulador de vista previa y edición (REQ-004)
            PreviewPanel.createOrShow(
              context.extensionUri,
              commitContext,
              initialText,
              initialSnapshot,
              initialIncludeImage,
              {
                onRegenerateAI: async () => {
                  return await aiService.generatePost(commitContext);
                },
                onChangeTheme: async (newTheme: SnapshotTheme) => {
                  initialSnapshot = snapshotService.generateSnapshot(
                    initialSnapshot.fileName,
                    initialSnapshot.language,
                    initialSnapshot.code,
                    newTheme
                  );
                  return initialSnapshot;
                },
                onUpdateSnippet: async (
                  code: string,
                  fileName: string,
                  theme: SnapshotTheme
                ) => {
                  const ext = fileName.split('.').pop() || 'ts';
                  const lang = snapshotService.mapExtensionToLanguage(ext);
                  initialSnapshot = snapshotService.generateSnapshot(
                    fileName,
                    lang,
                    code,
                    theme
                  );
                  return initialSnapshot;
                },
                onGetEditorSelection: async () => {
                  const editor = vscode.window.activeTextEditor;
                  if (editor && !editor.selection.isEmpty) {
                    return {
                      code: editor.document.getText(editor.selection),
                      fileName: editor.document.fileName.split('/').pop() || 'snippet.ts',
                    };
                  }
                  return undefined;
                },
                onPublish: async (finalText: string, currentSnapshot?: any) => {
                  // Paso 4: Publicación en LinkedIn (REQ-005)
                  let imageUrn: string | undefined;

                  if (currentSnapshot && currentSnapshot.imageBuffer) {
                    try {
                      // Subir imagen a LinkedIn Assets API si está habilitada
                      imageUrn = await linkedInClient.uploadImage(
                        currentSnapshot.imageBuffer,
                        currentSnapshot.mimeType === 'image/svg+xml'
                          ? 'image/svg+xml'
                          : 'image/png'
                      );
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
                  }

                  // Publicar post en LinkedIn (con o sin imagen)
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

