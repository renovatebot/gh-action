import { getName, mocked } from './utils';
import * as _core from '@actions/core';
import * as _exec from '@actions/exec';
import * as util from '../src/util';
import { existsSync } from 'fs';

jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('../src/utils/logger');

const core = mocked(_core);
const exec = mocked(_exec);

describe(getName(__filename), () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exec', () => {
    it('works', async () => {
      exec.exec.mockImplementationOnce((_cmd, _args, opts) => {
        opts?.listeners?.stdout && opts.listeners.stdout(Buffer.from('test'));
        opts?.listeners?.stderr &&
          opts.listeners.stderr(Buffer.from('testerr'));
        return Promise.resolve(0);
      });
      expect(await util.exec('dummy-cmd', [])).toEqual({
        code: 0,
        stdout: 'test',
        stderr: 'testerr',
      });
    });

    it('throws', async () => {
      expect.assertions(1);
      exec.exec.mockResolvedValueOnce(1);
      await expect(util.exec('dummy-cmd', [])).rejects.toThrow();
    });
  });

  describe('isDryRun', () => {
    afterEach(() => {
      delete process.env.CI;
    });
    it('false', () => {
      process.env.CI = 'true';
      core.getInput.mockReturnValueOnce('false');
      expect(util.isDryRun()).toBe(false);
      expect(util.isDryRun()).toBe(false);
      expect(core.getInput).toBeCalledTimes(2);
    });
    it('true', () => {
      core.getInput.mockReturnValueOnce('true');
      expect(util.isDryRun()).toBe(true);
      expect(core.getInput).toBeCalledTimes(1);
    });
  });

  describe('getEnv', () => {
    it('works', () => {
      expect(util.getEnv('NOT_FOUND_ENV_VAR')).toBe('');
      expect(util.getEnv('PATH')).toBeDefined();
    });
  });

  describe('getWorkspace', () => {
    afterEach(() => {
      delete process.env.GITHUB_WORKSPACE;
    });
    it('works', () => {
      expect(util.getWorkspace()).toBe(process.cwd());
      process.env.GITHUB_WORKSPACE = '/var/test';
      expect(util.getWorkspace()).toBe('/var/test');
    });
  });

  describe('readJson', () => {
    afterEach(() => {
      delete process.env.GITHUB_WORKSPACE;
    });
    it('works', async () => {
      process.env.GITHUB_WORKSPACE = process.cwd();
      expect(await util.readJson('.prettierrc.json')).toEqual({
        singleQuote: true,
        trailingComma: 'es5',
      });
    });
  });

  describe('readFile', () => {
    afterEach(() => {
      delete process.env.GITHUB_WORKSPACE;
    });
    it('works', async () => {
      process.env.GITHUB_WORKSPACE = process.cwd();
      expect(await util.readFile('Dockerfile')).toMatchSnapshot();
    });
  });

  describe('getArg', () => {
    it('single', async () => {
      core.getInput.mockReturnValueOnce('test;latest;slim');
      expect(util.getArg('dockerfile')).toBe('test;latest;slim');
    });

    it('multi', async () => {
      core.getInput.mockReturnValueOnce('test;latest;slim');
      expect(util.getArg('dockerfile', { multi: true })).toEqual([
        'test',
        'latest',
        'slim',
      ]);
    });

    it('multi (null)', async () => {
      expect(util.getArg('dockerfile', { multi: true })).toEqual([]);
    });
  });

  describe('resolveFile', () => {
    it('works', async () => {
      const file = await util.resolveFile('bin/configure-docker.sh');
      expect(file).toBeDefined();
      expect(existsSync(file)).toBe(true);

      const file2 = await util.resolveFile('bin/dummy.sh');
      expect(file2).toBeDefined();
      expect(existsSync(file2)).toBe(false);
    });
  });
});
