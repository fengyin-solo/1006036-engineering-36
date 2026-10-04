import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, saveRows } from '@/data/local-store'
import { resetModuleSeed } from '@/data/seed'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/**
 * 重置只影响这一个模块：清掉该模块自己的 localStorage 键并按种子定义重新播种，
 * 其他模块的本地记录完全不碰。异步是因为种子来源可能是远端地址。
 */
export async function resetModule(key: string): Promise<PageResult> {
  await resetModuleSeed(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---- 统计指标：按标签语义现算，新增维度只改 modules.ts 的 metrics，不用再造样例 ----

function countByStatus(rows: EntryRow[], statusHint: string): number {
  return rows.filter((row) => String(row.status).includes(statusHint)).length
}

function toNumber(value: string | number | boolean | undefined): number {
  if (typeof value === 'number') {
    return value
  }
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/** 取模块里适合做汇总的数字字段（含"数/量/时长/里程"），优先取第一个。 */
function numericField(meta: ModuleMeta): string | undefined {
  return meta.fields.find((field) => /(数|量|时长|里程)$/.test(field) && !/(编号|单号)$/.test(field))
}

function dateField(meta: ModuleMeta): string | undefined {
  return meta.fields.find((field) => /(时间|日期|时段)$/.test(field))
}

function isWithin(valueAny: unknown, now: Date, windowMs: number): boolean {
  const value = String(valueAny ?? '')
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) {
    return false
  }
  return now.getTime() - date.getTime() <= windowMs && date.getTime() <= now.getTime() + 24 * 3600_000
}

export function computeMetric(meta: ModuleMeta, label: string, rows: EntryRow[], now: Date = new Date()): number {
  const statusHint = meta.statuses.find((status) => label.includes(status))
  const DAY = 24 * 3600_000

  // 率类指标：用「非待处理态占比」近似完成率，返回百分数。
  if (label.includes('率')) {
    if (rows.length === 0) {
      return 0
    }
    const finished = rows.filter((row) => !row.pending).length
    return Math.round((finished / rows.length) * 100)
  }

  // 本月/今日 + 汇总量（用量、份数、加注量……）
  if (label.includes('本月') || label.includes('今日')) {
    const field = dateField(meta)
    const windowMs = label.includes('本月')
      ? now.getDate() * DAY // 本月 1 日起到现在
      : DAY
    const scoped = field ? rows.filter((row) => isWithin(row[field], now, windowMs)) : rows
    const amountField = numericField(meta)
    if (amountField && /(用量|份数|加注量|总量)$/.test(label)) {
      return scoped.reduce((sum, row) => sum + toNumber(row[amountField]), 0)
    }
    if (statusHint) {
      return scoped.filter((row) => String(row.status).includes(statusHint)).length
    }
    return scoped.length
  }

  // 按状态点名统计：待处置事件、供电中设备……
  if (statusHint) {
    return countByStatus(rows, statusHint)
  }

  // 缺口/异常等按字段布尔语义
  if (label.includes('缺口')) {
    const field = numericField(meta)
    return field ? rows.filter((row) => toNumber(row[field]) > 0).length : rows.length
  }

  // 兜底：总量
  const amountField = numericField(meta)
  if (amountField && /(用量|份数|加注量|总量)$/.test(label)) {
    return rows.reduce((sum, row) => sum + toNumber(row[amountField]), 0)
  }
  return rows.length
}

export function moduleStats(key: string): { label: string; value: number }[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  return meta.metrics.map((label) => ({ label, value: computeMetric(meta, label, rows) }))
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
