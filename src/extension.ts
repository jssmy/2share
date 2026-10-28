import * as vscode from 'vscode';
import { SelectionService } from './services/SelectionService';
import { GitService } from './services/GitService';
import { PostComposerService } from './services/PostComposerService';
import { LinkedInAuthService } from './services/LinkedInAuthService';
import { LinkedInClient } from './services/LinkedInClient';
import { SettingsService } from './services/SettingsService';
import { ShareViewProvider } from './providers/ShareViewProvider';
import { ComposerPanel } from './providers/ComposerPanel';
import { SettingsPanel } from './providers/SettingsPanel';

export function activate(context: vscode.ExtensionContext) {
  // Inicialización de servicios con inyección de dependencias
  const selectionService = new SelectionService();
  const gitService = new GitService();
  const composerService = new PostComposerService();
  const settingsService = new SettingsService();
  const authService = new LinkedInAuthService(context);
  const linkedInClient = new LinkedInClient(context, authService);

  // 1. Registro del panel lateral (Activity Bar)
  const shareViewProvider = new ShareViewProvider(context.extensionUri, authService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ShareViewProvider.viewType,
      shareViewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // Registro para compatibilidad retroactiva de vista previa
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('2share.sidebarView', shareViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // 2. Comando: Compartir selección (Ctrl+Alt+L / Cmd+Alt+L)
  const shareSelectionCommand = vscode.commands.registerCommand(
    'share-to-linkedin.shareSelection',
    async () => {
      await ComposerPanel.createOrShow(
        context.extensionUri,
        selectionService,
        gitService,
        composerService,
        linkedInClient,
        settingsService,
        'selection'
      );
    }
  );
  context.subscriptions.push(shareSelectionCommand);

  // 3. Comando: Compartir último commit (Ctrl+Alt+C / Cmd+Alt+C)
  const shareLastCommitCommand = vscode.commands.registerCommand(
    'share-to-linkedin.shareLastCommit',
    async () => {
      const isGit = await gitService.isGitRepository();
      if (!isGit) {
        vscode.window.showWarningMessage(
          'Share to LinkedIn: El espacio de trabajo actual no es un repositorio Git válido.'
        );
        return;
      }

      try {
        await ComposerPanel.createOrShow(
          context.extensionUri,
          selectionService,
          gitService,
          composerService,
          linkedInClient,
          settingsService,
          'commit'
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Share to LinkedIn: ${err.message}`);
      }
    }
  );
  context.subscriptions.push(shareLastCommitCommand);

  // 4. Comando: Abrir compositor
  const openComposerCommand = vscode.commands.registerCommand(
    'share-to-linkedin.openComposer',
    async () => {
      await ComposerPanel.createOrShow(
        context.extensionUri,
        selectionService,
        gitService,
        composerService,
        linkedInClient,
        settingsService,
        'selection'
      );
    }
  );
  context.subscriptions.push(openComposerCommand);

  // 5. Comando: Configuración
  const openSettingsCommand = vscode.commands.registerCommand(
    'share-to-linkedin.openSettings',
    async () => {
      await SettingsPanel.createOrShow(
        context.extensionUri,
        settingsService,
        authService,
        linkedInClient
      );
    }
  );
  context.subscriptions.push(openSettingsCommand);

  // Comando: Abrir panel lateral
  const openSidebarCommand = vscode.commands.registerCommand(
    'share-to-linkedin.openSidebar',
    async () => {
      try {
        await vscode.commands.executeCommand(
          'workbench.view.extension.share-to-linkedin-view-container'
        );
      } catch {
        await vscode.commands.executeCommand('share-to-linkedin.sidebarView.focus');
      }
    }
  );
  context.subscriptions.push(openSidebarCommand);

  // 6. Comando: Ayuda
  const helpCommand = vscode.commands.registerCommand('share-to-linkedin.help', async () => {
    const action = await vscode.window.showInformationMessage(
      'Share to LinkedIn: Comparte código seleccionado o commits en LinkedIn con vista previa fiel y control total.',
      'Abrir Guía',
      'Configuración',
      'Cerrar'
    );
    if (action === 'Abrir Guía') {
      await vscode.env.openExternal(vscode.Uri.parse('https://github.com/jssmy/2share#readme'));
    } else if (action === 'Configuración') {
      await vscode.commands.executeCommand('share-to-linkedin.openSettings');
    }
  });
  context.subscriptions.push(helpCommand);

  // Comandos de compatibilidad retroactiva con 2share
  context.subscriptions.push(
    vscode.commands.registerCommand('2share.createPost', async () => {
      await vscode.commands.executeCommand('share-to-linkedin.shareSelection');
    }),
    vscode.commands.registerCommand('2share.openSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.share-to-linkedin-view-container');
    }),
    vscode.commands.registerCommand('2share.configureLinkedIn', async () => {
      await vscode.commands.executeCommand('share-to-linkedin.openSettings');
    })
  );

  // 7. Barra de estado inferior
  const statusBarItem = vscode.window.createStatusBarItem(
    'shareToLinkedIn.statusBar',
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'share-to-linkedin.openComposer';
  statusBarItem.text = '$(send) Share to LinkedIn';
  statusBarItem.tooltip = 'Share to LinkedIn: Clic para abrir el compositor';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate() {
  if (ComposerPanel.currentPanel) {
    ComposerPanel.currentPanel.dispose();
  }
  if (SettingsPanel.currentPanel) {
    SettingsPanel.currentPanel.dispose();
  }
}
