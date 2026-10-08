import { FileTransaction } from "../util/FileTransaction.ts"

export type { FileChange, WriteJournal } from "../util/FileTransaction.ts"

export class ConfigWriter extends FileTransaction { }
