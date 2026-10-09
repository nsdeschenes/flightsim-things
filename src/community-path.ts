import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type Configuration = Readonly<{communityPath: string}>;

const configurationDirectory = path.join(os.homedir(), '.flightsim-things'),
  configurationFile = path.join(configurationDirectory, 'config.json'),
  privateFileMode = 0o600;

const get = async (): Promise<string> => {
  let contents;
  try {
    contents = await fs.readFile(configurationFile, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('No Community directory is saved. Run community-path set <path>.', {
        cause: error,
      });
    }
    throw error;
  }

  let configuration: unknown;
  try {
    configuration = JSON.parse(contents);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(
        `Invalid JSON in ${configurationFile}. Run community-path set <path> to replace it.`,
        {cause: error}
      );
    }
    throw error;
  }

  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    !('communityPath' in configuration) ||
    typeof configuration.communityPath !== 'string' ||
    configuration.communityPath.includes('\0') ||
    !path.isAbsolute(configuration.communityPath)
  ) {
    throw new Error(
      `Invalid Community directory in ${configurationFile}. Run community-path set <path> to replace it.`
    );
  }

  return configuration.communityPath;
};

const set = async (input: string): Promise<string> => {
  if (input === '') {
    throw new Error(
      'The Community directory path is empty. Provide an existing directory.'
    );
  }

  let expandedPath = input;
  if (input === '~') {
    expandedPath = os.homedir();
  } else if (input.startsWith('~/') || input.startsWith(`~${path.sep}`)) {
    expandedPath = path.join(os.homedir(), input.slice('~/'.length));
  }
  const communityPath = path.resolve(expandedPath);

  let directory;
  try {
    directory = await fs.stat(communityPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Community directory does not exist: ${communityPath}`, {
        cause: error,
      });
    }
    throw error;
  }
  if (!directory.isDirectory()) {
    throw new Error(`Community path is not a directory: ${communityPath}`);
  }

  const configuration: Configuration = {communityPath};
  await fs.mkdir(configurationDirectory, {recursive: true});
  const temporaryFile = path.join(
      configurationDirectory,
      `config.${crypto.randomUUID()}.tmp`
    ),
    file = await fs.open(temporaryFile, 'wx', privateFileMode);
  try {
    await file.writeFile(`${JSON.stringify(configuration)}\n`, 'utf8');
    await file.close();
    await fs.rename(temporaryFile, configurationFile);
  } catch (error) {
    await file.close().catch(() => error);
    await fs.rm(temporaryFile, {force: true}).catch(() => error);
    throw error;
  }

  return communityPath;
};

const communityPath = {get, set};

export default communityPath;
