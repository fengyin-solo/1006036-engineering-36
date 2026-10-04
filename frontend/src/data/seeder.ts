import { loadSeedDefinition, SeedDefinitionError, type SeedBatch } from './seed-definition'
import { listRows, migrateLegacyStorage, saveRows } from './local-store'
import type { EntryRow } from './types'

// 播种执行器：启动时把种子定义分批写进本地存储。
// - 幂等：业务编号确定性生成，播种前按编号去重，重复执行不产生重复记录与重复编号；
// - 断点续跑：每批写完落 journal，中途断了下次从失败/未跑的批次接着补；
// - 可重试：取不到种子定义按失败处理，调用方可再次调用 ensureSeeded 重试。

const JOURNAL_KEY = 'airport-ground-ops:seed-journal'

type BatchRecord = { status: 'done' | 'failed'; ranAt: string; error?: string }

type SeedJournal = {
  version: number
  batches: Record<string, BatchRecord>
}

export type SeedFailure = { module: string; error: string }

export type SeedReport = {
  ok: boolean
  /** 本次实际补种的模块 */
  seeded: string[]
  /** journal 已完成、本次跳过的模块 */
  skipped: string[]
  /** 本次失败的批次 */
  failed: SeedFailure[]
  /** 定义级失败（取不到/校验不过）时的错误信息 */
  error?: string
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readJournal(): SeedJournal {
  const empty: SeedJournal = { version: 0, batches: {} }
  if (!hasStorage()) {
    return empty
  }
  const raw = window.localStorage.getItem(JOURNAL_KEY)
  if (!raw) {
    return empty
  }
  try {
    const parsed = JSON.parse(raw) as SeedJournal
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.batches !== 'object') {
      return empty
    }
    return parsed
  } catch {
    // journal 损坏就当没播种过：重跑全部批次，编号去重保证不产生重复记录。
    return empty
  }
}

function writeJournal(journal: SeedJournal): void {
  if (hasStorage()) {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 执行一个批次：把本地还没有的编号补进去，id 接续现有最大值，已存在的编号一律跳过。 */
function applyBatch(batch: SeedBatch): number {
  const existing = listRows(batch.module)
  const existingCodes = new Set(existing.map((row) => String(row[batch.codeField] ?? '')))
  let nextId = existing.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const additions: EntryRow[] = []
  for (const seedRow of batch.rows) {
    const code = String(seedRow[batch.codeField])
    if (existingCodes.has(code)) {
      continue
    }
    existingCodes.add(code)
    nextId += 1
    additions.push({ ...seedRow, id: nextId })
  }
  if (additions.length > 0) {
    saveRows(batch.module, [...existing, ...additions])
  }
  return additions.length
}

/**
 * 启动播种：先迁移旧版全量单键，再按种子定义逐批补种。
 * 可重复调用：已完成的批次跳过，失败/未跑的批次接着补。
 */
export async function ensureSeeded(): Promise<SeedReport> {
  migrateLegacyStorage()

  const report: SeedReport = { ok: false, seeded: [], skipped: [], failed: [] }
  let definition
  try {
    definition = await loadSeedDefinition()
  } catch (error) {
    report.error = errorMessage(error)
    return report
  }

  const journal = readJournal()
  if (journal.version !== definition.version) {
    // 种子定义升版：全部批次重跑（按编号去重，不会产生重复记录）。
    journal.version = definition.version
    journal.batches = {}
  }

  for (const batch of definition.batches) {
    if (journal.batches[batch.module]?.status === 'done') {
      report.skipped.push(batch.module)
      continue
    }
    try {
      applyBatch(batch)
      journal.batches[batch.module] = { status: 'done', ranAt: new Date().toISOString() }
      writeJournal(journal)
      report.seeded.push(batch.module)
    } catch (error) {
      // 单批失败（如存储配额满）记录后继续后续批次，下次从这里接着补。
      journal.batches[batch.module] = {
        status: 'failed',
        ranAt: new Date().toISOString(),
        error: errorMessage(error),
      }
      writeJournal(journal)
      report.failed.push({ module: batch.module, error: errorMessage(error) })
    }
  }

  report.ok = report.failed.length === 0
  return report
}

/**
 * 模块级重置：只用最新种子定义重建这一个模块，其他模块的本地记录保持不动。
 * 取不到种子定义时抛 SeedDefinitionError，调用方提示后可重试。
 */
export async function resetModuleRows(key: string): Promise<EntryRow[]> {
  const definition = await loadSeedDefinition()
  const batch = definition.batches.find((item) => item.module === key)
  if (!batch) {
    throw new SeedDefinitionError(`种子定义里没有模块「${key}」的批次`)
  }
  const rows: EntryRow[] = batch.rows.map((seedRow, index) => ({ ...seedRow, id: index + 1 }))
  saveRows(key, rows)

  const journal = readJournal()
  if (journal.version !== definition.version) {
    // 版本对齐后其他模块的批次记录不再可信，交给下次 ensureSeeded 重跑。
    journal.version = definition.version
    journal.batches = {}
  }
  journal.batches[key] = { status: 'done', ranAt: new Date().toISOString() }
  writeJournal(journal)
  return rows
}
