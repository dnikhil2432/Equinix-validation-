import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
 
export async function resolve(specifier, context, defaultResolve) {
  return defaultResolve(specifier, context, defaultResolve)
}
 
export async function load(url, context, defaultLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(fileURLToPath(url), 'utf8')
    return {
      format: 'module',
      source: `export default ${source};`,
      shortCircuit: true
    }
  }
  return defaultLoad(url, context, defaultLoad)
}

