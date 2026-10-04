import { defineStore } from 'pinia'

import { ensureSeeded, type SeedReport } from '@/data/seeder'

// 播种状态：启动时由 main.ts 触发，看板页展示失败信息并提供重试入口。
export const useSeedStore = defineStore('seed', {
  state: () => ({
    status: 'idle' as 'idle' | 'running' | 'done' | 'failed',
    error: '',
    failedModules: [] as string[],
  }),
  actions: {
    async run(): Promise<SeedReport> {
      if (this.status === 'running') {
        return { ok: false, seeded: [], skipped: [], failed: [], error: '播种正在进行中' }
      }
      this.status = 'running'
      this.error = ''
      this.failedModules = []
      const report = await ensureSeeded()
      if (report.ok) {
        this.status = 'done'
      } else {
        this.status = 'failed'
        this.error =
          report.error ?? `部分模块播种失败：${report.failed.map((item) => item.module).join('、')}`
        this.failedModules = report.failed.map((item) => item.module)
      }
      return report
    },
  },
})
