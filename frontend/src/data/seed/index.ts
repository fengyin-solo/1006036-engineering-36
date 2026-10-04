import { dataStore } from '../local-store'
import type { DataStore } from '../local-store'
import { MODULE_BY_KEY, MODULES } from '../modules'
import { buildModuleRows } from './builder'
import { applyModuleSeed, DEFAULT_BATCH_SIZE, reseedModule } from './engine'
import { loadSeedDefinition, type LoadedSeed } from './source'
import type { EntryRow } from '../types'
import type { ModuleSeedSpec } from './types'

export type ModuleSeedState = 'pending' | 'seeding' | 'done' | 'error'

export type ModuleSeedStatus = {
  key: string
  name: string
  state: ModuleSeedState
  nextIndex: number
  total: number
  message?: string
}

export type SeedOverallStatus = {
  source: 'local' | 'remote' | 'unknown'
  running: boolean
  ready: boolean
  message?: string
  modules: ModuleSeedStatus[]
}

let inflight: Promise<void> | null = null
let lastSource: 'local' | 'remote' | null = null
let lastFatal: string | undefined
let lastRunAt: string | undefined

function payloadFor(loaded: LoadedSeed, now: Date, moduleKey: string): Omit<EntryRow, 'id'>[] {
  const meta = MODULE_BY_KEY.get(moduleKey)
  const spec: ModuleSeedSpec | undefined = loaded.definition.modules[moduleKey]
  if (!meta || !spec) {
    return []
  }
  return buildModuleRows(meta, spec, now)
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function markModuleError(store: DataStore, moduleKey: string, message: string): void {
  const state = store.readSeedState()
  const current = state.modules[moduleKey]
  const fallback = { hash: '', nextIndex: 0, total: 0, updatedAt: new Date().toISOString() }
  store.writeSeedState({
    ...state,
    modules: {
      ...state.modules,
      [moduleKey]: { ...(current ?? fallback), lastError: message },
    },
  })
}

async function runSeedPass(
  store: DataStore,
  loaded: LoadedSeed,
  options: { reset?: string; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date()
  lastSource = loaded.source

  for (const meta of MODULES) {
    const spec = loaded.definition.modules[meta.key]
    if (!spec) {
      continue
    }
    const payload = payloadFor(loaded, now, meta.key)
    try {
      if (options.reset === meta.key) {
        reseedModule(store, meta, payload, loaded.hash, { batchSize: DEFAULT_BATCH_SIZE })
      } else {
        applyModuleSeed(store, meta, payload, loaded.hash, { batchSize: DEFAULT_BATCH_SIZE })
      }
      // 每模块后让出一次事件循环，UI 能刷新进度；断点已落库，中途关掉也能续跑。
      await yieldToEventLoop()
    } catch (error) {
      markModuleError(store, meta.key, error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  lastRunAt = new Date().toISOString()
}

async function runExclusive(
  task: () => Promise<void>,
): Promise<void> {
  // 全局只允许一轮播种在跑：启动、重试并发调用都复用同一个 Promise。
  if (inflight) {
    return inflight
  }
  inflight = task().finally(() => {
    inflight = null
  })
  return inflight
}

/**
 * 应用启动时调用：幂等。定义未变且各模块已完成则引擎立即跳过；
 * 定义拉不到/校验不过时抛出，调用方捕获后用界面引导重试（不阻塞应用挂载）。
 */
export function seedOnStartup(store: DataStore = dataStore, now?: Date): Promise<void> {
  return runExclusive(async () => {
    try {
      const loaded = await loadSeedDefinition()
      lastFatal = undefined
      await runSeedPass(store, loaded, { now })
    } catch (error) {
      lastFatal = error instanceof Error ? error.message : String(error)
      throw error
    }
  })
}

/** 失败后重试：重新拉定义，各模块从已提交批次之后继续，不重复播种。 */
export function retrySeeding(store: DataStore = dataStore, now?: Date): Promise<void> {
  return runExclusive(async () => {
    try {
      const loaded = await loadSeedDefinition()
      lastFatal = undefined
      await runSeedPass(store, loaded, { now })
    } catch (error) {
      lastFatal = error instanceof Error ? error.message : String(error)
      throw error
    }
  })
}

/**
 * 只重置并重播这一个模块的种子：先清空该模块自己的键与断点，再重新播种；
 * 其他模块的本地记录和播种状态完全不碰。
 */
export async function resetModuleSeed(
  moduleKey: string,
  store: DataStore = dataStore,
  now?: Date,
): Promise<void> {
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (!meta) {
    throw new Error(`没有登记名为 ${moduleKey} 的业务模块`)
  }
  // 等全局播种收尾，避免和并发的对账互相覆盖行集。
  if (inflight) {
    await inflight.catch(() => undefined)
  }
  const loaded = await loadSeedDefinition()
  reseedModule(store, meta, payloadFor(loaded, now ?? new Date(), moduleKey), loaded.hash, {
    batchSize: DEFAULT_BATCH_SIZE,
  })
  lastSource = loaded.source
  lastRunAt = new Date().toISOString()
}

export function seedStatus(store: DataStore = dataStore): SeedOverallStatus {
  const state = store.readSeedState()
  const modules: ModuleSeedStatus[] = MODULES.map((meta) => {
    const progress = state.modules[meta.key]
    if (!progress) {
      return { key: meta.key, name: meta.name, state: 'pending', nextIndex: 0, total: 0 }
    }
    if (progress.doneAt) {
      return {
        key: meta.key,
        name: meta.name,
        state: 'done',
        nextIndex: progress.nextIndex,
        total: progress.total,
      }
    }
    return {
      key: meta.key,
      name: meta.name,
      state: progress.lastError ? 'error' : 'seeding',
      nextIndex: progress.nextIndex,
      total: progress.total,
      message: progress.lastError,
    }
  })
  const anyError = modules.some((item) => item.state === 'error') || Boolean(lastFatal)
  const allDone = modules.every((item) => item.state === 'done')
  return {
    source: lastRunAt || lastSource ? (lastSource ?? 'unknown') : 'unknown',
    running: inflight !== null,
    ready: allDone && !anyError,
    message: lastFatal ?? (anyError ? '部分模块播种失败，可重试后从断点继续' : undefined),
    modules,
  }
}

export { loadSeedDefinition }
