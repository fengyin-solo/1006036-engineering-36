import type { SeedDefinition } from './types'

// 种子定义本体：只写"编号前缀 + 需要特别交代的样例字段"。
// 字段/状态清单不在这里重复，统一取自 src/data/modules.ts；
// 样例条数不写时默认等于状态清单长度（每个状态一条）。
// 没写覆写的字段由 builder 按字段名类型推导：
//   编号/单号 -> 前缀-序号；数量/时长等 -> 数值；时间/日期/时段 -> 相对今天的日期；
//   以"状态"结尾 -> 与当前状态一致；其余文本 -> <模块名>样例<序号>。
export const SEED_DEFINITION: SeedDefinition = {
  modules: {
    flight: { prefix: 'FLIG' },
    stand: { prefix: 'STAN' },
    bridge: { prefix: 'BRID' },
    shuttle: { prefix: 'SHUT' },
    baggage: { prefix: 'BAGG' },
    line: { prefix: 'LINE' },
    fueling: { prefix: 'FUEL' },
    deice: { prefix: 'DEIC' },
    gpu: { prefix: 'GPU' },
    tow: { prefix: 'TOW' },
    catering: { prefix: 'CATE' },
    cabin: { prefix: 'CABI' },
    team: { prefix: 'TEAM' },
    vehmaint: { prefix: 'VEHM' },
    vip: { prefix: 'VIP' },
    apron: { prefix: 'APRO' },
    resplan: { prefix: 'RESP' },
    // 延误处置：业务字段给出可读的真实感样例，编号/上报时间仍由 builder 生成。
    delay: {
      prefix: 'DELA',
      samples: [
        {
          航班号: 'CA1831',
          延误原因: '天气原因',
          影响旅客数: 132,
          保障措施: '广播告知旅客，联系气象席持续更新放行时刻',
          处置负责人: '王磊',
        },
        {
          航班号: 'MU5102',
          延误原因: '流量控制',
          影响旅客数: 186,
          保障措施: '协调餐食补给，申请后续优先放行时刻',
          处置负责人: '李静',
        },
        {
          航班号: 'CZ3107',
          延误原因: '机械故障',
          影响旅客数: 97,
          保障措施: '故障已排除，安排拖机至起飞等待点',
          处置负责人: '赵强',
        },
        {
          航班号: 'HU7805',
          延误原因: '旅客晚到',
          影响旅客数: 54,
          保障措施: '旅客安置完毕，事件材料归档备查',
          处置负责人: '陈敏',
        },
      ],
    },
  },
}
