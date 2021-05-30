export type ExecResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class ExecError extends Error implements ExecResult {
  readonly name = 'ExecError';

  constructor(
    public readonly code: number,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly cmd: string
  ) {
    super(`ExecError: (${code}) ` + stderr.split('\n').slice(-10).join('\n'));
  }
}

export type ConfigFile = {
  datasource: string;
  image: string;
  depName?: string;
  versioning?: string;
  startVersion: string;
  cache?: string;
  buildArg?: string;
  ignoredVersions?: string[];
  forceUnstable?: boolean;
  versions?: string[];
  latestVersion?: string;
  maxVersions?: number;
  extractVersion?: string;
};

export type Config = {
  buildArg: string;
  buildArgs: string[];
  buildOnly: boolean;
  tagSuffix?: string;
  depName: string;
  imagePrefix: string;
  image: string;
  ignoredVersions: string[];
  majorMinor: boolean;
  lastOnly: boolean;
  dryRun: boolean;
  prune: boolean;
  platforms?: string[];
} & ConfigFile;

export type BinaryBuilderConfig = {
  buildArgs: string[];
  depName: string;
  ignoredVersions: string[];
  lastOnly: boolean;
  dryRun: boolean;
} & ConfigFile;
