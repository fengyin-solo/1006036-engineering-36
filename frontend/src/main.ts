import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useSeedStore } from './stores/seed'
import './styles/global.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// 启动时先播种（幂等、断点续跑），完成或失败都照常挂载；
// 失败时看板页会给出重试入口，不会卡在空白页。
const seedStore = useSeedStore(pinia)
seedStore.run().finally(() => {
  app.mount('#app')
})
