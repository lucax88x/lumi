import { defineConfig } from '@hey-api/openapi-ts';
export default defineConfig({
  input: './api/openapi.json',
  output: { path: './web/src/api' },
  plugins: ['@hey-api/typescript', '@hey-api/client-fetch', '@hey-api/sdk', '@tanstack/react-query'],
});
