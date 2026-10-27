const Module = require('module');
const originalRequire = Module.prototype.require;

// Interceptar require('vscode') para pruebas unitarias fuera del host de VS Code
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        getConfiguration: () => ({
          get: (key, defaultValue) => defaultValue,
        }),
      },
      window: {
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined,
        createWebviewPanel: () => ({}),
        createStatusBarItem: () => ({
          show: () => {},
          dispose: () => {},
        }),
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
      ViewColumn: { One: 1, Two: 2 },
      ProgressLocation: { Notification: 15 },
      Uri: {
        parse: (str) => ({ toString: () => str }),
        file: (str) => ({ fsPath: str }),
      },
      LanguageModelChatMessage: {
        User: (content) => ({ role: 1, content }),
      },
      CancellationTokenSource: class {
        constructor() {
          this.token = { isCancellationRequested: false };
        }
      },
      lm: {
        selectChatModels: async () => [],
      },
    };
  }
  return originalRequire.apply(this, arguments);
};
