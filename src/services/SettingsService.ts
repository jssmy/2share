import * as vscode from 'vscode';
import { PublicationOptions } from '../models';

export class SettingsService {
  private static readonly SECTION = 'share-to-linkedin';
  private static readonly LEGACY_SECTION = '2share';

  public getOptions(): PublicationOptions {
    const config = vscode.workspace.getConfiguration(SettingsService.SECTION);
    const legacyConfig = vscode.workspace.getConfiguration(SettingsService.LEGACY_SECTION);

    return {
      includeFile: config.get<boolean>('includeFile', true),
      showLineNumbers: config.get<boolean>('showLineNumbers', true),
      useCodeFormat: config.get<boolean>('useCodeFormat', true),
      messageTemplate: config.get<string>(
        'messageTemplate',
        'Comparto este código que implementé en mi proyecto. ¡Espero que sea útil! 💡'
      ),
      userHeadline: config.get<string>(
        'userHeadline',
        'Full Stack Developer | Angular • Laravel'
      ),
      aiEnabled: config.get<boolean>('aiEnabled', false),
      aiModelFamily:
        config.get<string>('aiModelFamily') ||
        legacyConfig.get<string>('aiModelFamily', 'gpt-4o'),
    };
  }

  public async updateOptions(partial: Partial<PublicationOptions>): Promise<void> {
    const config = vscode.workspace.getConfiguration(SettingsService.SECTION);

    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    }
  }
}

