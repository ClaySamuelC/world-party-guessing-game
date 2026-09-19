import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: its double-invoked effects would join, leave and immediately
// rejoin the same Trystero room, which the library warns against.
createRoot(document.getElementById('root')!).render(<App />)
