import { Buffer } from 'buffer'
import { O_APPEND, O_EXCL, parseFlags } from './constants'
import { Dirent } from '.'

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

class ENOENT extends SystemError {
  constructor(syscall: string, path: string) {
    super('no such file or directory', {
      errno: -2,
      code: 'EEXIST',
      syscall,
      path,
    })
  }
}

class EEXIST extends SystemError {
  constructor(syscall: string, path: string) {
    super('file already exists', {
      errno: -17,
      code: 'EEXIST',
      syscall,
      path,
    })
  }
}

class ENOTDIR extends SystemError {
  constructor(syscall: string, path: string) {
    super('not a directory', {
      errno: -20,
      code: 'ENOTDIR',
      syscall,
      path,
    })
  }
}

async function getParent(path: string, create = false) {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  const filename = segments.pop()!
  for (const segment of segments) {
    try {
      root = await root.getDirectoryHandle(segment, { create })
    } catch (e) {
      if (!(e instanceof DOMException)) throw e
      if (e.code === DOMException.TYPE_MISMATCH_ERR) {
        throw new ENOTDIR('lstat', path)
      } else if (e.code === DOMException.NOT_FOUND_ERR) {
        throw new ENOENT('lstat', path)
      }
      throw e
    }
  }
  return [root, filename] as const
}

export interface EncodingOptions {
  encoding?: BufferEncoding
}

export async function writeFile(path: string, data: string | ArrayBuffer | ArrayBufferView | Blob | DataView) {
  const [root, filename] = await getParent(path, true)
  const handle = await root.getFileHandle(filename, { create: true })
  const stream = await handle.createWritable()
  if (typeof data === 'string') {
    data = new TextEncoder().encode(data)
  }
  await stream.write(data)
  await stream.close()
}

export async function readFile(path: string, options: 'utf8' | 'binary' = 'binary') {
  const [root, filename] = await getParent(path, true)
  const handle = await root.getFileHandle(filename)
  const file = await handle.getFile()
  if (options === 'utf8') {
    return await file.text()
  } else {
    return Buffer.from(await file.arrayBuffer())
  }
}

export interface ReadDirectoryOptions {
  withFileTypes?: boolean
}

export async function readdir(path: string, options: ReadDirectoryOptions & { withFileTypes: true }): Promise<Dirent[]>
export async function readdir(path: string, options?: ReadDirectoryOptions & { withFileTypes?: false }): Promise<string[]>
export async function readdir(path: string, options: ReadDirectoryOptions = {}) {
  let root = await navigator.storage.getDirectory()
  const segments = path.split('/').filter(Boolean)
  for (const segment of segments) {
    root = await root.getDirectoryHandle(segment)
  }
  const results: (string | Dirent)[] = []
  for await (const [name, handle] of root.entries()) {
    results.push(options.withFileTypes ? new Dirent(handle) : name)
  }
  return results
}

export interface MakeDirectoryOptions {
  recursive?: boolean
}

export async function mkdir(path: string, options: MakeDirectoryOptions = {}) {
  const [root, filename] = await getParent(path, options.recursive)
  if (options.recursive) {
    return await root.getDirectoryHandle(filename, { create: true })
  }
  try {
    await root.getDirectoryHandle(filename)
  } catch {
    await root.getDirectoryHandle(filename, { create: true })
    return path
  }
  throw new EEXIST('mkdir', path)
}

export interface RmOptions {
  force?: boolean
  recursive?: boolean
}

export async function rm(path: string, options: RmOptions = {}) {
  try {
    const [root, filename] = await getParent(path)
    await root.removeEntry(filename, { recursive: options.recursive })
  } catch (err) {
    if (options.force && err instanceof ENOENT) return
    throw err
  }
}

export { rm as unlink }

export async function getHandle(path: string, kind: 'file'): Promise<FileSystemFileHandle>
export async function getHandle(path: string, kind: 'directory'): Promise<FileSystemDirectoryHandle>
export async function getHandle(path: string, kind?: FileSystemHandleKind): Promise<FileSystemHandle>
export async function getHandle(path: string, kind?: FileSystemHandleKind) {
  const [root, filename] = await getParent(path, !!kind)
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

export interface StatOptions {}

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
  await rm(oldPath, { recursive: true })
}

interface FileHandleWriteResult<T> {
  bytesWritten: number
  buffer: T
}

class FileHandle {
  private _streamTask?: Promise<FileSystemWritableFileStream>

  constructor(private handle: FileSystemFileHandle, private flags: number) {}

  stream() {
    return this._streamTask ||= this.handle.createWritable({
      keepExistingData: !!(this.flags & O_APPEND),
    })
  }

  async readFile() {
    const file = await this.handle.getFile()
    return await file.arrayBuffer()
  }

  write<T extends Uint8Array>(buffer: T, offset?: number, length?: number, position?: number): Promise<FileHandleWriteResult<T>>
  write(data: string, position?: number, encoding?: BufferEncoding): Promise<FileHandleWriteResult<string>>
  async write(data: string | Uint8Array, ...args: any[]) {
    if (typeof data === 'string') {
      const result = await this.write(new TextEncoder().encode(data), undefined, undefined, args[1])
      return { ...result, buffer: data }
    }
    const offset = args[0] ?? 0
    const length = args[1] ?? data.byteLength - offset
    data = data.slice(offset, offset + length)
    const stream = await this.stream()
    await stream.write(data)
    return { bytesWritten: data.byteLength, buffer: data }
  }

  async close() {
    const stream = await this.stream()
    await stream.close()
  }
}

export async function open(path: string, flags: string | number, mode?: number) {
  flags = parseFlags(flags)
  if (flags & O_EXCL) {
    try {
      await getHandle(path)
    } catch {
      return new FileHandle(await getHandle(path, 'file'), flags)
    }
    throw new EEXIST('open', path)
  }
  return new FileHandle(await getHandle(path, 'file'), flags)
}
