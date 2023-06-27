import * as constants from './constants'
import * as promises from './promises'

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
