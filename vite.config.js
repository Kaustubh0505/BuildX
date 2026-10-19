import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => {
  const isDevelopment = command === 'serve'
  const contentSecurityPolicy = isDevelopment
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:5173"
    : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'"

  return {
    base: './',
    plugins: [
      react(),
      {
        name: 'buildx-content-security-policy',
        transformIndexHtml(html) {
          return html.replace(
            '</head>',
            `    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />\n  </head>`,
          )
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
    },
  }
})
