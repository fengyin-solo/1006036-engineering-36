<template>
  <section class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记{{ meta.entity }}</button>
        <button class="btn" type="button" @click="exportRows">导出{{ meta.name }}清单</button>
        <button class="btn ghost" type="button" :disabled="resetting" @click="resetSeed">
          {{ resetting ? '重置中…' : '重置示例数据' }}
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in meta.fields" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in meta.fields" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in meta.actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="meta.fields.length + 2" class="empty-state">
            暂无{{ meta.name }}数据，可先登记{{ meta.entity }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ meta.name }}记录</span>
      <span v-if="seedMessage" class="error-text">
        {{ seedMessage }}
        <button v-if="canRetry" class="link" type="button" @click="retry">重试播种</button>
      </span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  moduleStats,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import { resetModuleSeed, retrySeeding, seedStatus } from '@/data/seed'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ moduleKey: string }>()

const meta = moduleMeta(props.moduleKey)
// 前三个字段作为快捷筛选列（与原各页面一致）。
const filterFields = meta.fields.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const errorMessage = ref('')
const resetting = ref(false)
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const seedMessage = computed(() => {
  const status = seedStatus().modules.find((item) => item.key === meta.key)
  if (status?.state === 'error') {
    return status.message ?? '本模块示例数据播种失败'
  }
  return ''
})
const canRetry = computed(() => seedMessage.value !== '')

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = `${meta.entity}登记入口尚未接入审批流`
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

async function resetSeed() {
  errorMessage.value = ''
  if (!window.confirm(`只重置「${meta.name}」的示例数据，本模块的浏览器记录会被样例覆盖，其他模块不受影响。继续？`)) {
    return
  }
  resetting.value = true
  try {
    const payload = await resetModule(meta.key)
    rows.value = payload.items
    total.value = payload.total
    stats.value = moduleStats(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.name}重置失败`
  } finally {
    resetting.value = false
  }
}

async function retry() {
  errorMessage.value = ''
  try {
    // 全局重试：各模块从断点批次继续，已完成的模块/批次不重复播种。
    await retrySeeding()
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.name}播种重试失败`
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = moduleStats(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.name}列表读取失败`
  }
}

onMounted(reload)
</script>
