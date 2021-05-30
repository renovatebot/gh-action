import { getInput, setFailed } from '@actions/core';
import is from '@sindresorhus/is';
import * as chalk from 'chalk';
import { ReleaseResult, getPkgReleases } from 'renovate/dist/datasource';
import { get as getVersioning } from 'renovate/dist/versioning';
import { exec, getArg, isDryRun, readJson } from '../../util';
import { readDockerConfig } from '../../utils/config';
import { build, publish } from '../../utils/docker';
import { init } from '../../utils/docker/buildx';
import {
  docker,
  dockerDf,
  dockerPrune,
  dockerTag,
} from '../../utils/docker/common';
import log from '../../utils/logger';
import * as renovate from '../../utils/renovate';
import { Config, ConfigFile } from '../../utils/types';

renovate.register();

export const MultiArgsSplitRe = /\s*(?:[;,]|$)\s*/;

let latestStable: string | undefined;

function getVersions(versions: string[]): ReleaseResult {
  return {
    releases: versions.map((version) => ({
      version,
    })),
  };
}

async function getBuildList({
  datasource,
  depName,
  versioning,
  startVersion,
  ignoredVersions,
  lastOnly,
  forceUnstable,
  versions,
  latestVersion,
  maxVersions,
  extractVersion,
}: Config): Promise<string[]> {
  log('Looking up versions');
  const ver = getVersioning(versioning as never);
  const pkgResult = versions
    ? getVersions(versions)
    : await getPkgReleases({
        datasource,
        depName,
        versioning,
        extractVersion,
      });
  if (!pkgResult) {
    return [];
  }
  let allVersions = pkgResult.releases
    .map((v) => v.version)
    .filter((v) => ver.isVersion(v) && ver.isCompatible(v, startVersion));
  log(`Found ${allVersions.length} total versions`);
  if (!allVersions.length) {
    return [];
  }
  allVersions = allVersions
    .filter((v) => v === startVersion || ver.isGreaterThan(v, startVersion))
    .filter((v) => !ignoredVersions.includes(v));

  if (!forceUnstable) {
    log('Filter unstable versions');
    allVersions = allVersions.filter((v) => ver.isStable(v));
  }

  log(`Found ${allVersions.length} versions within our range`);
  log(`Candidates:`, allVersions.join(', '));

  latestStable =
    latestVersion ||
    /* istanbul ignore next: not testable ts */
    pkgResult.tags?.latest ||
    allVersions.filter((v) => ver.isStable(v)).pop();
  log('Latest stable version is', latestStable);

  if (latestStable && !allVersions.includes(latestStable)) {
    log.warn(
      `LatestStable '${latestStable}' not buildable, candidates:`,
      allVersions.join(', ')
    );
  }

  const lastVersion = allVersions[allVersions.length - 1];
  log('Most recent version is', lastVersion);

  if (is.number(maxVersions) && maxVersions > 0) {
    log(`Building last ${maxVersions} version only`);
    allVersions = allVersions.slice(-maxVersions);
  }

  if (lastOnly) {
    log('Building last version only');
    allVersions = [latestStable && !forceUnstable ? latestStable : lastVersion];
  }

  if (allVersions.length) {
    log('Build list:', allVersions.join(', '));
  } else {
    log('Nothing to build');
  }
  return allVersions;
}

function createTag(tagSuffix: string | undefined, version: string): string {
  return is.nonEmptyString(tagSuffix) && tagSuffix !== 'latest'
    ? `${version}-${tagSuffix}`
    : version;
}

async function buildAndPush(
  {
    imagePrefix,
    image,
    buildArg,
    buildArgs,
    buildOnly,
    cache,
    dryRun,
    tagSuffix,
    versioning,
    majorMinor,
    prune,
    platforms,
  }: Config,
  versions: string[]
): Promise<void> {
  const builds: string[] = [];
  const failed: string[] = [];
  const ver = getVersioning(versioning || 'semver');
  const versionsMap = new Map<string, string>();
  if (majorMinor) {
    for (const version of versions) {
      const minor = ver.getMinor(version);
      const major = ver.getMajor(version);
      const isStable = ver.isStable(version);

      if (isStable && is.number(major) && `${major}` !== version) {
        versionsMap.set(`${major}`, version);
      }

      if (
        isStable &&
        is.number(major) &&
        is.number(minor) &&
        `${major}.${minor}` !== version
      ) {
        versionsMap.set(`${major}.${minor}`, version);
      }
    }
  }

  await exec('df', ['-h']);

  for (const version of versions) {
    const tag = createTag(tagSuffix, version);
    const imageVersion = `${imagePrefix}/${image}:${tag}`;
    log(`Building ${imageVersion}`);
    try {
      const minor = ver.getMinor(version);
      const major = ver.getMajor(version);
      const cacheTags: string[] = [tagSuffix ?? 'latest'];
      const tags: string[] = [];

      if (
        is.number(major) &&
        majorMinor &&
        versionsMap.get(`${major}`) === version
      ) {
        const nTag = createTag(tagSuffix, `${major}`);
        cacheTags.push(nTag);
        tags.push(nTag);
      }

      if (
        is.number(major) &&
        is.number(minor) &&
        majorMinor &&
        versionsMap.get(`${major}.${minor}`) === version
      ) {
        const nTag = createTag(tagSuffix, `${major}.${minor}`);
        cacheTags.push(nTag);
        tags.push(nTag);
      }

      if (version === latestStable) {
        tags.push(tagSuffix ?? 'latest');
      }

      await build({
        image,
        imagePrefix,
        tag,
        cache,
        cacheTags,
        buildArgs: [...(buildArgs ?? []), `${buildArg}=${version}`],
        dryRun,
        platforms,
      });

      const MultiPlatform: boolean =
        !is.nullOrUndefined(platforms) && platforms.length > 1;

      if (!buildOnly) {
        if (MultiPlatform) {
          const source = tag;
          for (const tag of tags) {
            log(`Publish ${source} as ${tag}`);
            await docker(
              'buildx',
              'imagetools',
              'create',
              '-t',
              `${imagePrefix}/${image}:${tag}`,
              `${imagePrefix}/${image}:${source}`
            );
          }
        } else {
          await publish({ image, imagePrefix, tag, dryRun });
          const source = tag;

          for (const tag of tags) {
            log(`Publish ${source} as ${tag}`);
            await dockerTag({ image, imagePrefix, src: source, tgt: tag });
            await publish({ image, imagePrefix, tag, dryRun });
          }
        }
      }

      log(`Build ${imageVersion}`);
      builds.push(version);
    } catch (err) {
      log.error(err);
      failed.push(version);
    }

    await dockerDf();
    await exec('df', ['-h']);

    if (prune) {
      await dockerPrune();
      await exec('df', ['-h']);
    }
  }

  if (builds.length) {
    log('Build list:' + builds.join(' '));
  }

  if (failed.length) {
    log.warn('Failed list:' + failed.join(' '));
    throw new Error('failed');
  }
}

async function generateImages(config: Config): Promise<void> {
  const buildList = await getBuildList(config);

  if (buildList.length === 0) {
    setFailed(`No versions found.`);
    return;
  }

  await buildAndPush(config, buildList);
}

export async function run(): Promise<void> {
  const dryRun = isDryRun();
  const configFile = getInput('config') || 'builder.json';

  const cfg = await readJson<ConfigFile>(configFile);

  if (!is.object(cfg)) {
    throw new Error('missing-config');
  }

  // TODO: validation
  if (!is.string(cfg.image)) {
    cfg.image = getInput('image', { required: true });
  }

  if (!is.string(cfg.buildArg)) {
    cfg.buildArg = cfg.image.toUpperCase() + '_VERSION';
  }

  await readDockerConfig(cfg);

  const config: Config = {
    ...cfg,
    imagePrefix: getArg('image-prefix')?.replace(/\/$/, '') || 'renovate',
    image: cfg.image,
    depName: cfg.depName ?? cfg.image,
    buildArg: cfg.buildArg,
    buildArgs: getArg('build-args', { multi: true }),
    tagSuffix: getArg('tag-suffix') || undefined,
    ignoredVersions: cfg.ignoredVersions ?? [],
    dryRun,
    lastOnly: getInput('last-only') == 'true',
    buildOnly: getInput('build-only') == 'true',
    majorMinor: getArg('major-minor') !== 'false',
    prune: getArg('prune') === 'true',
    platforms: getArg('platforms', { multi: true }),
  };

  if (dryRun) {
    log('GitHub Actions branch detected - Force building latest, no push');
    config.lastOnly = true;
  }
  log('config:', JSON.stringify(config));

  await init();

  await generateImages(config);

  log.info(chalk.blue('Processing done:', config.image));
}
