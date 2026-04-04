import express from 'express'
import cors from 'cors'
import { chatHandler } from './chatHandler'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.post('/api/chat', chatHandler)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(PORT, () => console.log(`Chat server on :${PORT}`))
