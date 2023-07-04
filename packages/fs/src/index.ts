import * as constants from './constants'
import * as promises from './promises'
import EventEmitter from 'events'
import { Matcher } from 'anymatch'

export { constants, promises }

export class Dirent {
  name: string

  constructor(private handle: FileSystemHandle) {
    this.name = handle.name
  }

  isFile() {
    return this.handle.kind === 'file'
  }

  isDirectory() {
    return this.handle.kind === 'directory'
  }
}

export interface WatchOptions {
  ignored?: Matcher
  ignoreInitial?: boolean
  cwd?: string
  depth?: number
  interval?: number
}

export class FSWatcher extends EventEmitter {
  constructor(paths: string | readonly string[], options?: WatchOptions) {
    super()
  }

  close() {}
}

export function watch(paths: string | readonly string[], options?: WatchOptions) {
  return new FSWatcher(paths, options)
}
