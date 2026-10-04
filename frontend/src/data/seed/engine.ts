import type { EntryRow, ModuleMeta } from '../types'
import type { DataStore, ModuleSeedProgress, SeedState } from '../local-store'

export const DEFAULT_BATCH_SIZE = 2

/** 取业务编号字段：默认是字段清单的第一个（各模块都是「XX编号/单号」）。 */
export function identityField(meta: ModuleMeta): string {
  return meta.fields[0]
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/** 有日期字段时按首个日期字段升序（如延误事件按上报时间）；否则按业务编号升序。 */
export function sortRows(meta: ModuleMeta, rows: EntryRow[]): EntryRow[] {
  const dateField = meta.fields.find((field) => /(时间|日期|时段)$/.test(field))
  const keyField = dateField ?? identityField(meta)
  return [...rows].sort((a, b) => {
    const av = String(a[keyField] ?? '')
    const bv = String(b[keyField] ?? '')
    if (av === bv) {
      return Number(a.id) - Number(b.id)
    }
    return av < bv ? -1 : 1
  })
}

export type ApplyBatchOptions = {
  batchSize?: number
  onProgress?: (nextIndex: number, total: number) => void
}

function writeProgress(
  store: DataStore,
  moduleKey: string,
  progress: ModuleSeedProgress,
  onProgress?: (nextIndex: number, total: number) => void,
): void {
  const state = store.readSeedState()
  // 能走到这里说明本批已成功落库，清掉上一轮遗留的失败标记；
  // 本轮再失败会由门面 catch 后重新打标。
  store.writeSeedState({
    ...state,
    modules: { ...state.modules, [moduleKey]: progress },
  })
  onProgress?.(progress.nextIndex, progress.total)
}

/**
 * 对单个模块跑一次（可续跑的）种子对账：
 * - 以业务编号幂等：已存在的行原样保留（本地真实记录优先），不重复插入、不改号；
 * - 只追加定义里缺失的样例，id 接着该模块现有最大号分配；
 * - 每批落库后回写 nextIndex，中断后从断点那批继续；
 * - 全部追加完再整体排序一次。
 */
export function applyModuleSeed(
  store: DataStore,
  meta: ModuleMeta,
  payload: Omit<EntryRow, 'id'>[],
  hash: string,
  options: ApplyBatchOptions = {},
): ModuleSeedProgress {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const state = store.readSeedState()
  const previous: ModuleSeedProgress | undefined = state.modules[meta.key]
  const resume = previous && previous.hash === hash
  const startIndex = resume ? Math.min(previous.nextIndex, payload.length) : 0

  if (resume && startIndex >= payload.length && previous.doneAt) {
    return previous
  }

  const codeField = identityField(meta)
  const baseRows = store.listRows(meta.key)
  const existingCodes = new Set(baseRows.map((row) => String(row[codeField] ?? '')))
  let rows = baseRows
  let nextSeq = nextId(baseRows)

  if (!resume) {
    writeProgress(
      store,
      meta.key,
      { hash, nextIndex: 0, total: payload.length, updatedAt: new Date().toISOString() },
      options.onProgress,
    )
  }

  for (let i = startIndex; i < payload.length; i += batchSize) {
    const batch = payload.slice(i, i + batchSize)
    for (const unassigned of batch) {
      const code = String(unassigned[codeField] ?? '')
      if (existingCodes.has(code)) {
        continue // 本地已有（真实记录或已播种样例）：本地优先，不覆盖。
      }
      rows = [...rows, { id: nextSeq, ...unassigned }]
      existingCodes.add(code)
      nextSeq += 1
    }
    // 每批落库一次：这批之前的都已持久化，断点之后重跑也不会重复。
    store.saveRows(meta.key, rows)
    writeProgress(
      store,
      meta.key,
      {
        hash,
        nextIndex: Math.min(i + batchSize, payload.length),
        total: payload.length,
        updatedAt: new Date().toISOString(),
      },
      options.onProgress,
    )
  }

  store.saveRows(meta.key, sortRows(meta, store.listRows(meta.key)))
  const done: ModuleSeedProgress = {
    hash,
    nextIndex: payload.length,
    total: payload.length,
    updatedAt: new Date().toISOString(),
    doneAt: new Date().toISOString(),
  }
  writeProgress(store, meta.key, done, options.onProgress)
  return done
}

/** 模块重置：清掉本模块业务数据与断点，再整批重新播种。其他模块不触碰。 */
export function reseedModule(
  store: DataStore,
  meta: ModuleMeta,
  payload: Omit<EntryRow, 'id'>[],
  hash: string,
  options: ApplyBatchOptions = {},
): ModuleSeedProgress {
  store.clearModuleRows(meta.key)
  const state = store.readSeedState()
  const modules = { ...state.modules }
  delete modules[meta.key]
  store.writeSeedState({ ...state, modules })
  return applyModuleSeed(store, meta, payload, hash, options)
}
