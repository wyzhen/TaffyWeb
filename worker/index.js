import { api } from './api.js';

// assetMap is added by scripts/build.mjs. Only authored demo assets are embedded;
// private user uploads live in the bound R2 bucket and are served through /api.
const assetMap = __TAFFY_ASSETS__;

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return api(request, env);
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405});
    const asset = assetMap[path];
    if (!asset) return new Response('Not found', {status:404});
    const {mime, base64, text} = asset;
    let bytes = text;
    if (base64 && request.method !== 'HEAD') {
      const binary = atob(base64); bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    }
    return new Response(request.method === 'HEAD' ? null : bytes, {headers:{
      'content-type':mime,
      'cache-control':path.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options':'nosniff',
      'referrer-policy':'same-origin',
    }});
  }
};
