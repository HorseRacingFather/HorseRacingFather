import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // devはルート、build時のみGitHub Pages用ベース
  base: command === 'serve' ? '/' : '/HorseRacingFather/',
}))
