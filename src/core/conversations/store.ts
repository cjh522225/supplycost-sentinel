import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary
} from '../../shared/types'
import { readJsonFile, writeJsonAtomic } from '../storage/fileStore'
import { ensureDir } from '../storage/paths'

const MAX_MESSAGES = 100
const MAX_TITLE_LENGTH = 32
const ID_PATTERN = /^[a-zA-Z0-9-]+$/

function titleOf(messages: ConversationMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim())
  if (!firstUser) return '新对话'
  const title = firstUser.content.replace(/\s+/g, ' ').trim()
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}…` : title
}

export class ConversationStore {
  readonly root: string

  constructor(dataDir: string) {
    this.root = join(dataDir, 'conversations')
    ensureDir(this.root)
    this.migrateLegacy()
  }

  private indexPath(): string {
    return join(this.root, 'index.json')
  }

  private path(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error('非法会话 ID')
    return join(this.root, `${id}.json`)
  }

  list(): ConversationSummary[] {
    return readJsonFile<ConversationSummary[]>(this.indexPath(), [])
      .filter((item) => item && ID_PATTERN.test(item.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  read(id: string): Conversation | undefined {
    const conversation = readJsonFile<Conversation | undefined>(this.path(id), undefined)
    return conversation && Array.isArray(conversation.messages) ? conversation : undefined
  }

  latest(): Conversation | undefined {
    const summary = this.list()[0]
    return summary ? this.read(summary.id) : undefined
  }

  create(): Conversation {
    const now = new Date().toISOString()
    const conversation: Conversation = {
      id: `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    this.write(conversation)
    return conversation
  }

  save(id: string, messages: ConversationMessage[]): Conversation {
    const existing = this.read(id)
    if (!existing) throw new Error('会话不存在')
    const conversation: Conversation = {
      ...existing,
      updatedAt: new Date().toISOString(),
      messages: messages.slice(-MAX_MESSAGES)
    }
    this.write(conversation)
    return conversation
  }

  delete(id: string): ConversationSummary[] {
    const path = this.path(id)
    if (existsSync(path)) unlinkSync(path)
    this.writeIndex(this.list().filter((item) => item.id !== id))
    return this.list()
  }

  private write(conversation: Conversation): void {
    writeJsonAtomic(this.path(conversation.id), conversation)
    const summary: ConversationSummary = {
      id: conversation.id,
      title: titleOf(conversation.messages),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length
    }
    this.writeIndex([summary, ...this.list().filter((item) => item.id !== conversation.id)])
  }

  private writeIndex(items: ConversationSummary[]): void {
    writeJsonAtomic(this.indexPath(), items)
  }

  private migrateLegacy(): void {
    if (this.list().length > 0) return
    const legacy = readJsonFile<Conversation | undefined>(join(this.root, 'current.json'), undefined)
    if (legacy && Array.isArray(legacy.messages)) {
      this.write({
        ...legacy,
        id: legacy.id || `conversation-${Date.now()}`,
        createdAt: legacy.createdAt || new Date().toISOString(),
        updatedAt: legacy.updatedAt || new Date().toISOString()
      })
    }
  }
}
