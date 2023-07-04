function normalizeArray(parts: string[], allowAboveRoot: boolean) {
  let up = 0
  for (let i = parts.length - 1; i >= 0; i--) {
    const last = parts[i]
    if (last === '.') {
      parts.splice(i, 1)
    } else if (last === '..') {
      parts.splice(i, 1)
      up++
    } else if (up) {
      parts.splice(i, 1)
      up--
    }
  }
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..')
    }
  }
  return parts
}

const pathRegExp = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/

function parse(filename: string) {
  return pathRegExp.exec(filename)!.slice(1)
}

export function resolve(...args: string[]) {
  let resolvedPath = '', resolvedAbsolute = false
  for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    const path = (i >= 0) ? args[i] : '/'
    if (typeof path !== 'string') {
      throw new TypeError('The "path" argument must be of type string.')
    } else if (!path) {
      continue
    }
    resolvedPath = path + '/' + resolvedPath
    resolvedAbsolute = path.charAt(0) === '/'
  }
  resolvedPath = normalizeArray(resolvedPath.split('/').filter(p => !!p), !resolvedAbsolute).join('/')
  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.'
}

export function isAbsolute(path: string) {
  return path.charAt(0) === '/'
}

export function normalize(path: string) {
  const isPathAbsolute = isAbsolute(path)
  const trailingSlash = path.slice(-1) === '/'
  path = normalizeArray(path.split('/').filter(p => !!p), !isPathAbsolute).join('/')
  if (!path && !isPathAbsolute) path = '.'
  if (path && trailingSlash) path += '/'
  return (isPathAbsolute ? '/' : '') + path
}

export function join(...args: string[]) {
  return normalize(args.filter((p) => {
    if (typeof p !== 'string') {
      throw new TypeError('The "path" argument must be of type string.')
    }
    return p
  }).join('/'))
}

function trim(arr: string[]) {
  let start = 0
  for (; start < arr.length; start++) {
    if (arr[start] !== '') break
  }
  let end = arr.length - 1
  for (; end >= 0; end--) {
    if (arr[end] !== '') break
  }
  if (start > end) return []
  return arr.slice(start, end - start + 1)
}

export function relative(from: string, to: string) {
  const lhs = trim(resolve(from).slice(1).split('/'))
  const rhs = trim(resolve(to).slice(1).split('/'))

  const length = Math.min(lhs.length, rhs.length)
  let shared = 0
  for (; shared < length; shared++) {
    if (lhs[shared] !== rhs[shared]) break
  }
  const result: string[] = []
  for (let i = shared; i < lhs.length; i++) {
    result.push('..')
  }
  return result.concat(rhs.slice(shared)).join('/')
}

export const sep = '/'
export const delimiter = ':'

export function dirname(path: string) {
  const result = parse(path)
  const root = result[0]
  let dir = result[1]
  if (!root && !dir) return '.'
  if (dir) dir = dir.slice(0, -1)
  return root + dir
}

export function basename(path: string, ext?: string) {
  let f = parse(path)[2]
  if (ext && f.slice(-ext.length) === ext) {
    f = f.slice(0, -ext.length)
  }
  return f
}

export function extname(path: string) {
  return parse(path)[3]
}
