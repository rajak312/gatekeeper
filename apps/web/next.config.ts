import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The browser only ever talks to this origin. Protocol and API routes are
 * proxied to the NestJS identity provider, so the session cookie is a
 * first-party cookie of the web origin (no third-party-cookie problems between
 * *.vercel.app and *.onrender.com) and the issuer URL is this origin.
 *
 * API_INTERNAL_URL is read at build time (rewrites are compiled into the
 * routes manifest), so set it in Vercel / the Docker build args.
 */
const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4500').replace(/\/+$/, '');
const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  poweredByHeader: false,
  agentRules: false,
  reactStrictMode: true,
  rewrites() {
    const proxied = [
      '/oauth/:path*',
      '/.well-known/:path*',
      '/api/:path*',
      '/health',
      '/docs',
      '/docs/:path*',
      '/docs-json',
    ];
    return Promise.resolve({
      beforeFiles: proxied.map((source) => ({ source, destination: `${API_URL}${source}` })),
      afterFiles: [],
      fallback: [],
    });
  },
  headers() {
    return Promise.resolve([
      {
        source: '/((?!docs).*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
        ],
      },
    ]);
  },
};

export default nextConfig;
