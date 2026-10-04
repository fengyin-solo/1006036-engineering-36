import type {
  ModuleSeedSpec,
  SeedDefinition,
  SeedValidationContext,
  SeedValidationIssue,
} from './types'

/**
 * 校验种子定义。取不到"合法定义"时由这里给出明确原因，调用方按失败处理并允许重试，
 * 绝不带着半截非法定义去播种。
 */
export function validateSeedDefinition(
  definition: unknown,
  context: SeedValidationContext,
): { ok: true; definition: SeedDefinition } | { ok: false; issues: SeedValidationIssue[] } {
  const issues: SeedValidationIssue[] = []

  const rawModules = (definition as Partial<SeedDefinition> | null)?.modules
  if (!rawModules || typeof rawModules !== 'object') {
    return {
      ok: false,
      issues: [{ moduleKey: '*', message: '种子定义缺少 modules 映射' }],
    }
  }

  for (const [moduleKey, spec] of Object.entries(rawModules)) {
    const meta = context.metaByKey.get(moduleKey)
    if (!meta) {
      issues.push({ moduleKey, message: `模块 ${moduleKey} 未在模块清单中登记` })
      continue
    }
    validateModuleSpec(moduleKey, spec, meta, issues)
  }

  return issues.length === 0
    ? { ok: true, definition: definition as SeedDefinition }
    : { ok: false, issues }
}

function validateModuleSpec(
  moduleKey: string,
  rawSpec: unknown,
  meta: { fields: string[]; statuses: string[] },
  issues: SeedValidationIssue[],
): void {
  const spec = rawSpec as Partial<ModuleSeedSpec> | null | undefined
  if (!spec || typeof spec !== 'object') {
    issues.push({ moduleKey, message: '模块定义不是对象' })
    return
  }
  if (typeof spec.prefix !== 'string' || spec.prefix.trim() === '') {
    issues.push({ moduleKey, message: '编号前缀 prefix 不能为空' })
  }
  if (spec.count !== undefined && (!Number.isInteger(spec.count) || Number(spec.count) <= 0)) {
    issues.push({ moduleKey, message: '样例数量 count 必须是正整数' })
  }
  const count = spec.count ?? meta.statuses.length

  const sampleList = spec.samples ?? []
  if (!Array.isArray(sampleList)) {
    issues.push({ moduleKey, message: 'samples 必须是数组' })
    return
  }
  sampleList.forEach((sample, i) => {
    if (!sample || typeof sample !== 'object') {
      issues.push({ moduleKey, message: `第 ${i + 1} 条样例不是对象` })
      return
    }
    for (const field of Object.keys(sample)) {
      if (!meta.fields.includes(field) && field !== 'status') {
        issues.push({ moduleKey, message: `第 ${i + 1} 条样例出现字段清单外的字段「${field}」` })
      }
    }
    const status = sample.status
    if (status !== undefined && !meta.statuses.includes(String(status))) {
      issues.push({ moduleKey, message: `第 ${i + 1} 条样例的状态「${String(status)}」不在状态清单内` })
    }
    if (i >= count) {
      issues.push({ moduleKey, message: `第 ${i + 1} 条样例超出声明的样例数量 ${count}` })
    }
  })
}
