/* eslint-disable @typescript-eslint/no-var-requires */
import * as _core from '@actions/core';
import * as _datasources from 'renovate/dist/datasource';
import { run } from '../../../src/commands/docker/builder';
import * as _utils from '../../../src/util';
import * as _cli from '../../../src/utils/cli';
import * as _docker from '../../../src/utils/docker';
import * as _fs from '../../../src/utils/fs';
import { getName, mocked } from '../../utils';

jest.mock('renovate/dist/datasource');
jest.mock('../../../src/util');
jest.mock('../../../src/utils/docker');
jest.mock('../../../src/utils/docker/buildx', () => ({
  init: () => Promise.resolve(),
}));
jest.mock('../../../src/utils/renovate');

const core = mocked(_core);
const utils = mocked(_utils);
const docker = mocked(_docker);
const fs = mocked(_fs);
const cli = mocked(_cli);
const datasources = mocked(_datasources);
const version = '1.22.4';

describe(getName(__filename), () => {
  beforeEach(() => {
    jest.resetAllMocks();
    core.getInput.mockReturnValueOnce('builder.json');
    core.getInput.mockReturnValueOnce('yarn');
    fs.readJson.mockResolvedValueOnce(require('./__fixtures__/yarn.json'));
    cli.getArg.mockImplementation((_, o) => (o?.multi ? [] : ''));
  });

  it('works yarn', async () => {
    fs.readFile.mockResolvedValue(
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
    fs.readJson.mockReset();
    fs.readJson.mockResolvedValueOnce(require('./__fixtures__/pnpm.json'));
    cli.getArg.mockReturnValueOnce(['IMAGE=slim']);
    cli.getArg.mockReturnValueOnce('slim');
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [{ version: '4.0.0-rc.24' }, { version: '5.0.0' }],
    });

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('works gradle', async () => {
    fs.readJson.mockReset();
    fs.readJson.mockResolvedValueOnce(require('./__fixtures__/gradle.json'));
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [
        { version: '0.7' },
        { version: '2.3' },
        { version: '3.0' },
        { version: '3.5.4' },
        { version: '6.0' },
      ],
    });

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('works dummy', async () => {
    jest.resetAllMocks();
    fs.readJson.mockResolvedValueOnce(require('./__fixtures__/dummy.json'));

    await run();

    expect(docker.build.mock.calls).toMatchSnapshot('build');
    expect(docker.publish.mock.calls).toMatchSnapshot('publish');
  });

  it('last-only dummy', async () => {
    fs.readJson.mockReset();
    fs.readJson.mockResolvedValueOnce(require('./__fixtures__/dummy.json'));
    core.getInput.mockReset();
    core.getInput.mockReturnValueOnce('builder.json');
    core.getInput.mockReturnValueOnce('true');
    cli.getArg.mockReturnValueOnce(['IMAGE=slim']);
    cli.getArg.mockReturnValueOnce('slim');
    cli.getArg.mockReturnValueOnce('false');
    cli.getArg.mockReturnValueOnce('true');

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

    expect(docker.build.mock.calls).toEqual([]);
  });

  it('empty releases', async () => {
    datasources.getPkgReleases.mockResolvedValueOnce({
      releases: [],
    });

    await run();
    expect(docker.build.mock.calls).toEqual([]);
  });

  it('unstable releases', async () => {
    fs.readJson.mockReset();
    fs.readJson.mockResolvedValueOnce({
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
    fs.readJson.mockResolvedValueOnce({});
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
    fs.readJson.mockResolvedValueOnce(undefined);

    try {
      await run();
    } catch (e) {
      expect((e as Error).message).toEqual('missing-config');
    }
  });
});
