<template>
  <section class="page" data-module="delay">
    <header class="page-head">
      <div>
        <h2>延误处置管理</h2>
        <p class="page-desc">维护延误事件，围绕事件编号、航班号、延误原因、影响旅客数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记延误事件</button>
        <button class="btn" type="button" @click="exportRows">导出延误处置清单</button>
        <button class="btn ghost" type="button" :disabled="resetting" @click="resetSeed">
          {{ resetting ? '重建中…' : '重建延误示例数据' }}
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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无延误处置数据，可先登记延误事件</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条延误处置记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('delay')
const columns = ["事件编号", "航班号", "延误原因", "影响旅客数", "保障措施", "处置负责人", "上报时间", "处置状态"]
const actions = ["开始处置", "登记恢复", "确认归档"]
const statuses = ["待处置", "处置中", "已恢复", "已归档"]
const stats = [{"label": "待处置事件", "value": 0}, {"label": "处置中事件", "value": 0}, {"label": "本月延误架次", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const resetting = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '延误事件登记入口尚未接入审批流'
}

// 只重建延误模块的示例数据，其他模块的本地记录保持不动；失败可重试。
async function resetSeed() {
  resetting.value = true
  errorMessage.value = ''
  try {
    await resetModule(meta.key)
    reload()
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? `${error.message}，可重试` : '延误示例数据重建失败，可重试'
  } finally {
    resetting.value = false
  }
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '延误处置列表读取失败'
  }
}

onMounted(reload)
</script>
