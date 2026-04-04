import express from 'express'
import cors from 'cors'
import { chatHandler } from './chatHandler'

const app = express()
const PORT = Number(process.env.PORT || 3001)
const HOST = '0.0.0.0'

function getMissingEnvVars(): string[] {
  return ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'].filter(
    (key) => !process.env[key]?.trim()
  )
}

app.use(cors())
app.use(express.json())

app.post('/api/chat', chatHandler)

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'fitcoach-api' })
})

app.get('/health', (_req, res) => {
  const missingEnvVars = getMissingEnvVars()

  if (missingEnvVars.length) {
    res.status(500).json({ status: 'error', missingEnvVars })
    return
  }

  res.json({ status: 'ok' })
})

process.on('unhandledRejection', (error) => {
  console.error('server:unhandledRejection', error)
})

process.on('uncaughtException', (error) => {
  console.error('server:uncaughtException', error)
})

const server = app.listen(PORT, HOST, () => {
  console.log('server:listening', {
    host: HOST,
    port: PORT,
    missingEnvVars: getMissingEnvVars(),
  })
})

server.on('error', (error) => {
  console.error('server:listen:error', error)
})
