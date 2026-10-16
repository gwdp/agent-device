import type { ProviderDeviceRuntime } from '@agent-device/contracts/device';
import type { PluginInventoryEntry } from '@agent-device/contracts/plugin-inventory';
import type { PlatformRuntimeProviderRegistration } from './platform-runtime-gateway.ts';
import { builtinProviderCandidates } from './builtin-provider-plugins.ts';
import { PROVIDER_PLUGIN_POLICY } from './provider-plugin-policy.ts';

export type DefaultProviderDeviceRuntimeEnv = NodeJS.ProcessEnv;

export type ProviderRuntimeComposition = Readonly<{
  runtimes: readonly ProviderDeviceRuntime[];
  platformModules: readonly PlatformRuntimeProviderRegistration[];
  /** Every plugin the registry saw, built-in or not, active or failed. */
  inventory: readonly PluginInventoryEntry[];
  /** Every provider id a plugin claimed, including failed plugins and unconfigured built-ins. */
  claimedProviders: readonly string[];
  /** Shuts down every registered runtime, then its plugin's cleanup. */
  shutdown(): Promise<void>;
}>;

/**
 * The daemon's providers from one registry: built-in providers, then the plugin store. A plugin
 * that cannot register is listed in the inventory; the others still register.
 */
export async function createDaemonProviderRuntimeComposition(
  env: DefaultProviderDeviceRuntimeEnv = process.env,
): Promise<ProviderRuntimeComposition> {
  const { startDaemonProviderRegistry } = await import('@agent-device/plugins/load');
  const registry = await startDaemonProviderRegistry({
    env,
    builtin: builtinProviderCandidates(env),
    policy: PROVIDER_PLUGIN_POLICY,
  });
  return Object.freeze({
    runtimes: Object.freeze(registry.registrations.map(({ runtime }) => runtime)),
    platformModules: Object.freeze(
      registry.registrations.map(({ runtime, platformModule }) => ({
        runtime,
        module: platformModule,
      })),
    ),
    inventory: registry.inventory,
    claimedProviders: registry.claimedProviders,
    shutdown: registry.close,
  });
}
