/* eslint-disable @typescript-eslint/no-var-requires */
import * as _core from '@actions/core';
import * as _datasources from 'renovate/dist/datasource';
import { run } from '../../../src/commands/docker/builder';
import * as _utils from '../../../src/util';
import * as _docker from '../../../src/utils/docker';
import { getName, mocked } from '../../utils';

jest.mock('renovate/dist/datasource');
jest.mock('../../../src/util');
jest.mock('../../../src/utils/docker');
jest.mock('../../../src/utils/docker/buildx', () => ({
  init: () => Promise.resolve(),
}));
jest.mock('../../../src/utils/datasource');

const core = mocked(_core);
const utils = mocked(_utils);
const docker = mocked(_docker);
const datasources = mocked(_datasources);
const version = '1.22.4';

describe(getName(__filename), () => {
  let args: Record<string, string | string[]> = {};
  beforeEach(() => {
    jest.resetAllMocks();
    core.getInput.mockReturnValueOnce('builder.json');
    core.getInput.mockReturnValueOnce('yarn');
    utils.readJson.mockResolvedValueOnce(require('./__fixtures__/yarn.json'));
    args = {};
    utils.getArg.mockImplementation((n, o) => args[n] ?? (o?.multi ? [] : ''));
  });

  it('works yarn', async () => {
    utils.readFile.mockResolvedValue(
      `# renovate: datasource=npm depName=yarn versioning=npm\nARG YARN_VERSION=${version}\n`
    );
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version }, { version: '2.0.0-rc.24' }],
    });

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('works pnpm', async () => {
    utils.readJson.mockReset();
    utils.readJson.mockResolvedValueOnce(require('./__fixtures__/pnpm.json'));
    args = {
      ...args,
      'image-prefix': 'ghcr.io/renovatebot/',
      'build-args': ['IMAGE=slim'],
      'tag-suffix': 'slim',
    };
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version: '4.0.0-rc.24' }, { version: '5.0.0' }],
    });

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('works gradle', async () => {
    utils.readJson.mockReset();
    utils.readJson.mockResolvedValueOnce(require('./__fixtures__/gradle.json'));
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [
        { version: '0.7' },
        { version: '2.3' },
        { version: '3.0' },
        { version: '3.5.4' },
        { version: '3.5.5' },
        { version: '4.5' },
        { version: '6.0' },
      ],
    });

    await run();

    expect(docker.build.mock.calls).toHaveLength(3);
    expect(docker.build.mock.calls.map(([args]) => args.tag)).toEqual([
      '3.5.5',
      '4.5',
      '6.0',
    ]);
    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('works dummy', async () => {
    jest.resetAllMocks();
    utils.readJson.mockResolvedValueOnce(require('./__fixtures__/dummy.json'));

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('works ubuntu', async () => {
    jest.resetAllMocks();
    utils.readJson.mockResolvedValueOnce(require('./__fixtures__/ubuntu.json'));

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('last-only dummy', async () => {
    utils.readJson.mockReset();
    utils.readJson.mockResolvedValueOnce(require('./__fixtures__/dummy.json'));
    core.getInput.mockReset();
    core.getInput.mockReturnValueOnce('builder.json');
    core.getInput.mockReturnValueOnce('true');

    args = {
      ...args,
      'build-args': ['IMAGE=slim'],
      'tag-suffix': 'slim',
      'major-minor': 'false',
      prune: 'true',
    };

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('build-only yarn', async () => {
    core.getInput.mockReturnValueOnce('true');
    core.getInput.mockReturnValueOnce('true');
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version }, { version: '2.0.0-rc.24' }],
    });

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('updates image yarn (dry-run)', async () => {
    utils.isDryRun.mockReturnValueOnce(true);
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version: '1.5.0' }, { version }],
    });

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('no releases', async () => {
    datasources.getPkgReleases.mockResolvedValueOnce(null);
    await run();

    expect(docker.build).not.toHaveBeenCalled();
    expect(core.setFailed).toHaveBeenCalledWith('No versions found.');
  });

  it('empty releases', async () => {
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [],
    });

    await run();

    expect(docker.build).not.toHaveBeenCalled();
    expect(core.setFailed).toHaveBeenCalledWith('No versions found.');
  });

  it('unstable releases', async () => {
    utils.readJson.mockReset();
    utils.readJson.mockResolvedValueOnce({
      ...require('./__fixtures__/pnpm.json'),
      ignoredVersions: ['3.5.4'],
    });
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version: '3.5.4' }],
    });

    await run();
    expect(docker.build.mock.calls).toEqual([]);
  });

  it('catch error', async () => {
    expect.assertions(1);
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version }],
    });

    docker.build.mockRejectedValueOnce(new Error('failure'));
    try {
      await run();
    } catch (e) {
      expect((e as Error).message).toEqual('failed');
    }
  });

  it('throws missing-image', async () => {
    expect.assertions(1);
    jest.resetAllMocks();
    utils.readJson.mockResolvedValueOnce({});
    core.getInput.mockReturnValueOnce('');
    core.getInput.mockImplementationOnce(() => {
      throw new Error('missing-image');
    });
    try {
      await run();
    } catch (e) {
      expect((e as Error).message).toEqual('missing-image');
    }
  });
  it('throws missing-config', async () => {
    expect.assertions(1);
    jest.resetAllMocks();
    utils.readJson.mockResolvedValueOnce(undefined);

    try {
      await run();
    } catch (e) {
      expect((e as Error).message).toEqual('missing-config');
    }
  });

  it('multiplatform build-only', async () => {
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version }, { version: '2.0.0-rc.24' }],
    });

    args = {
      ...args,
      platforms: ['linux/amd64', 'linux/arm64'],
    };

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });
});
