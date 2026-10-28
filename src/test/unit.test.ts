import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { GitService } from '../git/gitService';
import { AIService } from '../ai/aiService';
import { SnapshotService } from '../snapshot/snapshotService';
import { LinkedInClient } from '../linkedin/linkedinClient';
import { GitCommitContext } from '../types';

describe('2share Unit Tests - All Requirements (REQ-001 to REQ-005)', () => {
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

    it('debe consolidar múltiples commits en un solo contexto (REQ-001 Escenario 4)', async () => {
      const gitService = new GitService(process.cwd());
      const commits = await gitService.getRecentCommits(3);
      if (commits.length >= 2) {
        const hashes = [commits[0].hash, commits[1].hash];
        const multiContext = await gitService.getMultiCommitContext(hashes, 'Métrica: +35% velocidad');

        assert.strictEqual(multiContext.mode, 'commits');
        assert.ok(multiContext.selectedHashes && multiContext.selectedHashes.length === 2);
        assert.strictEqual(multiContext.userContext, 'Métrica: +35% velocidad');
        assert.ok(multiContext.message.includes(commits[0].shortHash));
        assert.ok(multiContext.message.includes(commits[1].shortHash));
        assert.ok(Array.isArray(multiContext.changedFiles));
      }
    });

    it('debe extraer contexto a partir de archivos seleccionados (REQ-001 Escenario 5)', async () => {
      const gitService = new GitService(process.cwd());
      const filesContext = await gitService.getFilesContext(
        ['package.json', 'README.md'],
        'Refactorización de configuración'
      );

      assert.strictEqual(filesContext.mode, 'files');
      assert.strictEqual(filesContext.userContext, 'Refactorización de configuración');
      assert.ok(filesContext.selectedFiles && filesContext.selectedFiles.length === 2);
      assert.ok(filesContext.message.includes('package.json'));
      assert.ok(filesContext.changedFiles.length >= 1);
    });

    it('debe listar archivos de workspace o git status (REQ-001 Escenario 5)', async () => {
      const gitService = new GitService(process.cwd());
      const files = await gitService.getWorkspaceFiles();
      assert.ok(Array.isArray(files));
      assert.ok(files.length > 0);
      assert.ok(files[0].relativePath);
      assert.ok(files[0].status);
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

    it('debe incorporar el userContext personalizado en la plantilla (REQ-002 Escenario 4)', () => {
      const mockContextWithUserContext: GitCommitContext = {
        hash: '8888888',
        shortHash: '8888888',
        message: 'perf: optimize database query cache',
        author: 'Joset Manihuari',
        date: '2026-10-27',
        userContext: 'Redujimos la latencia de 1200ms a 45ms usando Redis con TTL dinámico',
        changedFiles: [
          {
            filePath: 'src/db/cache.ts',
            additions: 25,
            deletions: 5,
            patch: '',
          },
        ],
      };

      const template = aiService.generateManualTemplate(mockContextWithUserContext);
      assert.ok(template.includes('Redujimos la latencia de 1200ms a 45ms'));
      assert.ok(template.includes('Contexto & Reto destacado'));
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

    it('debe extraer fragmento de código plano en modo archivos sin prefijos de diff', () => {
      const mockFileContext: GitCommitContext = {
        hash: 'workspace-files',
        shortHash: 'Archivos',
        message: 'Trabajo en archivos: config.ts',
        author: 'Joset Manihuari',
        date: '2026-10-27',
        mode: 'files',
        changedFiles: [
          {
            filePath: 'src/config.ts',
            additions: 10,
            deletions: 0,
            patch: `export const API_URL = "https://api.2share.dev";
export const TIMEOUT = 5000;
export function getConfig() { return { API_URL, TIMEOUT }; }`,
          },
        ],
      };

      const snippet = snapshotService.extractBestSnippet(mockFileContext);
      assert.strictEqual(snippet.fileName, 'config.ts');
      assert.strictEqual(snippet.language, 'typescript');
      assert.ok(snippet.code.includes('API_URL'));
    });

    it('debe priorizar el snippet de código personalizado cuando se especifica (REQ-003 Escenario 5)', () => {
      const mockCustomContext: GitCommitContext = {
        hash: 'custom-hash',
        shortHash: 'custom',
        message: 'feat: add query optimization',
        author: 'Joset Manihuari',
        date: '2026-10-27',
        changedFiles: [
          {
            filePath: 'src/old.ts',
            additions: 1,
            deletions: 1,
            patch: '+ const old = true;',
          },
        ],
        customSnippet: {
          code: 'SELECT * FROM users WHERE active = true;',
          fileName: 'query.sql',
          language: 'sql',
        },
      };

      const snippet = snapshotService.extractBestSnippet(mockCustomContext);
      assert.strictEqual(snippet.fileName, 'query.sql');
      assert.strictEqual(snippet.language, 'sql');
      assert.strictEqual(snippet.code, 'SELECT * FROM users WHERE active = true;');
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
      assert.ok(snapshot.svgContent.includes('#ff5f56'));
      assert.ok(snapshot.svgContent.includes('#ffbd2e'));
      assert.ok(snapshot.svgContent.includes('#27c93f'));
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

  describe('OAuthServer (REQ-005 Browser OAuth)', () => {
    it('debe generar el redirect URI y state válidos para OAuth de LinkedIn', () => {
      const { OAuthServer } = require('../linkedin/oauthServer');
      const server = new OAuthServer(54321);
      assert.strictEqual(server.getRedirectUri(), 'http://127.0.0.1:54321/callback');

      const state1 = server.generateState();
      const state2 = server.generateState();
      assert.ok(state1 && state1.length >= 16);
      assert.notStrictEqual(state1, state2);
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

