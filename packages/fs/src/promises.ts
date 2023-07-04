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

class EISDIR extends SystemError {
  constructor(syscall: string, path: string) {
    super('illegal operation on a directory', {
      errno: -21,
      code: 'EISDIR',
      syscall,
      path,
    })
  }
}

async function syscall<T>(type: string, path: string, cb: () => Promise<T>, dict: Record<number, new (syscall: string, path: string) => SystemError>) {
  try {
    return await cb()
  } catch (e) {
    if (!(e instanceof DOMException)) throw e
    const constructor = dict[e.code]
    if (!constructor) throw e
    throw new constructor(type, path)
  }
}

async function getDirectoryHandle(type: string, path: string, parts: string[], create: boolean) {
  let root = await navigator.storage.getDirectory()
  for (const part of parts) {
    await syscall(type, path, async () => {
      root = await root.getDirectoryHandle(part, { create })
    }, {
      [DOMException.TYPE_MISMATCH_ERR]: ENOTDIR,
      [DOMException.NOT_FOUND_ERR]: ENOENT,
    })
  }
  return root
}

async function getParent(type: string, path: string, create = false) {
  const parts = path.split('/').filter(Boolean)
  const filename = parts.pop()!
  return [await getDirectoryHandle(type, path, parts, create), filename] as const
}

export interface EncodingOptions {
  encoding?: BufferEncoding
}

async function getFileHandle(type: string, path: string, create = false) {
  const [root, filename] = await getParent(type, path)
  return syscall(type, path, () => root.getFileHandle(filename, { create }), {
    [DOMException.TYPE_MISMATCH_ERR]: EISDIR,
    [DOMException.NOT_FOUND_ERR]: ENOENT,
  })
}

async function writeOrAppendFile(type: string, path: string, data: string | ArrayBuffer | ArrayBufferView | Blob | DataView, keepExistingData: boolean) {
  const handle = await getFileHandle(type, path, true)
  const stream = await handle.createWritable({ keepExistingData })
  if (typeof data === 'string') {
    data = new TextEncoder().encode(data)
  }
  await stream.write(data)
  await stream.close()
}

export async function writeFile(path: string, data: string | ArrayBuffer | ArrayBufferView | Blob | DataView) {
  await writeOrAppendFile('write', path, data, false)
}

export async function appendFile(path: string, data: string | ArrayBuffer | ArrayBufferView | Blob | DataView) {
  await writeOrAppendFile('append', path, data, true)
}

export async function readFile(path: string, options: 'utf8' | 'binary' = 'binary') {
  const handle = await getFileHandle('read', path)
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
  const parts = path.split('/').filter(Boolean)
  const root = await getDirectoryHandle('readdir', path, parts, false)
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
  if (options.recursive) {
    await getDirectoryHandle('mkdir', path, path.split('/').filter(Boolean), true)
    return
  }
  const [root, filename] = await getParent('mkdir', path)
  try {
    await root.getDirectoryHandle(filename)
  } catch (e) {
    if (!(e instanceof DOMException)) throw e
    if (e.code === DOMException.NOT_FOUND_ERR) {
      await root.getDirectoryHandle(filename, { create: true })
      return
    } else if (e.code === DOMException.TYPE_MISMATCH_ERR) {
      throw new EEXIST('mkdir', path)
    }
    throw e
  }
  throw new EEXIST('mkdir', path)
}

export interface RemoveOptions {
  force?: boolean
  recursive?: boolean
}

export async function rm(path: string, options: RemoveOptions = {}) {
  try {
    const [root, filename] = await getParent('rm', path)
    await root.removeEntry(filename, { recursive: options.recursive })
  } catch (e) {
    if (options.force && e instanceof ENOENT) return
    throw e
  }
}

export { rm as unlink, rm as rmdir }

export interface CopyOptions {
  force?: boolean
  recursive?: boolean
}

export async function cp(src: string, dst: string, options: CopyOptions = {}) {
  const oldHandle = await getHandle(src)
  const newHandle = await getHandle(dst, oldHandle.kind)
  if (oldHandle.kind === 'file') {
    const buffer = await (oldHandle as FileSystemFileHandle).getFile().then(file => file.arrayBuffer())
    const stream = await (newHandle as FileSystemFileHandle).createWritable()
    await stream.write(buffer)
    await stream.close()
  } else {
    for await (const name of (oldHandle as FileSystemDirectoryHandle).keys()) {
      await cp(src + '/' + name, dst + '/' + name)
    }
  }
}

export { cp as copyFile }

export async function rename(oldPath: string, newPath: string) {
  await cp(oldPath, newPath, { recursive: true })
  await rm(oldPath, { recursive: true })
}

export async function getHandle(path: string, kind: 'file'): Promise<FileSystemFileHandle>
export async function getHandle(path: string, kind: 'directory'): Promise<FileSystemDirectoryHandle>
export async function getHandle(path: string, kind?: FileSystemHandleKind): Promise<FileSystemHandle>
export async function getHandle(path: string, kind?: FileSystemHandleKind) {
  const [root, filename] = await getParent('lstat', path, !!kind)
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
