import { resolveHubAppReference as resolveHubAppReferenceFrom } from './webdriver-utils.ts';
import type { CloudWebDriverRuntimeOptions, CloudWebDriverRuntime } from './runtime.ts';

export async function createCloudWebDriverRuntime(
  options: CloudWebDriverRuntimeOptions,
): Promise<CloudWebDriverRuntime> {
  const runtime = await import('./runtime.ts');
  return runtime.createCloudWebDriverRuntime(options);
}
export type {
  CloudWebDriverRuntimeOptions,
  CloudWebDriverPlatform,
  CloudWebDriverUploadApp,
} from './runtime.ts';
export type { CloudWebDriverProviderOptions } from './provider-plugin.ts';
export {
  appFileUploadForm,
  appendUrlPath,
  createHubUploadApp,
  fetchProviderSessionDetails,
  fetchProviderVerificationJson,
  postHubAppUpload,
  readFlag,
  requireConnectFlag,
  requireConnectPlatform,
  requireEnv,
  requireFlag,
  requireProviderDeviceOrientation,
  requireRequest,
  requireRequestPlatform,
  resolveLocalAppArtifact,
} from './webdriver-utils.ts';
export { cloudArtifactsReadyOrPending, urlArtifactFromDetails } from './artifact-results.ts';
export { buildCloudWebDriverBaseCapabilities } from './capabilities.ts';

/** The released entry: an app path without `cwd` resolves against the process's working directory. */
export async function resolveHubAppReference(
  options: Omit<Parameters<typeof resolveHubAppReferenceFrom>[0], 'cwd'> & { cwd?: string },
): Promise<string> {
  return await resolveHubAppReferenceFrom({ ...options, cwd: options.cwd ?? process.cwd() });
}
