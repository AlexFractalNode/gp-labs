import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Returns every path that is an .ipynb/.pdf file or lies under a `materials` directory. */
export function findForbidden(files) {
  return files.filter((file) => {
    const normalized = file.split('\\').join('/')
    if (/\.(ipynb|pdf)$/i.test(normalized)) return true
    return normalized.split('/').includes('materials')
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0)
  const bad = findForbidden(tracked)
  if (bad.length > 0) {
    console.error('Forbidden course material tracked in git:\n' + bad.join('\n'))
    process.exit(1)
  }
  console.log('ok')
}
