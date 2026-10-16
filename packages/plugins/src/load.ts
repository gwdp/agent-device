import { AppError } from '@agent-device/kernel/errors';
import type { PluginConnectionCallbacks } from './connection.ts';
import type { PluginCandidate, PluginRegistryPolicy, ProviderRegistry } from './registry.ts';
import { primedPluginConnection } from './connection.ts';

/**
 * The daemon's provider registry: built-in providers, then the plugin store, then the embedder's
 * plugins. A plugin that fails is listed in the inventory and the rest still register.
 */
export async function startDaemonProviderRegistry(options: {
  env: NodeJS.ProcessEnv;
  builtin: readonly PluginCandidate[];
  embedder?: readonly PluginCandidate[];
  policy: PluginRegistryPolicy;
}): Promise<ProviderRegistry> {
  const { env, builtin, embedder = [], policy } = options;
  const [{ resolveProviderPlugins, startProviderRegistry }, { storePluginCandidates }] =
    await Promise.all([import('./registry.ts'), import('./store.ts')]);
  const resolved = await resolveProviderPlugins([
    ...builtin,
    ...storePluginCandidates(env),
    ...embedder,
  ]);
  return await startProviderRegistry(resolved, env, policy);
}

/** Runs a store plugin's `connect` callbacks without setting up any runtime. */
export async function withPluginConnection<T>(
  provider: string,
  builtinProviders: readonly string[],
  env: NodeJS.ProcessEnv,
  runConnection: (connection: PluginConnectionCallbacks) => Promise<T>,
): Promise<T> {
  const primed = primedPluginConnection(provider, env);
  if (primed) return await runConnection(primed);
  const [{ claimProviderIds, resolveProviderPlugins }, { storePluginCandidates }] =
    await Promise.all([import('./registry.ts'), import('./store.ts')]);
  const resolved = await resolveProviderPlugins([
    ...claimProviderIds(builtinProviders),
    ...storePluginCandidates(env),
  ]);
  const connection = resolved.connections.get(provider);
  if (!connection) {
    const failed = resolved.inventory().find((entry) => entry.provider === provider);
    throw new AppError(
      'INVALID_ARGS',
      failed?.error
        ? `Plugin ${provider} failed to load: ${failed.error.message}`
        : `Plugin does not register connect: ${provider}`,
      failed?.error?.reason ? { reason: failed.error.reason, provider } : { provider },
    );
  }
  return await runConnection(connection);
}
