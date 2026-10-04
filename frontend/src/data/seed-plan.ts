// 种子计划：只声明每模块「几条样例、编号前缀、状态轮换、基准日期、少数字段定制」。
// 字段清单与状态清单一律从 modules.ts 派生（见 seed-definition.ts），
// 这里不重复抄写——元数据改了，样例自动跟着变，不用逐条手改。

export type SeedPlanEntry = {
  /** 模块 key，必须在 modules.ts 里登记过 */
  module: string
  /** 业务编号前缀，如 DELA → DELA-0001 */
  prefix: string
  /** 样例条数，默认 3 */
  rows?: number
  /** 状态轮换序列，默认取模块状态清单前 3 个；每个状态必须在模块状态清单里 */
  statusCycle?: string[]
  /** 日期类字段（名字含 时间/日期/时段）的基准日期，按序号逐天偏移，默认 2026-09-01 */
  startDate?: string
  /** 字段级定制值：按样例序号循环取值；键必须是模块字段清单里的字段 */
  fieldValues?: Record<string, (string | number)[]>
}

/**
 * 种子定义版本：改了计划结构或想让全量样例重建时 +1。
 * 版本变化会让所有批次重跑（按业务编号去重，不会产生重复记录）。
 */
export const SEED_PLAN_VERSION = 1

export const SEED_PLAN: SeedPlanEntry[] = [
  { module: 'flight', prefix: 'FLIG' },
  { module: 'stand', prefix: 'STAN' },
  { module: 'bridge', prefix: 'BRID' },
  { module: 'shuttle', prefix: 'SHUT' },
  { module: 'baggage', prefix: 'BAGG' },
  { module: 'line', prefix: 'LINE' },
  { module: 'fueling', prefix: 'FUEL' },
  { module: 'deice', prefix: 'DEIC' },
  { module: 'gpu', prefix: 'GPU' },
  { module: 'tow', prefix: 'TOW' },
  { module: 'catering', prefix: 'CATE', fieldValues: { 餐食数量: [10, 20, 30] } },
  { module: 'cabin', prefix: 'CABI' },
  { module: 'team', prefix: 'TEAM' },
  { module: 'vehmaint', prefix: 'VEHM' },
  { module: 'vip', prefix: 'VIP' },
  {
    module: 'delay',
    prefix: 'DELA',
    fieldValues: {
      航班号: ['CA1831', 'MU5420', 'CZ6607'],
      延误原因: ['雷雨天气绕飞', '前序航班晚到', '流量控制'],
      影响旅客数: [183, 96, 241],
      保障措施: ['加开值机柜台与改签通道', '安排旅客餐食与住宿', '协调备降机位与摆渡车'],
      处置负责人: ['王晓', '李楠', '赵磊'],
    },
  },
  { module: 'apron', prefix: 'APRO' },
  { module: 'resplan', prefix: 'RESP' },
]
