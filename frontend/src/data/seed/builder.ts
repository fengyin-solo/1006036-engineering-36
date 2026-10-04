import type { EntryRow, ModuleMeta } from '../types'
import type { ModuleSeedSpec, SeedFieldOverrides } from './types'

type UnassignedRow = Omit<EntryRow, 'id'>

const CODE_FIELD = /(编号|单号)$/
const NUMERIC_FIELD = /(数|量|时长|里程|缺口|需求|项数|人数)$/
const DATE_FIELD = /(时间|日期|时段)$/

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 第 i 条样例的相对日期：落在当月内、按序号错开几天，保证「今日 / 本月」统计每天都有数。
 * 用"当月日号 + 序号对当月天数取模"，既稳定可复现，又不会跑出本月。
 */
function sampleDate(now: Date, offset: number): string {
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const day = ((now.getDate() - 1 + offset) % daysInMonth) + 1
  return formatDate(new Date(year, month, day))
}

function deriveFieldValue(
  meta: ModuleMeta,
  field: string,
  status: string,
  index: number,
  code: string,
  date: string,
): string | number | boolean {
  if (CODE_FIELD.test(field)) {
    return code
  }
  if (DATE_FIELD.test(field)) {
    return date
  }
  if (NUMERIC_FIELD.test(field)) {
    // 数量级随序号变化，纯展示用；不参与任何状态判断。
    return (index + 1) * 10
  }
  if (field.endsWith('状态')) {
    // 字段清单里的"XX状态"与当前流转状态保持一致，避免状态与字段对不上。
    return status
  }
  return `${meta.name}样例${index + 1}`
}

/**
 * 把一份模块种子定义展开为样例行。
 * - 不产出 id：行 id 由持久化层按模块统一分配，重建幂等以业务编号为准。
 * - status 依次取状态清单；pending 由"是否末状态"推导；abnormal 固定落在第二条做演示。
 */
export function buildModuleRows(
  meta: ModuleMeta,
  spec: ModuleSeedSpec,
  now: Date = new Date(),
): UnassignedRow[] {
  const count = spec.count ?? meta.statuses.length
  const overrides: SeedFieldOverrides[] = spec.samples ?? []
  const rows: UnassignedRow[] = []

  for (let i = 0; i < count; i += 1) {
    const status = meta.statuses[i % meta.statuses.length]
    const lastStatus = meta.statuses[meta.statuses.length - 1]
    const code = `${spec.prefix}-${String(i + 1).padStart(4, '0')}`
    const date = sampleDate(now, i)
    const row: UnassignedRow = {
      status,
      pending: status !== lastStatus,
      abnormal: i === 1,
    }
    for (const field of meta.fields) {
      row[field] = deriveFieldValue(meta, field, status, i, code, date)
    }
    Object.assign(row, overrides[i] ?? {})
    // 覆写允许改 status，但 pending/abnormal 仍按统一规则推导，避免清单与标志位脱节。
    const finalStatus = String(row.status)
    row.status = finalStatus
    row.pending = finalStatus !== lastStatus
    rows.push(row)
  }
  return rows
}
