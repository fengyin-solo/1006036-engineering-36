import { MODULE_BY_KEY } from './modules'
import type { ModuleMeta } from './types'
import type { SeedPlanEntry } from './seed-plan'

// 种子定义 = 种子计划（seed-plan）× 模块元数据（modules）派生出的一批批样例行。
// 通过 loadSeedDefinition() 异步获取：加载失败或校验不过都抛 SeedDefinitionError，
// 播种方按失败处理并允许重试。

export type SeedRow = {
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type SeedBatch = {
  module: string
  /** 业务编号字段名（去重键），如「事件编号」 */
  codeField: string
  rows: SeedRow[]
}

export type SeedDefinition = {
  version: number
  batches: SeedBatch[]
}

export class SeedDefinitionError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'SeedDefinitionError'
    this.cause = cause
  }
}

const DEFAULT_ROWS = 3
const DEFAULT_START_DATE = '2026-09-01'
const DATE_FIELD_PATTERN = /时间|日期|时段/
const CODE_FIELD_PATTERN = /编号|单号/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 业务编号字段：字段清单里第一个「编号/单号」字段，找不到就用第一个字段。 */
export function codeFieldOf(meta: ModuleMeta): string {
  return meta.fields.find((field) => CODE_FIELD_PATTERN.test(field)) ?? meta.fields[0]
}

function offsetDate(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function validatePlanEntry(entry: SeedPlanEntry): ModuleMeta {
  const meta = MODULE_BY_KEY.get(entry.module)
  if (!meta) {
    throw new SeedDefinitionError(`种子计划指向未登记的模块「${entry.module}」`)
  }
  if (!entry.prefix.trim()) {
    throw new SeedDefinitionError(`模块「${entry.module}」的种子计划缺少编号前缀`)
  }
  const rows = entry.rows ?? DEFAULT_ROWS
  if (!Number.isInteger(rows) || rows <= 0) {
    throw new SeedDefinitionError(`模块「${entry.module}」的样例条数必须是正整数`)
  }
  const startDate = entry.startDate ?? DEFAULT_START_DATE
  if (!DATE_PATTERN.test(startDate)) {
    throw new SeedDefinitionError(`模块「${entry.module}」的基准日期「${startDate}」不是 YYYY-MM-DD`)
  }
  const cycle = entry.statusCycle ?? meta.statuses.slice(0, DEFAULT_ROWS)
  if (cycle.length === 0) {
    throw new SeedDefinitionError(`模块「${entry.module}」的状态轮换为空`)
  }
  for (const status of cycle) {
    if (!meta.statuses.includes(status)) {
      throw new SeedDefinitionError(
        `模块「${entry.module}」的状态轮换里有「${status}」，但它不在模块状态清单里，请同步维护 seed-plan`,
      )
    }
  }
  for (const field of Object.keys(entry.fieldValues ?? {})) {
    if (!meta.fields.includes(field)) {
      throw new SeedDefinitionError(
        `模块「${entry.module}」定制了字段「${field}」，但它不在模块字段清单里，请同步维护 seed-plan`,
      )
    }
    if ((entry.fieldValues?.[field] ?? []).length === 0) {
      throw new SeedDefinitionError(`模块「${entry.module}」字段「${field}」的定制值为空`)
    }
  }
  return meta
}

function buildRow(meta: ModuleMeta, entry: SeedPlanEntry, index: number): SeedRow {
  const startDate = entry.startDate ?? DEFAULT_START_DATE
  const cycle = entry.statusCycle ?? meta.statuses.slice(0, DEFAULT_ROWS)
  const codeField = codeFieldOf(meta)
  const row: Record<string, string | number | boolean> = {}
  for (const field of meta.fields) {
    const custom = entry.fieldValues?.[field]
    if (custom) {
      row[field] = custom[index % custom.length]
    } else if (field === codeField) {
      row[field] = `${entry.prefix}-${String(index + 1).padStart(4, '0')}`
    } else if (DATE_FIELD_PATTERN.test(field)) {
      row[field] = offsetDate(startDate, index)
    } else {
      row[field] = `${meta.name}样例${index + 1}`
    }
  }
  const status = cycle[index % cycle.length]
  // 与 local-service 的约定一致：状态清单最后一项是终态，非终态即待处理。
  const terminal = meta.statuses[meta.statuses.length - 1]
  return {
    ...row,
    status,
    pending: status !== terminal,
    // 每模块固定第二条标异常，看板上始终有异常样例可看；只有一条时自然不命中。
    abnormal: index === 1,
  }
}

export function buildDefinition(plan: SeedPlanEntry[], version: number): SeedDefinition {
  if (!Number.isInteger(version) || version <= 0) {
    throw new SeedDefinitionError(`种子定义版本号「${version}」不合法`)
  }
  const seen = new Set<string>()
  const batches = plan.map((entry) => {
    if (seen.has(entry.module)) {
      throw new SeedDefinitionError(`种子计划里模块「${entry.module}」重复登记`)
    }
    seen.add(entry.module)
    const meta = validatePlanEntry(entry)
    const rows = entry.rows ?? DEFAULT_ROWS
    return {
      module: entry.module,
      codeField: codeFieldOf(meta),
      rows: Array.from({ length: rows }, (_, index) => buildRow(meta, entry, index)),
    }
  })
  return { version, batches }
}

/**
 * 异步加载种子定义：计划模块加载失败（如发版后旧页面取不到新 chunk）
 * 或计划与元数据校验不一致，都会抛 SeedDefinitionError，调用方按失败处理并允许重试。
 */
export async function loadSeedDefinition(): Promise<SeedDefinition> {
  let planModule: typeof import('./seed-plan')
  try {
    planModule = await import('./seed-plan')
  } catch (error) {
    throw new SeedDefinitionError('种子定义加载失败，可重试', error)
  }
  return buildDefinition(planModule.SEED_PLAN, planModule.SEED_PLAN_VERSION)
}
