import { MODULES } from './modules'
import type { EntryRow } from './types'

// 本地持久化：每个模块一个 localStorage 键，单模块的读写、损坏、重置都不波及其他模块。
// 播种不在这一层做（见 seeder.ts），这里只负责按模块读写。

const STORAGE_PREFIX = 'airport-ground-ops:entries:'
/** 旧版全量单键，启动时由 migrateLegacyStorage 拆分迁移 */
const LEGACY_STORAGE_KEY = 'airport-ground-ops:entries'

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export function moduleStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

const cache = new Map<string, EntryRow[]>()

function readModuleRows(key: string): EntryRow[] {
  if (!hasStorage()) {
    return []
  }
  const raw = window.localStorage.getItem(moduleStorageKey(key))
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as EntryRow[]) : []
  } catch {
    // 单模块数据损坏只按空列表处理本模块，不回退种子、不影响其他模块。
    console.warn(`模块「${key}」的本地记录解析失败，本模块按空列表处理，其他模块不受影响`)
    return []
  }
}

export function listRows(key: string): EntryRow[] {
  const cached = cache.get(key)
  if (cached) {
    return cached
  }
  const rows = readModuleRows(key)
  cache.set(key, rows)
  return rows
}

export function saveRows(key: string, rows: EntryRow[]): void {
  cache.set(key, rows)
  if (hasStorage()) {
    window.localStorage.setItem(moduleStorageKey(key), JSON.stringify(rows))
  }
}

export function allRows(): Record<string, EntryRow[]> {
  const result: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    result[meta.key] = listRows(meta.key)
  }
  return result
}

/**
 * 把旧版「全部模块挤一个键」的存量数据拆分到每模块一键。
 * 本地数据优先：目标键已存在时不覆盖；全部拆完才删旧键；
 * 旧键解析失败时保留旧键（人工处置），下次启动再试。
 */
export function migrateLegacyStorage(): void {
  if (!hasStorage()) {
    return
  }
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) {
    return
  }
  let legacy: Record<string, EntryRow[]>
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('不是按模块组织的对象')
    }
    legacy = parsed as Record<string, EntryRow[]>
  } catch (error) {
    console.warn(`旧版本地数据迁移失败，已保留原键 ${LEGACY_STORAGE_KEY}：`, error)
    return
  }
  for (const [key, rows] of Object.entries(legacy)) {
    if (!Array.isArray(rows)) {
      continue
    }
    if (window.localStorage.getItem(moduleStorageKey(key)) === null) {
      window.localStorage.setItem(moduleStorageKey(key), JSON.stringify(rows))
    }
  }
  window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  cache.clear()
}
