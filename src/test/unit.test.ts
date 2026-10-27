import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { GitService } from '../git/gitService';

describe('2share Unit Tests - REQ-001: Git Commit Extraction', () => {
  describe('GitService', () => {
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
});
