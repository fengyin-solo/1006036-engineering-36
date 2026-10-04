import { MODULE_BY_KEY } from '../modules'
import { validateSeedDefinition } from './validate'
import type { SeedDefinition } from './types'

/** 计算种子定义哈希：定义变了哈希就变，用于判断要不要重新对账。哈希只取定义本体，与日期无关。 */
export function definitionHash(definition: SeedDefinition): string {
  const json = stableStringify(definition)
  let h = 5381
  for (let i = 0; i < json.length; i += 1) {
    h = ((h << 5) + h + json.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .sort()
  return `{${entries.join(',')}}`
}

export type LoadedSeed = {
  definition: SeedDefinition
  hash: string
  /** 来源标记，页面提示用：local（仓库内置）/ remote（远端拉取）。 */
  source: 'local' | 'remote'
}

/**
 * 取种子定义。
 * - 默认仓库内置定义（永远可用，失败只可能是定义本身非法——那会直接抛错暴露问题）；
 * - 配了 VITE_SEED_URL 则以远端为准；远端取不到 / 校验不过都按失败抛出，
 *   不静默回退到内置定义，避免"配了远端却用了两份数据"难以排查。调用方负责展示与重试。
 */
export async function loadSeedDefinition(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  remoteUrl: string | undefined = import.meta.env?.VITE_SEED_URL as string | undefined,
): Promise<LoadedSeed> {
  if (remoteUrl && remoteUrl.trim() !== '') {
    const raw = await fetchImpl(remoteUrl, { cache: 'no-store' })
    if (!raw.ok) {
      throw new Error(`种子定义拉取失败：HTTP ${raw.status}`)
    }
    const json: unknown = await raw.json()
    const checked = validateSeedDefinition(json, { metaByKey: MODULE_BY_KEY })
    if (!checked.ok) {
      throw new Error(`远端种子定义校验未通过：${checked.issues.map((i) => i.message).join('；')}`)
    }
    return { definition: checked.definition, hash: definitionHash(checked.definition), source: 'remote' }
  }

  const checked = validateSeedDefinition(
    // 本地定义是受信源码，仍过同一套校验，防止改定义时留下非法样例。
    await loadLocalDefinition(),
    { metaByKey: MODULE_BY_KEY },
  )
  if (!checked.ok) {
    throw new Error(`内置种子定义非法：${checked.issues.map((i) => i.message).join('；')}`)
  }
  return { definition: checked.definition, hash: definitionHash(checked.definition), source: 'local' }
}

// 单独成函数，测试时可以 mock 掉模块依赖。
async function loadLocalDefinition(): Promise<unknown> {
  const mod = await import('./definitions')
  return mod.SEED_DEFINITION
}
