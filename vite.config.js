import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'folder-listing',
      configureServer(server) {
        server.middlewares.use('/api/list-folder', (req, res) => {
          try {
            const url = new URL(req.url, 'http://localhost')
            const folder = url.searchParams.get('folder')
            if (!folder) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'folder param required' }))
              return
            }
            const dirPath = path.join(process.cwd(), 'public', folder)
            if (!fs.existsSync(dirPath)) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify([]))
              return
            }
            const files = fs.readdirSync(dirPath).filter(f =>
              f.endsWith('.xlsx') || f.endsWith('.xls')
            )
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(files))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      }
    }
  ],
})
