import * as vscode from 'vscode';

export class ActionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly subLabel: string,
    public readonly commandId: string,
    iconName: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = subLabel;
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.command = {
      command: commandId,
      title: label,
    };
  }
}

export class SidebarProvider implements vscode.TreeDataProvider<ActionItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ActionItem | undefined | void> =
    new vscode.EventEmitter<ActionItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ActionItem | undefined | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ActionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<ActionItem[]> {
    return Promise.resolve([
      new ActionItem(
        'Crear Post desde Commit',
        'Extrae diff, IA y vista previa',
        '2share.createPost',
        'send'
      ),
      new ActionItem(
        'Configurar Cuenta LinkedIn',
        'Credenciales OAuth2 seguras',
        '2share.configureLinkedIn',
        'settings-gear'
      ),
    ]);
  }
}
