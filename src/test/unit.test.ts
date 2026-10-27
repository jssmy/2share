import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { GitService } from '../git/gitService';
import { AIService } from '../ai/aiService';
import { GitCommitContext } from '../types';

describe('2share Unit Tests - REQ-001 & REQ-002', () => {
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
});
