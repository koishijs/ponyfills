import { Buffer } from 'buffer'

declare global {
  interface FileSystemCreateWritableOptions {
    keepExistingData?: boolean
  }

  interface FileSystemWritableFileStream extends WritableStream {
    seek(position: number): Promise<void>
    truncate(size: number): Promise<void>
    write(data: string | ArrayBuffer | ArrayBufferView | Blob | DataView): Promise<void>
  }

  interface FileSystemReadWriteOptions {
    at: number
  }

  interface FileSystemSyncAccessHandle {
    close(): Promise<void>
    flush(): Promise<void>
    getSize(): Promise<number>
    read(buffer: ArrayBuffer | ArrayBufferView, options?: FileSystemReadWriteOptions): Promise<number>
    truncate(newSize: number): Promise<void>
    write(buffer: ArrayBuffer | ArrayBufferView, options?: FileSystemReadWriteOptions): Promise<number>
  }

  interface FileSystemFileHandle {
    createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
  }

  interface FileSystemDirectoryHandle {
    entries(): AsyncIterable<[string, FileSystemHandle]>
    keys(): AsyncIterable<string>
    values(): AsyncIterable<FileSystemHandle>
  }
}

interface SystemErrorOptions {
  errno: number
  code: string
  syscall: string
  path: string
}

class SystemError extends Error {
  constructor(message: string, options: SystemErrorOptions) {
    super(`${options.code}: ${message}, ${options.syscall} '${options.path}'`)
  }
}

export async function writeFile(path: string, data: string | ArrayBuffer | ArrayBufferView | Blob | DataView) {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  const filename = segments.pop()!
  for (const segment of segments) {
    root = await root.getDirectoryHandle(segment, { create: true })
  }
  const handle = await root.getFileHandle(filename, { create: true })
  const stream = await handle.createWritable()
  if (typeof data === 'string') {
    data = new TextEncoder().encode(data)
  }
  await stream.write(data)
  await stream.close()
}

export async function readFile(path: string, options: 'utf8' | 'binary' = 'binary') {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  const filename = segments.pop()!
  for (const segment of segments) {
    root = await root.getDirectoryHandle(segment)
  }
  const handle = await root.getFileHandle(filename)
  const file = await handle.getFile()
  if (options === 'utf8') {
    return await file.text()
  } else {
    return Buffer.from(await file.arrayBuffer())
  }
}

export async function readdir(path: string) {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  for (const segment of segments) {
    root = await root.getDirectoryHandle(segment)
  }
  const results: string[] = []
  for await (const name of root.keys()) {
    results.push(name)
  }
  return results
}

export interface MakeDirectoryOptions {
  recursive?: boolean
}

export async function mkdir(path: string, options: MakeDirectoryOptions = {}) {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  const filename = segments.pop()!
  for (let i = 0; i < segments.length; ++i) {
    root = await root.getDirectoryHandle(segments[i], options.recursive ? { create: true } : {})
  }
  if (options.recursive) {
    return await root.getDirectoryHandle(filename, { create: true })
  }
  try {
    await root.getDirectoryHandle(filename)
  } catch {
    await root.getDirectoryHandle(filename, { create: true })
    return path
  }
  if (options.recursive) return
  throw new SystemError('file already exists', {
    errno: -17,
    code: 'EEXIST',
    syscall: 'mkdir',
    path,
  })
}

export async function unlink(path: string) {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  const filename = segments.pop()!
  for (const segment of segments) {
    root = await root.getDirectoryHandle(segment)
  }
  await root.removeEntry(filename, { recursive: true })
}

export interface StatOptions {}

export async function getHandle(path: string, kind: 'file'): Promise<FileSystemFileHandle>
export async function getHandle(path: string, kind: 'directory'): Promise<FileSystemDirectoryHandle>
export async function getHandle(path: string, kind?: FileSystemHandleKind): Promise<FileSystemHandle>
export async function getHandle(path: string, kind?: FileSystemHandleKind) {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  const filename = segments.pop()!
  for (const segment of segments) {
    root = await root.getDirectoryHandle(segment, { create: !!kind })
  }
  if (kind === 'file') {
    return await root.getFileHandle(filename, { create: true })
  } else if (kind === 'directory') {
    return await root.getDirectoryHandle(filename, { create: true })
  }
  try {
    return await root.getFileHandle(filename)
  } catch {
    return await root.getDirectoryHandle(filename)
  }
}

export async function stat(path: string, options?: StatOptions) {
  const handle = await getHandle(path)
  return {
    isFile: () => handle.kind === 'file',
    isDirectory: () => handle.kind === 'directory',
  }
}

export async function access(path: string, mode?: number) {
  await getHandle(path)
}

export async function rename(oldPath: string, newPath: string) {
  const oldHandle = await getHandle(oldPath)
  const newHandle = await getHandle(newPath, oldHandle.kind)
  if (oldHandle.kind === 'file') {
    const buffer = await (oldHandle as FileSystemFileHandle).getFile().then(file => file.arrayBuffer())
    const stream = await (newHandle as FileSystemFileHandle).createWritable()
    await stream.write(buffer)
    await stream.close()
  } else {
    for await (const name of (oldHandle as FileSystemDirectoryHandle).keys()) {
      await rename(oldPath + '/' + name, newPath + '/' + name)
    }
  }
  await unlink(oldPath)
}
