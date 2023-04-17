import * as path from 'path'

export function fileURLToPath(path: string | URL) {
  if (typeof path === 'string') path = new URL(path)
  return decodeURIComponent(path.pathname)
}

function encodePathChars(filepath: string) {
  return filepath
    .replace(/%/g, '%25')
    .replace(/\\/g, '%5C')
    .replace(/\n/g, '%0A')
    .replace(/\r/g, '%0D')
    .replace(/\t/g, '%09')
}

export function pathToFileURL(filepath: string) {
  const outURL = new URL('file://')
  let resolved = path.resolve(filepath)
  // path.resolve strips trailing slashes so we must add them back
  if (filepath[filepath.length - 1] === '/' && resolved[resolved.length - 1] !== path.sep) {
    resolved += '/'
  }
  outURL.pathname = encodePathChars(resolved)
  return outURL
}
