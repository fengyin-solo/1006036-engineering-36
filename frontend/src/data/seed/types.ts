import type { EntryRow, ModuleMeta } from '../types'

/** 一条样例的覆写值：key 必须是 ModuleMeta.fields 里的字段，值限原始类型。 */
export type SeedFieldOverrides = Record<string, string | number | boolean>

/** 单个模块的种子定义：只描述"要几条、哪些字段需要特别写"，其余交给 builder 推导。 */
export type ModuleSeedSpec = {
  /** 业务编号前缀，如 DELA；编号类字段生成 `${prefix}-${序号}`。 */
  prefix: string
  /** 样例条数；不填时等于状态清单长度，保证每个状态至少有一条样例。 */
  count?: number
  /** 按序号（从 0 起）逐条覆写；不覆写的字段由 builder 按字段名类型推导。 */
  samples?: SeedFieldOverrides[]
}

/** 完整种子定义：模块 key → 该模块定义。 */
export type SeedDefinition = {
  modules: Record<string, ModuleSeedSpec>
}

/** 展开后的、可直接落库的模块样例（尚不带 id，id 由持久化层分配）。 */
export type SeedPayload = Record<string, Omit<EntryRow, 'id'>[]>

export type SeedValidationIssue = {
  moduleKey: string
  message: string
}

/** 校验上下文：让校验不直接依赖 modules.ts，远端定义也能复用同一套校验。 */
export type SeedValidationContext = {
  metaByKey: Map<string, ModuleMeta>
}

/** 种子构建器：给一个模块定义，产出不带 id 的样例行（id 由持久化层分配）。 */
export type SeedBuilder = (
  meta: ModuleMeta,
  spec: ModuleSeedSpec,
  now: Date,
) => Omit<EntryRow, 'id'>[]
