import { MODULES } from './modules'
import type { EntryRow } from './types'

// 本地持久化：每个模块一个 localStorage 键，重置或播种只影响被处理的那一个模块。
const ENTRIES_PREFIX = 'airport-ground-ops:entries:'
const LEGACY_ENTRIES_KEY = 'airport-ground-ops:entries'
const SEED_STATE_KEY = 'airport-ground-ops:seed-state'

/** 可替换的 KV 驱动：浏览器用 localStorage，测试用内存实现。 */
export interface KVDriver {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 单个模块的播种断点：分批提交，断了从 nextIndex 这批接着补。 */
export type ModuleSeedProgress = {
  hash: string
  nextIndex: number
  total: number
  updatedAt: string
  doneAt?: string
  lastError?: string
}

export type SeedState = {
  version: 1
  v1Migrated?: boolean
  modules: Record<string, ModuleSeedProgress>
}

function emptySeedState(): SeedState {
  return { version: 1, modules: {} }
}

export interface DataStore {
  listRows(moduleKey: string): EntryRow[]
  saveRows(moduleKey: string, rows: EntryRow[]): void
  allRows(): Record<string, EntryRow[]>
  readSeedState(): SeedState
  writeSeedState(state: SeedState): void
  /** 仅清空这一个模块的业务数据（供模块重置使用），其他模块不触碰。 */
  clearModuleRows(moduleKey: string): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createMemoryDriver(): KVDriver {
  const map = new Map<string, string>()
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

function createBrowserDriver(): KVDriver {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  // 非浏览器环境（理论上不会到这）兜底成内存驱动，保证调用不炸。
  return createMemoryDriver()
}

/**
 * 数据存储工厂。键按模块切分：
 * - `airport-ground-ops:entries:<key>` 业务记录；
 * - `airport-ground-ops:seed-state`    各种子模块的播种断点；
 * - 旧版单键 `airport-ground-ops:entries` 只读一次，拆分迁移后不再依赖。
 */
export function createDataStore(driver: KVDriver = createBrowserDriver()): DataStore {
  const rowCache = new Map<string, EntryRow[]>()
  let seedStateCache: SeedState | null = null

  function entriesKey(moduleKey: string): string {
    return `${ENTRIES_PREFIX}${moduleKey}`
  }

  function parseRows(raw: string | null): EntryRow[] {
    if (!raw) {
      return []
    }
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as EntryRow[]) : []
    } catch {
      return []
    }
  }

  /**
   * 旧版把所有模块塞在一个键里。首次访问时一次性拆开：
   * 已有独立键的模块不覆盖（尊重现状），其余原样搬进各自的键，真实记录一条不丢。
   */
  function migrateLegacyKey(state: SeedState): void {
    if (state.v1Migrated) {
      return
    }
    const raw = driver.getItem(LEGACY_ENTRIES_KEY)
    if (raw) {
      try {
        const legacy = JSON.parse(raw) as Record<string, EntryRow[]>
        for (const [moduleKey, rows] of Object.entries(legacy)) {
          const key = entriesKey(moduleKey)
          if (driver.getItem(key) === null && Array.isArray(rows)) {
            driver.setItem(key, JSON.stringify(rows))
          }
        }
      } catch {
        // 旧数据损坏就不迁移，保持现状，后续播种/重置照样可用。
      }
    }
    seedStateCache = { ...state, v1Migrated: true }
    driver.setItem(SEED_STATE_KEY, JSON.stringify(seedStateCache))
  }

  function readState(): SeedState {
    if (seedStateCache) {
      return seedStateCache
    }
    const raw = driver.getItem(SEED_STATE_KEY)
    let state: SeedState
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SeedState
        state = { ...emptySeedState(), ...parsed, modules: parsed.modules ?? {} }
      } catch {
        state = emptySeedState()
      }
    } else {
      state = emptySeedState()
    }
    migrateLegacyKey(state)
    return seedStateCache as SeedState
  }

  function readRows(moduleKey: string): EntryRow[] {
    readState() // 确保首次访问时旧键迁移已执行
    const cached = rowCache.get(moduleKey)
    if (cached) {
      return cached
    }
    const rows = parseRows(driver.getItem(entriesKey(moduleKey)))
    rowCache.set(moduleKey, rows)
    return rows
  }

  function writeRows(moduleKey: string, rows: EntryRow[]): void {
    const cloned = clone(rows)
    rowCache.set(moduleKey, cloned)
    driver.setItem(entriesKey(moduleKey), JSON.stringify(cloned))
  }

  return {
    listRows(moduleKey) {
      return clone(readRows(moduleKey))
    },
    saveRows(moduleKey, rows) {
      writeRows(moduleKey, rows)
    },
    allRows() {
      // 以模块清单为准逐个读：未缓存的模块也会触发一次读取（空也无妨）。
      const result: Record<string, EntryRow[]> = {}
      for (const meta of MODULES) {
        result[meta.key] = clone(readRows(meta.key))
      }
      return result
    },
    readSeedState() {
      return clone(readState())
    },
    writeSeedState(state) {
      seedStateCache = clone(state)
      driver.setItem(SEED_STATE_KEY, JSON.stringify(seedStateCache))
    },
    clearModuleRows(moduleKey) {
      writeRows(moduleKey, [])
    },
  }
}

/** 应用默认使用的单例存储。 */
export const dataStore: DataStore = createDataStore()

// ---- 兼容旧调用面的薄封装，local-service.ts 不需要改调用方式 ----

export function listRows(key: string): EntryRow[] {
  return dataStore.listRows(key)
}

export function saveRows(key: string, rows: EntryRow[]): void {
  dataStore.saveRows(key, rows)
}

export function allRows(): Record<string, EntryRow[]> {
  return dataStore.allRows()
}

/**
 * 旧接口保留，但重置语义改为"清空本模块"，不再回灌写死的 SEED_ROWS；
 * 真正的重新播种由 seed 门面在清空后触发（见 src/data/seed/index.ts）。
 */
export function resetRows(key: string): EntryRow[] {
  dataStore.clearModuleRows(key)
  return []
}

export function storageKey(): string {
  return ENTRIES_PREFIX
}
