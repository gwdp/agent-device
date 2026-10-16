import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@agent-device/kernel/errors';
import { isRecord } from '@agent-device/kernel/record';
import type { ConnectionProviderCapabilities } from '@agent-device/contracts/remote';

const V1_PLUGIN_API_VERSION = 1;

/** A v1 plugin package: the manifest declares what the host reads before any plugin code runs. */
export type PluginManifest = {
  name: string;
  version: string;
  agentDevicePlugin: {
    apiVersion: number;
    provider: string;
    entry: string;
    connection?: ConnectionProviderCapabilities;
    credentialVariables?: string[];
  };
};

const ENVIRONMENT_VARIABLE = /^[A-Z_][A-Z0-9_]*$/;

function invalidManifest(message: string): AppError {
  return new AppError('INVALID_ARGS', message, { reason: 'invalid_plugin' });
}

export function assertLocalConnectionCapabilities(
  policy: ConnectionProviderCapabilities | undefined,
): void {
  if (policy === undefined) return;
  if (
    !policy ||
    typeof policy !== 'object' ||
    policy.leaseKind !== 'direct-device-provider' ||
    [
      'requiresAppAttachment',
      'requiresRemoteDaemon',
      'supportsArtifacts',
      'supportsDeferredAppSelection',
      'supportsDirectPortReverse',
      'usesCloudWebDriverLease',
    ].some((key) => typeof policy[key as keyof ConnectionProviderCapabilities] !== 'boolean') ||
    policy.requiresRemoteDaemon
  ) {
    throw invalidManifest('Plugin connection must declare local provider capabilities');
  }
}

export function assertCredentialVariables(variables: unknown): void {
  if (
    variables !== undefined &&
    (!Array.isArray(variables) ||
      !variables.every((name) => typeof name === 'string' && ENVIRONMENT_VARIABLE.test(name)))
  ) {
    throw invalidManifest('Plugin credential variables must list environment variable names');
  }
}

export function readPluginManifest(directory: string): PluginManifest {
  let manifest: PluginManifest;
  try {
    const file = path.join(directory, 'package.json');
    manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as PluginManifest;
  } catch (error) {
    throw new AppError(
      'INVALID_ARGS',
      `Cannot read plugin manifest: ${directory}`,
      {},
      error as Error,
    );
  }
  const declaration = manifest?.agentDevicePlugin;
  if (
    typeof manifest?.name !== 'string' ||
    typeof manifest?.version !== 'string' ||
    !declaration ||
    declaration.apiVersion !== V1_PLUGIN_API_VERSION ||
    typeof declaration.provider !== 'string' ||
    !/^[a-z][a-z0-9-]*$/.test(declaration.provider) ||
    typeof declaration.entry !== 'string' ||
    !declaration.entry.startsWith('./')
  ) {
    throw new AppError('INVALID_ARGS', 'Package does not declare a compatible provider plugin', {
      reason: 'incompatible_plugin',
      apiVersion: V1_PLUGIN_API_VERSION,
      hint: `Install a plugin release supporting agentDevicePlugin.apiVersion ${V1_PLUGIN_API_VERSION}.`,
    });
  }
  resolvePluginEntry(directory, declaration.entry);
  assertLocalConnectionCapabilities(declaration.connection);
  assertCredentialVariables(declaration.credentialVariables);
  return manifest as PluginManifest;
}

export function resolvePluginEntry(directory: string, entry: string): string {
  return containedFile(directory, entry);
}

const PROVIDER_ID = /^[a-z][a-z0-9-]*$/;

/** Provider ids that name daemon routing, not a runtime a plugin can supply. */
export const ROUTING_PROVIDER_IDENTITIES: readonly string[] = ['cloud', 'proxy'];

export function isProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_ID.test(value);
}

/** The subpath a v2 plugin package exports; its default export is the plugin factory. */
const PLUGIN_ENTRY_SUBPATH = './agent-device';

const IMPORT_CONDITIONS: readonly string[] = ['node', 'import', 'default'];

export type PluginPackageEntry =
  | Readonly<{ kind: 'v2'; file: string }>
  | Readonly<{ kind: 'v1'; manifest: PluginManifest }>;

/**
 * Chooses how an installed package loads, without evaluating it. The `./agent-device` export wins;
 * a package that lacks that subpath and declares `agentDevicePlugin` is a v1 plugin dispatched by
 * its manifest; any other package falls back to its root export. A subpath that exists but does
 * not resolve is an error, never a reason to fall back.
 */
export function discoverPluginEntry(directory: string): PluginPackageEntry {
  const manifest = readPackageJson(directory);
  const subpath = resolveExport(manifest.exports, PLUGIN_ENTRY_SUBPATH);
  if (subpath.status === 'resolved') {
    return { kind: 'v2', file: containedFile(directory, subpath.target) };
  }
  if (subpath.status === 'unresolvable') throw unresolvableEntry(directory, PLUGIN_ENTRY_SUBPATH);
  if (manifest.agentDevicePlugin !== undefined) {
    return { kind: 'v1', manifest: readPluginManifest(directory) };
  }
  const root = resolveExport(manifest.exports, '.');
  const target =
    root.status === 'resolved'
      ? root.target
      : (manifest.exports === undefined || manifest.exports === null) &&
          typeof manifest.main === 'string'
        ? `./${path.posix.normalize(manifest.main)}`
        : undefined;
  if (target === undefined) throw missingEntry(directory, PLUGIN_ENTRY_SUBPATH);
  return { kind: 'v2', file: containedFile(directory, target) };
}

export function readPackageJson(directory: string): Record<string, unknown> {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (isRecord(manifest)) return manifest;
  } catch (error) {
    throw new AppError(
      'INVALID_ARGS',
      `Cannot read plugin manifest: ${directory}`,
      { reason: 'plugin_load_failed' },
      error as Error,
    );
  }
  throw new AppError('INVALID_ARGS', `Cannot read plugin manifest: ${directory}`, {
    reason: 'plugin_load_failed',
  });
}

type ExportResolution =
  | Readonly<{ status: 'resolved'; target: string }>
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'unresolvable' }>;

function resolveExport(exportsField: unknown, subpath: string): ExportResolution {
  if (exportsField === undefined || exportsField === null) return { status: 'absent' };
  const subpaths = isSubpathMap(exportsField);
  // Without subpath keys the field is the package root's target.
  if (!subpaths) return subpath === '.' ? resolveTarget(exportsField) : { status: 'absent' };
  return Object.hasOwn(exportsField, subpath)
    ? resolveTarget(exportsField[subpath])
    : { status: 'absent' };
}

function isSubpathMap(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).some((key) => key.startsWith('.'));
}

function resolveTarget(target: unknown): ExportResolution {
  if (typeof target === 'string') return { status: 'resolved', target };
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item);
      if (resolved.status === 'resolved') return resolved;
    }
    return { status: 'unresolvable' };
  }
  if (!isRecord(target)) return { status: 'unresolvable' };
  for (const [condition, value] of Object.entries(target)) {
    if (!IMPORT_CONDITIONS.includes(condition)) continue;
    const resolved = resolveTarget(value);
    if (resolved.status === 'resolved') return resolved;
  }
  return { status: 'unresolvable' };
}

function containedFile(directory: string, target: string): string {
  try {
    const root = fs.realpathSync(directory);
    const resolved = fs.realpathSync(path.resolve(directory, target));
    if (
      target.startsWith('./') &&
      resolved.startsWith(`${root}${path.sep}`) &&
      fs.statSync(resolved).isFile()
    ) {
      return resolved;
    }
  } catch {}
  throw new AppError('INVALID_ARGS', 'Plugin entry must be a readable file inside its package', {
    reason: 'plugin_load_failed',
    directory,
    entry: target,
  });
}

function unresolvableEntry(directory: string, subpath: string): AppError {
  return new AppError('INVALID_ARGS', `Package exports ${subpath} without an import target`, {
    reason: 'incompatible_plugin',
    directory,
    hint: `Ask the plugin author for a release whose ${subpath} export has an import condition.`,
  });
}

function missingEntry(directory: string, subpath: string): AppError {
  return new AppError('INVALID_ARGS', 'Package does not export a provider plugin', {
    reason: 'incompatible_plugin',
    directory,
    hint: `Install a plugin release that exports ${subpath}.`,
  });
}
