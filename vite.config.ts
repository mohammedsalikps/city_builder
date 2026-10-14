import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import type { IncomingMessage } from 'node:http';

/** The Vercel functions under api/ that the dev server also answers. */
const API_ROUTES: Record<string, string> = {
  '/api/build': '/api/build.ts',
  '/api/transcribe': '/api/transcribe.ts',
  '/api/status': '/api/status.ts',
};
/** Server-side settings read from .env files for the dev API (never exposed to the browser bundle; see server/aiProviders.ts). */
export const SERVER_ENV = [
  'ANTHROPIC_API_KEY',
  'EAVARA_LLM_EFFORT',
  'GROQ_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'EAVARA_LLM_PROVIDER',
  'EAVARA_LLM_MODEL',
  'EAVARA_LLM_BASE_URL',
  'EAVARA_LLM_API_KEY',
  'EAVARA_STT_PROVIDER',
  'EAVARA_STT_MODEL',
  'EAVARA_STT_BASE_URL',
  'EAVARA_STT_API_KEY',
  'EAVARA_STT_LANGUAGE',
  'EAVARA_AI_ENABLED',
  'EAVARA_VOICE_ENABLED',
];

/**
 * `npm run dev` serves the same api/*.ts handlers Vercel deploys, so the AI
 * builder works locally exactly as it does when hosted.
 */
function localApi(): Plugin {
  return {
    name: 'eavara-local-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const key of SERVER_ENV) if (env[key] && !process.env[key]) process.env[key] = env[key];
      server.middlewares.use(async (req, res, next) => {
        const file = API_ROUTES[(req.url ?? '').split('?')[0]];
        if (!file) return next();
        try {
          const handlers = (await server.ssrLoadModule(file)) as Record<string, (request: Request) => Response | Promise<Response>>;
          const handler = handlers[req.method ?? 'GET'];
          if (!handler) {
            res.statusCode = 405;
            res.end();
            return;
          }
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
          const headers = new Headers();
          for (const name of ['content-type', 'content-length', 'origin', 'host']) {
            const value = req.headers[name];
            if (typeof value === 'string') headers.set(name, value);
          }
          const response = await handler(
            new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
              method: req.method,
              headers,
              body: hasBody ? new Uint8Array(await readBody(req)) : undefined,
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [localApi()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
});
