import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SnapshotService } from '../snapshot/snapshotService';
import { AIService } from '../ai/aiService';
import { GitService } from '../git/gitService';
import { LinkedInClient } from '../linkedin/linkedinClient';
import { GitCommitContext } from '../types';

describe('2share Unit Tests', () => {
  describe('GitService (REQ-001)', () => {
    it('debe inicializarse con el espacio de trabajo activo', () => {
      const gitService = new GitService(process.cwd());
      assert.ok(gitService);
    });

    it('debe poder consultar los commits del repositorio actual de 2share', async () => {
      const gitService = new GitService(process.cwd());
      const commits = await gitService.getRecentCommits(5);
      assert.ok(Array.isArray(commits));
      assert.ok(commits.length >= 1);
      assert.ok(commits[0].hash);
      assert.ok(commits[0].message);
    });

    it('debe extraer el contexto estructurado del último commit', async () => {
      const gitService = new GitService(process.cwd());
      const commits = await gitService.getRecentCommits(1);
      const commitContext = await gitService.getCommitContext(commits[0].hash);

      assert.strictEqual(commitContext.hash, commits[0].hash);
      assert.ok(commitContext.shortHash);
      assert.ok(Array.isArray(commitContext.changedFiles));
    });
  });

  describe('SnapshotService (REQ-003)', () => {
    const snapshotService = new SnapshotService();

    it('debe extraer el mejor snippet de código de un GitCommitContext', () => {
      const mockContext: GitCommitContext = {
        hash: 'a1b2c3d4e5f6',
        shortHash: 'a1b2c3d',
        message: 'feat: add user authentication handler',
        author: 'Joset Manihuari',
        date: '2026-10-27',
        changedFiles: [
          {
            filePath: 'package-lock.json',
            additions: 100,
            deletions: 10,
            patch: '+ "version": "1.0.0"',
          },
          {
            filePath: 'src/auth/service.ts',
            additions: 15,
            deletions: 2,
            patch: `@@ -1,5 +1,12 @@
 import { Token } from './types';
+export async function authenticateUser(token: string): Promise<boolean> {
  const isValid = token.length > 10;
  return isValid;
 }`,
          },
        ],
      };

      const snippet = snapshotService.extractBestSnippet(mockContext);
      assert.strictEqual(snippet.fileName, 'service.ts');
      assert.strictEqual(snippet.language, 'typescript');
      assert.ok(snippet.code.includes('authenticateUser'));
    });

    it('debe generar un SVG estilizado con ventana macOS y tema Nord', () => {
      const snapshot = snapshotService.generateSnapshot(
        'example.ts',
        'typescript',
        'const greeting = "Hello 2share";',
        'nord'
      );

      assert.strictEqual(snapshot.theme, 'nord');
      assert.strictEqual(snapshot.mimeType, 'image/svg+xml');
      assert.ok(snapshot.svgContent.includes('<svg'));
      assert.ok(snapshot.svgContent.includes('example.ts'));
      assert.ok(snapshot.svgContent.includes('#ff5f56')); // Botón rojo macOS
      assert.ok(snapshot.svgContent.includes('#ffbd2e')); // Botón amarillo macOS
      assert.ok(snapshot.svgContent.includes('#27c93f')); // Botón verde macOS
      assert.ok(snapshot.dataUri.startsWith('data:image/svg+xml;base64,'));
    });

    it('debe escapar correctamente caracteres XML/HTML peligrosos en el SVG', () => {
      const dangerousCode = 'if (a < 5 && b > 10) { const tag = "<div>"; }';
      const snapshot = snapshotService.generateSnapshot('safe.ts', 'typescript', dangerousCode, 'dracula');

      assert.ok(!snapshot.svgContent.includes('<div>'));
      assert.ok(snapshot.svgContent.includes('&lt;'));
      assert.ok(snapshot.svgContent.includes('&gt;'));
      assert.ok(snapshot.svgContent.includes('&amp;&amp;'));
      assert.ok(snapshot.svgContent.includes('&quot;&lt;div&gt;&quot;'));
    });
  });

  describe('AIService Manual Template (REQ-002)', () => {
    const aiService = new AIService();

    it('debe generar una plantilla manual estructurada cuando no hay modelos LLM disponibles', () => {
      const mockContext: GitCommitContext = {
        hash: '9999999',
        shortHash: '9999999',
        message: 'fix: handle memory leak in webview listener',
        author: 'Joset Manihuari',
        date: '2026-10-27',
        changedFiles: [
          {
            filePath: 'src/webview/panel.ts',
            additions: 4,
            deletions: 1,
            patch: '',
          },
        ],
      };

      const template = aiService.generateManualTemplate(mockContext);
      assert.ok(template.includes('handle memory leak in webview listener'));
      assert.ok(template.includes('src/webview/panel.ts'));
      assert.ok(template.includes('#SoftwareEngineering'));
      assert.ok(template.includes('Reto técnico superado'));
    });
  });

  describe('LinkedInClient Configuration (REQ-005)', () => {
    it('debe almacenar y recuperar tokens en SecretStorage de VS Code', async () => {
      const storedSecrets: Record<string, string> = {};
      const mockContext: any = {
        secrets: {
          get: async (key: string) => storedSecrets[key],
          store: async (key: string, value: string) => {
            storedSecrets[key] = value;
          },
          delete: async (key: string) => {
            delete storedSecrets[key];
          },
        },
      };

      const client = new LinkedInClient(mockContext);
      await client.saveAccessToken('test-token-12345');
      await client.saveAuthorUrn('urn:li:person:abcdef');

      assert.strictEqual(await client.getAccessToken(), 'test-token-12345');
      assert.strictEqual(await client.getAuthorUrn(), 'urn:li:person:abcdef');

      await client.clearCredentials();
      assert.strictEqual(await client.getAccessToken(), undefined);
      assert.strictEqual(await client.getAuthorUrn(), undefined);
    });
  });
});
