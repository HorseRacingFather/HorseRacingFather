import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const configuredBase = (import.meta as any).env?.BASE_URL ?? '/'
const effectiveBase = configuredBase === '/' && window.location.pathname.startsWith('/HorseRacingFather')
  ? '/HorseRacingFather/'
  : configuredBase

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={effectiveBase}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
