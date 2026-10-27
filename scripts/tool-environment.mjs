import path from 'node:path';
export function configureToolEnvironment(projectRoot) {
  const runtimeRoot = process.env.SITES_RUNTIME_ROOT || path.join(projectRoot, '.sites-runtime');
  process.env.XDG_CONFIG_HOME ??= path.join(runtimeRoot,'config');
  for (const [name, value] of Object.entries({
    CLOUDFLARE_CF_FETCH_ENABLED:'false', WRANGLER_SEND_METRICS:'false', WRANGLER_WRITE_LOGS:'false',
    WRANGLER_LOG_PATH:path.join(runtimeRoot,'wrangler/logs'),
    WRANGLER_REGISTRY_PATH:path.join(runtimeRoot,'wrangler/dev-registry'),
    MINIFLARE_REGISTRY_PATH:path.join(runtimeRoot,'wrangler/registry'),
  })) process.env[name] ??= value;
}
