import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SelectionService } from '../services/SelectionService';
import { GitService } from '../services/GitService';
import { PostComposerService } from '../services/PostComposerService';
import { SettingsService } from '../services/SettingsService';
import { LinkedInAuthService } from '../services/LinkedInAuthService';
import { LinkedInClient } from '../services/LinkedInClient';
import { OAuthServer } from '../linkedin/oauthServer';
import { CodeSelectionContext, CommitContext } from '../models';

describe('Share to LinkedIn - Unit Test Suite', () => {
  describe('SelectionService', () => {
    const selectionService = new SelectionService();

    it('debe calcular correctamente las insignias de lenguaje (TS, JS, PY, RS, etc.)', () => {
      assert.strictEqual(selectionService.getLanguageBadge('typescript', 'users.service.ts'), 'TS');
      assert.strictEqual(selectionService.getLanguageBadge('javascript', 'index.js'), 'JS');
      assert.strictEqual(selectionService.getLanguageBadge('python', 'script.py'), 'PY');
      assert.strictEqual(selectionService.getLanguageBadge('rust', 'main.rs'), 'RS');
      assert.strictEqual(selectionService.getLanguageBadge('go', 'server.go'), 'GO');
      assert.strictEqual(selectionService.getLanguageBadge('sql', 'query.sql'), 'SQL');
    });
  });

  describe('GitService', () => {
    const gitService = new GitService(process.cwd());

    it('debe detectar correctamente si el entorno es un repositorio Git', async () => {
      const isGit = await gitService.isGitRepository();
      assert.strictEqual(isGit, true);
    });

    it('debe listar archivos no sensibles del espacio de trabajo', async () => {
      const files = await gitService.getWorkspaceFiles();
      assert.ok(Array.isArray(files));
      assert.ok(files.length > 0);
      assert.ok(files.every((f) => !gitService.isSensitiveFile(f)));
    });

    it('debe obtener el último commit con hash, autor y archivos modificados', async () => {
      const lastCommit = await gitService.getLastCommit();
      assert.ok(lastCommit.hash);
      assert.ok(lastCommit.shortHash);
      assert.ok(lastCommit.author);
      assert.ok(Array.isArray(lastCommit.changedFiles));
    });

    it('debe identificar patrones de archivos sensibles para no exponerlos en publicaciones', () => {
      assert.strictEqual(gitService.isSensitiveFile('.env'), true);
      assert.strictEqual(gitService.isSensitiveFile('.env.production'), true);
      assert.strictEqual(gitService.isSensitiveFile('server.key'), true);
      assert.strictEqual(gitService.isSensitiveFile('cert.pem'), true);
      assert.strictEqual(gitService.isSensitiveFile('id_rsa'), true);
      assert.strictEqual(gitService.isSensitiveFile('credentials.json'), true);
      assert.strictEqual(gitService.isSensitiveFile('users.service.ts'), false);
    });
  });

  describe('PostComposerService', () => {
    const composerService = new PostComposerService();

    it('debe redactar una publicación estructurada a partir de una selección de código', () => {
      const mockSelection: CodeSelectionContext = {
        text: 'async createUser(data: CreateUserDto) { return await this.prisma.user.create({ data }); }',
        fileName: 'users.service.ts',
        relativePath: 'src/services/users.service.ts',
        fullPath: '/path/to/users.service.ts',
        languageId: 'typescript',
        languageBadge: 'TS',
        startLine: 12,
        endLine: 22,
        lineCount: 11,
      };

      const { text, hashtags } = composerService.composeFromSelection(
        mockSelection,
        'technical',
        {
          includeFile: true,
          showLineNumbers: true,
          useCodeFormat: true,
          messageTemplate: '',
          userHeadline: '',
          aiEnabled: false,
          aiModelFamily: 'gpt-4o',
        }
      );

      assert.ok(text.includes('users.service.ts'));
      assert.ok(text.includes('TypeScript'));
      assert.ok(text.includes('Líneas 12 - 22'));
      assert.ok(hashtags.includes('#TypeScript'));
      assert.ok(hashtags.includes('#Prisma'));
    });

    it('debe generar la variante de aprendizaje (Learning)', () => {
      const mockSelection: CodeSelectionContext = {
        text: 'const result = calculateMetrics();',
        fileName: 'metrics.ts',
        relativePath: 'src/metrics.ts',
        fullPath: '/path/metrics.ts',
        languageId: 'typescript',
        languageBadge: 'TS',
        startLine: 5,
        endLine: 8,
        lineCount: 4,
      };

      const { text } = composerService.composeFromSelection(mockSelection, 'learning');
      assert.ok(text.includes('Comparto un aprendizaje técnico clave'));
      assert.ok(text.includes('metrics.ts'));
    });

    it('debe redactar una publicación estructurada a partir de un commit', () => {
      const mockCommit: CommitContext = {
        hash: 'abc1234567890',
        shortHash: 'abc1234',
        author: 'Joset Manihuari',
        date: '2026-10-28',
        message: 'feat: add user authentication with JWT tokens',
        branch: 'main',
        changedFiles: [
          { filePath: 'src/auth/jwt.ts', additions: 35, deletions: 2 },
          { filePath: 'src/auth/service.ts', additions: 15, deletions: 1 },
        ],
      };

      const { text, hashtags } = composerService.composeFromCommit(mockCommit, 'technical');
      assert.ok(text.includes('add user authentication with JWT tokens'));
      assert.ok(text.includes('2 archivo(s) clave'));
      assert.ok(hashtags.length > 0);
    });

    it('debe generar post compuesto a partir de múltiples commits, archivos y contexto', () => {
      const commit1: CommitContext = {
        hash: '1111111111',
        shortHash: '1111111',
        author: 'Joset',
        date: '2026-10-28',
        message: 'feat: add user schema in prisma',
        branch: 'main',
        changedFiles: [{ filePath: 'prisma/schema.prisma', additions: 20, deletions: 0 }],
      };
      const commit2: CommitContext = {
        hash: '2222222222',
        shortHash: '2222222',
        author: 'Joset',
        date: '2026-10-28',
        message: 'feat: implement users service',
        branch: 'main',
        changedFiles: [{ filePath: 'src/services/users.service.ts', additions: 45, deletions: 2 }],
      };

      const { text, hashtags } = composerService.composeFromMultiCommits(
        [commit1, commit2],
        ['src/services/users.service.ts'],
        'Optimización del flujo de usuarios con arquitectura modular',
        'technical'
      );

      assert.ok(text.includes('Optimización del flujo de usuarios'));
      assert.ok(text.includes('1111111'));
      assert.ok(text.includes('2222222'));
      assert.ok(text.includes('users.service.ts'));
      assert.ok(hashtags.length > 0);
    });

    it('debe incorporar contexto personalizado del usuario en la selección de código', () => {
      const mockSelection: CodeSelectionContext = {
        text: 'export class AuthService {}',
        fileName: 'auth.service.ts',
        relativePath: 'src/auth.service.ts',
        fullPath: '/path/auth.service.ts',
        languageId: 'typescript',
        languageBadge: 'TS',
        startLine: 1,
        endLine: 10,
        lineCount: 10,
      };

      const { text } = composerService.composeFromSelection(
        mockSelection,
        'technical',
        undefined,
        'Refactorización con decoradores y validación estricta'
      );

      assert.ok(text.includes('Refactorización con decoradores'));
      assert.ok(text.includes('auth.service.ts'));
    });

    it('debe sugerir hashtags pertinentes detectando palabras clave y frameworks', () => {
      const tags = composerService.suggestHashtags(
        'typescript',
        'prisma.service.ts',
        'import { NestModule } from "@nestjs/common";'
      );
      assert.ok(tags.includes('#TypeScript'));
      assert.ok(tags.includes('#NestJS'));
      assert.ok(tags.includes('#Prisma'));
      assert.ok(tags.includes('#CleanCode'));
    });
  });

  describe('SettingsService', () => {
    it('debe inicializarse con opciones por defecto válidas', () => {
      const settingsService = new SettingsService();
      const options = settingsService.getOptions();
      assert.strictEqual(typeof options.includeFile, 'boolean');
      assert.strictEqual(typeof options.showLineNumbers, 'boolean');
      assert.strictEqual(typeof options.useCodeFormat, 'boolean');
      assert.ok(options.messageTemplate.length > 0);
    });
  });

  describe('LinkedInClient & API Versioning', () => {
    it('debe generar dinámicamente versiones activas de LinkedIn en formato YYYYMM', () => {
      const versions = LinkedInClient.getCandidateVersions();
      assert.ok(Array.isArray(versions));
      assert.ok(versions.length >= 6);

      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      assert.ok(
        versions.includes(currentYearMonth),
        `Debe incluir el mes actual ${currentYearMonth}`
      );

      for (const v of versions) {
        assert.match(v, /^\d{6}$/, `La versión ${v} debe tener formato de 6 dígitos YYYYMM`);
      }
    });
  });

  describe('OAuthServer & LinkedInAuthService', () => {
    it('debe generar el redirect URI y state válidos para OAuth de LinkedIn', () => {
      const server = new OAuthServer(54321);
      assert.strictEqual(server.getRedirectUri(), 'http://127.0.0.1:54321/callback');

      const state1 = server.generateState();
      const state2 = server.generateState();
      assert.ok(state1 && state1.length >= 16);
      assert.notStrictEqual(state1, state2);
    });

    it('debe almacenar y recuperar credenciales en SecretStorage de forma segura', async () => {
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

      const authService = new LinkedInAuthService(mockContext);
      await authService.saveAccessToken('oauth-token-test-xyz');
      await authService.saveAuthorUrn('urn:li:person:99999');
      await authService.saveAuthorName('Joset Manihuari');

      assert.strictEqual(await authService.getAccessToken(), 'oauth-token-test-xyz');
      assert.strictEqual(await authService.getAuthorUrn(), 'urn:li:person:99999');
      assert.strictEqual(await authService.getAuthorName(), 'Joset Manihuari');

      await authService.clearCredentials();
      assert.strictEqual(await authService.getAccessToken(), undefined);
      assert.strictEqual(await authService.getAuthorUrn(), undefined);
    });
  });
});
