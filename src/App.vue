<script setup>
import { ref, onUnmounted, onMounted } from 'vue'

// 配置项（暂存于 localStorage，后续可用于请求）
const key = ref(localStorage.getItem('KEY') || '')
const version = ref(localStorage.getItem('VERSION') || '')
const token = ref(localStorage.getItem('TOKEN') || '')
const clientId = ref(localStorage.getItem('CLIENT_ID') || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())))

// WebSocket相关
const wsToken = ref('')

// 页面加载时获取最新的wsToken
onMounted(async () => {
  try {
    // 尝试从后端获取
    const resp = await fetch('/api/get-ws-token')
    // 检查响应状态
    if (!resp.ok) {
      logSys(`获取WebSocket Token失败: 服务器返回 ${resp.status}`)
      return
    }
    
    // 尝试解析JSON
    try {
      const data = await resp.json()
      if (data?.wsToken) {
        wsToken.value = data.wsToken
        logSys('已自动获取最新的WebSocket Token')
      }
    } catch (jsonError) {
      logSys('API返回格式错误，无法获取WebSocket Token')
    }
  } catch (e) {
    logSys(`获取WebSocket Token失败: ${e.message}`)
  }
})
const wsConnection = ref(null)
const priceLimit = ref(localStorage.getItem('PRICE_LIMIT') || '100')
const blacklist = ref(localStorage.getItem('BLACKLIST') || '1208万,机密,单双,清图,单局,大金')

// 简单日志（顶部系统日志、底部接口日志，后续可替换为真实输出）
const sysLogs = ref([])
const apiLogs = ref([])

function now() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function logSys(msg) {
  const logEntry = {
    text: `[${now()}] ${msg}`,
    isSuccess: msg.includes('🎉') || msg.includes('抢单成功')
  }
  sysLogs.value.unshift(logEntry)
}
function logApi(msg) {
  const logEntry = {
    text: `[${now()}] ${msg}`,
    isSuccess: msg.includes('✅') || msg.includes('抢单成功')
  }
  apiLogs.value.unshift(logEntry)
}

// 关闭WebSocket连接
function closeWebSocket() {
  if (wsConnection.value) {
    wsConnection.value.close()
    wsConnection.value = null
    logSys('WebSocket连接已关闭')
  }
}

// 连接WebSocket
async function connectWebSocket() {
  // 每次连接前都从后端获取最新的wsToken
  try {
    const resp = await fetch('/api/get-ws-token')
    if (resp.ok) {
      const data = await resp.json()
      if (data?.wsToken) {
        wsToken.value = data.wsToken
        logSys('已获取最新的WebSocket Token')
      }
    }
  } catch (e) {
    logSys(`获取WebSocket Token失败: ${e.message}`)
  }
  
  if (!wsToken.value) {
    logSys('⚠️ 未设置WebSocket Token，无法连接')
    return
  }

  closeWebSocket() // 先关闭已有连接

  const wsUrl = `ws://124.222.202.131:1653/ws/queue?token=${wsToken.value}`
  // logSys(`正在连接WebSocket: ${wsUrl}`)
  
  try {
    const ws = new WebSocket(wsUrl)
    wsConnection.value = ws

    ws.onopen = () => {
      logSys('✅ WebSocket已连接')
      // 连接成功后发送join消息
      ws.send(JSON.stringify({"cmd":"join"}))
      logSys('已发送 {"cmd":"join"} 消息')
    }

    ws.onmessage = (event) => {
       try {
         const data = JSON.parse(event.data)
         logSys(`收到WebSocket消息: ${JSON.stringify(data).substring(0, 100)}...`)
         
         if (data.type === 'orders') {
           processOrders(data.orders)
         }
       } catch (e) {
         logSys(`WebSocket消息解析错误: ${e.message}`)
       }
     }

    ws.onerror = (error) => {
      logSys(`⚠️ WebSocket错误: ${error.message || '未知错误'}`)
    }

    ws.onclose = () => {
      logSys('WebSocket连接已关闭')
    }
  } catch (e) {
    logSys(`⚠️ WebSocket连接异常: ${e.message}`)
  }
}

// 处理订单数据
function processOrders(orders) {
  if (!orders) return
  
  // 兼容数字键的情况
  if (typeof orders === 'object' && !Array.isArray(orders)) {
    orders = Object.values(orders)
  }
  
  if (!Array.isArray(orders)) {
    logApi(`订单数据格式错误: ${typeof orders}`)
    return
  }
  
  logApi(`收到${orders.length}个订单`)
  
  const blacklistItems = blacklist.value.split(',').map(item => item.trim()).filter(Boolean)
  const priceLimitValue = parseFloat(priceLimit.value) || 0
  
  for (const order of orders) {
    const orderId = order.id
    const name = order.product_name || ''
    const priceStr = order.price || '0'
    const remark = order.remark || ''
    
    let priceVal = 0
    try {
      priceVal = parseFloat(priceStr)
    } catch (e) {
      priceVal = 0
    }
    
    const isBlacklisted = blacklistItems.some(item => name.includes(item))
    const isPriceOk = priceVal > priceLimitValue
    const isRemarkOk = remark === '无'
    
    logApi(`订单 ${orderId}: ${name}, 价格=${priceVal}, 备注=${remark}`)
    
    if (isPriceOk && !isBlacklisted && isRemarkOk) {
      logApi(`🟢 符合条件订单: ${name}`)
      grabOrder(orderId)
    } else {
      const reasons = []
      if (!isPriceOk) reasons.push(`价格过低(${priceVal}<=${priceLimitValue})`)
      if (isBlacklisted) reasons.push('名称在黑名单中')
      if (!isRemarkOk) reasons.push(`备注不符(${remark})`)
      logApi(`🔴 不符合条件: ${reasons.join(', ')}`)
    }
  }
}

// 抢单
async function grabOrder(orderId) {
  if (!orderId) return
  
  logApi(`正在抢单: ${orderId}`)
  try {
    const resp = await fetch('/api/grab-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId.value, orderId: String(orderId) }),
    })
    const data = await resp.json()
    logApi(`抢单结果: ${JSON.stringify(data)}`)
    
    // 检查抢单是否成功（状态码为200）
    if (data.code === 200) {
      logSys(`🎉 抢单成功！订单ID: ${orderId}`)
      logApi(`✅ 抢单成功: ${data.data || '抢单成功'}`)
      
      // 停止WebSocket监控
      closeWebSocket()
      logSys('🛑 抢单成功，已自动停止监控')
      
      // 弹窗提醒
      alert(`🎉 抢单成功！\n\n订单ID: ${orderId}\n响应: ${data.data || '抢单成功'}\n\n监控已自动停止。`)
    }
  } catch (e) {
    logApi(`抢单异常: ${e.message}`)
  }
}

async function start() {
  localStorage.setItem('CLIENT_ID', clientId.value)
  localStorage.setItem('KEY', key.value)
  localStorage.setItem('VERSION', version.value)
  localStorage.setItem('TOKEN', token.value)
  // wsToken不需要本地缓存，每次都从后端获取
  localStorage.setItem('PRICE_LIMIT', priceLimit.value)
  localStorage.setItem('BLACKLIST', blacklist.value)
  
  // 专门保存wsToken到后台，确保所有用户共享同一个wsToken
  try {
    const saveTokenResp = await fetch('/api/save-ws-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wsToken: wsToken.value }),
    })
    if (saveTokenResp.ok) {
      logSys('WebSocket Token已保存到后台，所有用户将共享此Token')
    } else {
      // API可能未实现，但不影响主要功能
      logSys(`保存WebSocket Token未成功: ${saveTokenResp.status}，但不影响监控功能`)
    }
  } catch (e) {
    // 捕获错误但不阻止后续操作
    logSys(`保存WebSocket Token失败: ${e.message}，但不影响监控功能`)
  }
  
  logSys('配置已保存，本地已缓存。正在推送到后端...')
  try {
    const resp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        clientId: clientId.value, 
        key: key.value, 
        version: version.value, 
        token: token.value,
        wsToken: wsToken.value  // 添加wsToken到后台提交
      }),
    })
    const data = await resp.json()
    if (resp.ok && data?.ok) {
      logSys(`后端已更新配置，clientId=${clientId.value}`)
      
      // 启动WebSocket连接
      connectWebSocket()
    } else {
      logSys(`后端更新失败：${data?.msg || resp.status}`)
    }
  } catch (e) {
    logSys(`推送异常：${String(e)}`)
  }
}

// 停止监听
function stop() {
  closeWebSocket()
  logSys('已停止WebSocket监听')
}

// 导入JSON配置
function importConfig() {
  const jsonText = prompt('请输入JSON配置文本:')
  if (!jsonText) return
  
  try {
    const config = JSON.parse(jsonText)
    
    // 提取关键信息并填充表单，确保都是字符串类型
    if (config.key) key.value = String(config.key)
    if (config.version) version.value = String(config.version)
    if (config.token) token.value = String(config.token)
    
    logSys('✅ 已成功导入配置')
  } catch (e) {
    logSys(`⚠️ JSON解析错误: ${e.message}`)
  }
}

// 组件卸载时关闭WebSocket
onUnmounted(() => {
  closeWebSocket()
})
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>抢单工具 · 配置</h1>
      <p class="sub">简约配置页：填写 KEY、VERSION、TOKEN 后点击启动</p>
    </header>

    <section class="card form">
      <label class="field">
        <span>KEY</span>
        <input v-model="key" placeholder="输入 KEY" />
      </label>
      <label class="field">
        <span>VERSION</span>
        <input v-model="version" placeholder="输入 VERSION" />
      </label>
      <label class="field">
        <span>TOKEN</span>
        <input v-model="token" placeholder="输入 TOKEN" />
      </label>
      <label class="field">
        <span>用户ID</span>
        <input v-model="clientId" placeholder="输入或使用自动生成的ID" />
      </label>
      <label class="field">
        <span>WS Token</span>
        <input v-model="wsToken" placeholder="WebSocket Token" />
      </label>
      <label class="field">
        <span>价格限制</span>
        <input v-model="priceLimit" placeholder="最低价格" type="number" />
      </label>
      <label class="field">
        <span>黑名单</span>
        <input v-model="blacklist" placeholder="用逗号分隔关键词" />
      </label>
      <div class="actions">
        <button class="primary" @click="start">开始监听</button>
        <button class="secondary" @click="stop">停止监听</button>
        <button class="import" @click="importConfig">导入配置</button>
      </div>
    </section>

    <section class="logs">
      <div class="log-card">
        <div class="log-title">系统日志</div>
        <div class="log-body" v-if="sysLogs.length">
          <pre v-for="(l, i) in sysLogs" :key="i" :class="{ 'log-success': l.isSuccess }">{{ l.text }}</pre>
        </div>
        <div class="log-empty" v-else>待输出...</div>
      </div>
      <div class="log-card">
        <div class="log-title">接口日志</div>
        <div class="log-body" v-if="apiLogs.length">
          <pre v-for="(l, i) in apiLogs" :key="i" :class="{ 'log-success': l.isSuccess }">{{ l.text }}</pre>
        </div>
        <div class="log-empty" v-else>待输出...</div>
      </div>
    </section>
  </main>
</template>

<style scoped>
:root {
  --fg: #333;
  --muted: #666;
  --border: #ddd;
  --bg: #f5f5f5;
  --card: #fff;
  --primary: #1890ff;
  --primary-fg: #fff;
  --secondary: #f5222d;
  --secondary-fg: #fff;
  --success: #52c41a;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: var(--bg);
}

.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  color: var(--fg);
  background: var(--bg);
}

.header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px;
  color: #1890ff;
}

.header .sub {
  color: var(--muted);
  margin: 0 0 20px;
  font-size: 14px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.form {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  align-items: end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field span {
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
}

.field input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  outline: none;
  transition: all 0.3s;
}

.field input:focus {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
}

.actions {
  display: flex;
  gap: 10px;
}

.actions button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s;
}

.actions .primary {
  background: #1890ff;
  color: white;
}

.actions .secondary {
  background: #ff4d4f;
  color: white;
}

.actions .primary:hover {
  background: #40a9ff;
}

.actions .secondary:hover {
  background: #ff7875;
}

.actions .import {
  background: #722ed1;
  color: white;
}

.actions .import:hover {
  background: #9254de;
}

.logs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 20px;
}

.log-card {
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.log-title {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: #fafafa;
  font-weight: 600;
  font-size: 14px;
  color: #1890ff;
}

.log-body {
  padding: 12px 16px;
  max-height: 300px;
  overflow: auto;
  text-align: left;
}

.log-empty {
  padding: 40px 16px;
  color: var(--muted);
  text-align: center;
}

pre {
  margin: 4px 0;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  text-align: left;
  max-width: 100%;
  overflow: hidden;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.log-success {
  background: linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%);
  color: #389e0d;
  font-weight: 600;
  border-left: 4px solid #52c41a;
  padding: 8px 12px;
  border-radius: 6px;
  margin: 6px 0;
  box-shadow: 0 2px 4px rgba(82, 196, 26, 0.1);
}

@media (max-width: 840px) {
  .form { grid-template-columns: 1fr; }
  .logs { grid-template-columns: 1fr; }
}
</style>
