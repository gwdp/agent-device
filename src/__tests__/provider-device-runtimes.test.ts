import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createDaemonProviderRuntimeComposition } from '../provider-device-runtimes.ts';
import { pluginHome, registrationSource, selectPlugin } from '@agent-device/test-kit';

test('daemon composition registers installed provider runtimes and their lazy platform modules', async () => {
  const { home, env } = pluginHome();
  selectPlugin(home, 'example', 'example', registrationSource('example'));
  const composition = await createDaemonProviderRuntimeComposition(env);
  const plugin = composition.runtimes.find((runtime) => runtime.provider === 'example');
  assert.ok(plugin);
  assert.equal(
    composition.platformModules.find(({ runtime }) => runtime === plugin)?.module.owner.provider,
    'example',
  );
  await Promise.all(composition.runtimes.map((runtime) => runtime.shutdown()));
});

test('built-in providers register ahead of the store and an unconfigured Limrun still claims its id', async () => {
  const { home, env } = pluginHome();
  selectPlugin(home, 'example', 'example', registrationSource('example'));
  const composition = await createDaemonProviderRuntimeComposition(env);

  assert.deepEqual(
    composition.runtimes.map((runtime) => runtime.provider),
    ['browserstack', 'aws-device-farm', 'example'],
  );
  assert.deepEqual(
    composition.inventory.map(({ provider, source, state }) => [provider, source, state]),
    [
      ['browserstack', 'builtin', 'active'],
      ['aws-device-farm', 'builtin', 'active'],
      ['example', 'store', 'active'],
    ],
  );
  assert.ok(composition.claimedProviders.includes('limrun'));
  await Promise.all(composition.runtimes.map((runtime) => runtime.shutdown()));
});

test('daemon composition records Limrun as failed for a partial instance set and still loads every other provider', async () => {
  const { home, env } = pluginHome();
  selectPlugin(home, 'example', 'example', registrationSource('example'));
  const composition = await createDaemonProviderRuntimeComposition({
    ...env,
    LIMRUN_API_KEY: 'lim_test_key',
    LIM_ANDROID_INSTANCE_URL: 'https://region.limrun.example/v1/android_x/api',
    LIM_ANDROID_INSTANCE_TOKEN: 'android-instance-token',
  });

  assert.deepEqual(
    composition.runtimes.map((runtime) => runtime.provider),
    ['browserstack', 'aws-device-farm', 'example'],
  );
  const limrun = composition.inventory.find(({ provider }) => provider === 'limrun');
  assert.equal(limrun?.state, 'failed');
  assert.equal(limrun?.error?.code, 'INVALID_ARGS');
  assert.match(limrun?.error?.message ?? '', /LIM_ANDROID_INSTANCE_ADB_URL/);
  await Promise.all(composition.runtimes.map((runtime) => runtime.shutdown()));
});

test('a plugin claiming a built-in provider ID is recorded as failed and the built-in keeps the ID', async () => {
  for (const provider of ['limrun', 'browserstack', 'aws-device-farm']) {
    const { home, env } = pluginHome();
    selectPlugin(home, 'example', provider, 'throw new Error("must not evaluate");');
    const composition = await createDaemonProviderRuntimeComposition(env);
    const plugin = composition.inventory.find(({ package: name }) => name === 'example');
    assert.equal(plugin?.state, 'failed');
    assert.equal(plugin?.error?.reason, 'duplicate_provider');
    assert.ok(composition.claimedProviders.includes(provider));
    // An unconfigured Limrun claims its id without registering a runtime.
    assert.equal(
      composition.runtimes.filter((runtime) => runtime.provider === provider).length,
      provider === 'limrun' ? 0 : 1,
    );
    await Promise.all(composition.runtimes.map((runtime) => runtime.shutdown()));
  }
});

test('Limrun stays unregistered when only the removed API key alias is configured', async () => {
  const { env } = pluginHome();
  const { runtimes, platformModules, inventory } = await createDaemonProviderRuntimeComposition({
    ...env,
    LIM_API_KEY: 'lim_test_key',
  });

  assert.equal(
    runtimes.some((runtime) => runtime.provider === 'limrun'),
    false,
  );
  assert.equal(
    inventory.some(({ provider }) => provider === 'limrun'),
    false,
  );
  assertPlatformModuleCoverage(runtimes, platformModules);
  await Promise.all(runtimes.map(async (runtime) => await runtime.shutdown()));
});

test('Limrun registers when a Limrun API key is configured', async () => {
  const { env } = pluginHome();
  const { runtimes, platformModules } = await createDaemonProviderRuntimeComposition({
    ...env,
    LIMRUN_API_KEY: 'lim_test_key',
  });

  const limrun = runtimes.find((runtime) => runtime.provider === 'limrun');
  assert.ok(limrun);
  assert.equal('loadRuntime' in limrun, false);
  assertPlatformModuleCoverage(runtimes, platformModules, [limrun]);
  await Promise.all(runtimes.map(async (runtime) => await runtime.shutdown()));
});

test('Limrun registers for an existing instance without an API key', async () => {
  const { env } = pluginHome();
  const { runtimes, platformModules } = await createDaemonProviderRuntimeComposition({
    ...env,
    LIM_IOS_INSTANCE_URL: 'https://region.limrun.example/v1/ios_x/api',
    LIM_IOS_INSTANCE_TOKEN: 'ios-instance-token',
  });

  const limrun = runtimes.find((runtime) => runtime.provider === 'limrun');
  assert.ok(limrun);
  assertPlatformModuleCoverage(runtimes, platformModules, [limrun]);
  await Promise.all(runtimes.map(async (runtime) => await runtime.shutdown()));
});

function assertPlatformModuleCoverage(
  runtimes: readonly object[],
  platformModules: ReadonlyArray<
    Readonly<{ runtime: object; module: { owner: { provider: string } } }>
  >,
  explicitModules: readonly object[] = [],
): void {
  const runtimeModules = runtimes.filter(
    (runtime) => 'owner' in runtime && 'loadRuntime' in runtime,
  );
  assert.deepEqual(
    platformModules.map(({ runtime }) => runtime),
    [...runtimeModules, ...explicitModules],
  );
  for (const { runtime, module } of platformModules) {
    assert.equal('provider' in runtime ? runtime.provider : undefined, module.owner.provider);
  }
}
