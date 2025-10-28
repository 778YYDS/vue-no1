<script setup>
import { ref, onUnmounted, onMounted, computed } from 'vue'

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
      // logSys(`获取WebSocket Token失败: 服务器返回 ${resp.status}`)
      return
    }
    
    // 尝试解析JSON
    try {
      const data = await resp.json()
      if (data?.wsToken) {
        wsToken.value = data.wsToken
        // logSys('已自动获取最新的WebSocket Token')
      }
    } catch (jsonError) {
      // logSys('API返回格式错误，无法获取WebSocket Token')
    }
  } catch (e) {
    // logSys(`获取WebSocket Token失败: ${e.message}`)
  }
})
const wsConnection = ref(null)
const priceLimit = ref(localStorage.getItem('PRICE_LIMIT') || '100')
const blacklist = ref(localStorage.getItem('BLACKLIST') || '1208万,机密,单双,清图,单局,大金')

// 简单日志（顶部系统日志、底部接口日志，后续可替换为真实输出）
const sysLogs = ref([])
const apiLogs = ref([])

// 日志最大条数限制，防止内存泄漏和页面卡顿
const MAX_LOG_ENTRIES = 100

// 订单去重记录，避免重复输出相同订单信息
const processedOrders = ref(new Set())

// 日志分页显示，提升性能
const LOGS_PER_PAGE = 20
const sysLogsPage = ref(1)
const apiLogsPage = ref(1)

// 计算显示的日志
const displayedSysLogs = computed(() => {
  const start = 0
  const end = sysLogsPage.value * LOGS_PER_PAGE
  return sysLogs.value.slice(start, end)
})

const displayedApiLogs = computed(() => {
  const start = 0
  const end = apiLogsPage.value * LOGS_PER_PAGE
  return apiLogs.value.slice(start, end)
})

// 是否有更多日志可以加载
const hasMoreSysLogs = computed(() => {
  return sysLogs.value.length > sysLogsPage.value * LOGS_PER_PAGE
})

const hasMoreApiLogs = computed(() => {
  return apiLogs.value.length > apiLogsPage.value * LOGS_PER_PAGE
})

// 加载更多日志
function loadMoreSysLogs() {
  if (hasMoreSysLogs.value) {
    sysLogsPage.value++
  }
}

function loadMoreApiLogs() {
  if (hasMoreApiLogs.value) {
    apiLogsPage.value++
  }
}

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
  
  // 限制日志条数，删除最旧的日志
  if (sysLogs.value.length > MAX_LOG_ENTRIES) {
    sysLogs.value = sysLogs.value.slice(0, MAX_LOG_ENTRIES)
  }
}

function logApi(msg) {
  const logEntry = {
    text: `[${now()}] ${msg}`,
    isSuccess: msg.includes('✅') || msg.includes('抢单成功')
  }
  apiLogs.value.unshift(logEntry)
  
  // 限制日志条数，删除最旧的日志
  if (apiLogs.value.length > MAX_LOG_ENTRIES) {
    apiLogs.value = apiLogs.value.slice(0, MAX_LOG_ENTRIES)
  }
}

// 清空日志功能
function clearSysLogs() {
  sysLogs.value = []
  sysLogsPage.value = 1
  // logSys('系统日志已清空')
}

function clearApiLogs() {
  apiLogs.value = []
  apiLogsPage.value = 1
  logApi('接口日志已清空')
}

function clearAllLogs() {
  sysLogs.value = []
  apiLogs.value = []
  sysLogsPage.value = 1
  apiLogsPage.value = 1
  // 同时清空订单记录，允许重新输出订单信息
  processedOrders.value.clear()
  // logSys('🔄 已清空所有日志和订单记录')
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
        // logSys('已获取最新的WebSocket Token')
      }
    }
  } catch (e) {
    // logSys(`获取WebSocket Token失败: ${e.message}`)
  }
  
  if (!wsToken.value) {
    // logSys('⚠️ 未设置WebSocket Token，无法连接')
    return
  }

  closeWebSocket() // 先关闭已有连接

  const wsUrl = `ws://124.222.202.131:1653/ws/queue?token=${wsToken.value}`
  // logSys(`正在连接WebSocket: ${wsUrl}`)
  
  try {
    const ws = new WebSocket(wsUrl)
    wsConnection.value = ws

    ws.onopen = () => {
      // logSys('✅ WebSocket已连接')
      // 连接成功后发送join消息
      ws.send(JSON.stringify({"cmd":"join"}))
      // logSys('已发送 {"cmd":"join"} 消息')
    }

    ws.onmessage = (event) => {
       try {
         const data = JSON.parse(event.data)
         
         if (data.type === 'orders') {
           // 不输出接收消息信息，直接处理订单
           processOrders(data.orders)
         }
         // 其他类型消息不输出任何日志
       } catch (e) {
         // 解析错误也不输出日志
       }
     }

    ws.onerror = (error) => {
      // logSys(`⚠️ WebSocket错误: ${error.message || '未知错误'}`)
    }

    ws.onclose = () => {
      // logSys('WebSocket连接已关闭')
    }
  } catch (e) {
    // logSys(`⚠️ WebSocket连接异常: ${e.message}`)
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
  
  // 统计新订单数量
  let newOrderCount = 0
  
  for (const order of orders) {
    const orderId = order.id
    const name = order.product_name || ''
    const priceStr = order.price || '0'
    const remark = order.remark || ''
    
    // 检查是否是新订单（未处理过的）
    if (!processedOrders.value.has(orderId)) {
      processedOrders.value.add(orderId)
      newOrderCount++
      
      let priceVal = 0
      try {
        priceVal = parseFloat(priceStr)
      } catch (e) {
        priceVal = 0
      }
      
      // 在系统日志中输出新订单信息
      logSys(`📦 新订单 ${orderId}: ${name} | 价格: ¥${priceVal} | 备注: ${remark}`)
      
      const isBlacklisted = blacklistItems.some(item => name.includes(item))
      const isPriceOk = priceVal > priceLimitValue
      const isRemarkOk = remark === '无'
      
      logApi(`订单 ${orderId}: ${name}, 价格=${priceVal}, 备注=${remark}`)
      
      if (isPriceOk && !isBlacklisted && isRemarkOk) {
        logApi(`🟢 符合条件订单: ${name}`)
        logSys(`🎯 发现符合条件的订单: ${name} (¥${priceVal})`)
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
  
  // 如果有新订单，在系统日志中汇总
  if (newOrderCount > 0) {
    logSys(`📊 本次处理了 ${newOrderCount} 个新订单，总计已处理 ${processedOrders.value.size} 个订单`)
  }
}

// 抢单
async function grabOrder(orderId) {
  if (!orderId) {
    logApi(`⚠️ 抢单失败: 订单ID为空`)
    return
  }
  
  // 检查必要的配置
  if (!clientId.value) {
    logApi(`⚠️ 抢单失败: clientId未设置`)
    logSys(`⚠️ 抢单失败: 缺少客户端ID配置`)
    return
  }
  
  logApi(`正在抢单: ${orderId}`)
  logSys(`🚀 开始抢单: ${orderId}`)
  
  try {
    const requestBody = { clientId: clientId.value, orderId: String(orderId) }
    logApi(`抢单请求参数: ${JSON.stringify(requestBody)}`)
    logSys(`📤 发送抢单请求: clientId=${clientId.value}`)
    
    const resp = await fetch('/api/grab-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    
    logApi(`抢单响应状态: ${resp.status}`)
    logSys(`📡 服务器响应状态: ${resp.status}`)
    
    const data = await resp.json()
    logApi(`抢单结果: ${JSON.stringify(data)}`)
    logSys(`📋 抢单响应数据: ${JSON.stringify(data)}`)
    
    // 检查抢单是否成功（状态码为200）
    if (data.code === 200) {
      logSys(`🎉 抢单成功！订单ID: ${orderId}`)
      logSys(`✅ 成功响应: ${data.data || data.message || '抢单成功'}`)
      logApi(`✅ 抢单成功: ${data.data || '抢单成功'}`)
      
      // 停止WebSocket监控
      closeWebSocket()
      logSys('🛑 抢单成功，已自动停止监控')
      
      // 弹窗提醒
      alert(`🎉 抢单成功！\n\n订单ID: ${orderId}\n响应: ${data.data || '抢单成功'}\n\n监控已自动停止。`)
    } else {
      logApi(`❌ 抢单失败: code=${data.code}, message=${data.message || data.msg || '未知错误'}`)
      logSys(`❌ 抢单失败 [${data.code}]: ${data.message || data.msg || '服务器返回错误'}`)
      if (data.data) {
        logSys(`📄 详细信息: ${data.data}`)
      }
    }
  } catch (e) {
    logApi(`抢单异常: ${e.message}`)
    logSys(`❌ 抢单异常: ${e.message}`)
    logSys(`🔧 建议检查网络连接或服务器状态`)
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
      // logSys('WebSocket Token已保存到后台，所有用户将共享此Token')
    } else {
      // API可能未实现，但不影响主要功能
      // logSys(`保存WebSocket Token未成功: ${saveTokenResp.status}，但不影响监控功能`)
    }
  } catch (e) {
    // 捕获错误但不阻止后续操作
    // logSys(`保存WebSocket Token失败: ${e.message}，但不影响监控功能`)
  }
  
  // logSys('配置已保存，本地已缓存。正在推送到后端...')
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
      // logSys(`后端已更新配置，clientId=${clientId.value}`)
      
      // 启动WebSocket连接
      connectWebSocket()
    } else {
      // logSys(`后端更新失败：${data?.msg || resp.status}`)
    }
  } catch (e) {
    // logSys(`推送异常：${String(e)}`)
  }
}

// 停止监听
function stop() {
  closeWebSocket()
  // logSys('已停止WebSocket监听')
}

// 导入JSON配置
function importConfig() {
  const inputText = prompt('请输入配置文本:\n1. JSON格式配置对象\n2. 或单独的TOKEN值')
  if (!inputText) return
  
  const trimmedInput = inputText.trim()
  
  // 检查是否是JWT token格式（以eyJ开头）
  if (trimmedInput.startsWith('eyJ')) {
    token.value = trimmedInput
    // logSys('✅ 已导入TOKEN值')
    return
  }
  
  // 检查是否是简单的字符串（可能是其他配置项）
  if (!trimmedInput.startsWith('{') && !trimmedInput.startsWith('[')) {
    // 询问用户这是什么类型的配置
    const configType = prompt('请选择配置类型:\n1. TOKEN\n2. KEY\n3. VERSION\n4. WS_TOKEN\n请输入数字(1-4):')
    switch(configType) {
      case '1':
        token.value = trimmedInput
        // logSys('✅ 已导入TOKEN值')
        break
      case '2':
        key.value = trimmedInput
        // logSys('✅ 已导入KEY值')
        break
      case '3':
        version.value = trimmedInput
        // logSys('✅ 已导入VERSION值')
        break
      case '4':
        wsToken.value = trimmedInput
        // logSys('✅ 已导入WS_TOKEN值')
        break
      default:
        // logSys('⚠️ 未知的配置类型')
    }
    return
  }
  
  // 尝试解析JSON格式
  try {
    const config = JSON.parse(trimmedInput)
    
    // 提取关键信息并填充表单，确保都是字符串类型
    if (config.key) {
      key.value = String(config.key)
      // logSys('✅ 已导入KEY')
    }
    if (config.version) {
      version.value = String(config.version)
      // logSys('✅ 已导入VERSION')
    }
    if (config.token) {
      token.value = String(config.token)
      // logSys('✅ 已导入TOKEN')
    }
    if (config.wsToken) {
      wsToken.value = String(config.wsToken)
      // logSys('✅ 已导入WS_TOKEN')
    }
    
    // logSys('✅ JSON配置导入完成')
  } catch (e) {
    // logSys(`⚠️ JSON解析错误: ${e.message}`)
    // logSys('💡 提示: 请确保输入的是有效的JSON格式，或选择单独导入配置项')
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
        <div class="log-header">
          <div class="log-title">系统日志 ({{ sysLogs.length }}/{{ MAX_LOG_ENTRIES }})</div>
          <button class="clear-btn" @click="clearSysLogs" v-if="sysLogs.length > 0">清空</button>
        </div>
        <div class="log-body" v-if="sysLogs.length">
          <pre v-for="(l, i) in displayedSysLogs" :key="i" :class="{ 'log-success': l.isSuccess }">{{ l.text }}</pre>
          <div class="load-more" v-if="hasMoreSysLogs">
            <button class="load-more-btn" @click="loadMoreSysLogs">
              加载更多 ({{ sysLogs.length - displayedSysLogs.length }} 条)
            </button>
          </div>
        </div>
        <div class="log-empty" v-else>待输出...</div>
      </div>
      <div class="log-card">
        <div class="log-header">
          <div class="log-title">接口日志 ({{ apiLogs.length }}/{{ MAX_LOG_ENTRIES }})</div>
          <button class="clear-btn" @click="clearApiLogs" v-if="apiLogs.length > 0">清空</button>
        </div>
        <div class="log-body" v-if="apiLogs.length">
          <pre v-for="(l, i) in displayedApiLogs" :key="i" :class="{ 'log-success': l.isSuccess }">{{ l.text }}</pre>
          <div class="load-more" v-if="hasMoreApiLogs">
            <button class="load-more-btn" @click="loadMoreApiLogs">
              加载更多 ({{ apiLogs.length - displayedApiLogs.length }} 条)
            </button>
          </div>
        </div>
        <div class="log-empty" v-else>待输出...</div>
      </div>
    </section>

    <!-- 全局清空按钮 -->
    <section class="log-actions" v-if="sysLogs.length > 0 || apiLogs.length > 0">
      <button class="clear-all-btn" @click="clearAllLogs">清空所有日志</button>
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

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: #fafafa;
}

.log-title {
  font-weight: 600;
  font-size: 14px;
  color: #1890ff;
}

.clear-btn {
  padding: 4px 8px;
  font-size: 12px;
  background: #ff4d4f;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
}

.clear-btn:hover {
  background: #ff7875;
}

.log-actions {
  margin-top: 16px;
  text-align: center;
}

.clear-all-btn {
  padding: 8px 16px;
  font-size: 14px;
  background: #ff4d4f;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: 0 2px 4px rgba(255, 77, 79, 0.2);
}

.clear-all-btn:hover {
  background: #ff7875;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(255, 77, 79, 0.3);
}

.load-more {
  text-align: center;
  padding: 12px 0;
  border-top: 1px solid var(--border);
  margin-top: 8px;
}

.load-more-btn {
  padding: 6px 12px;
  font-size: 12px;
  background: #1890ff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
}

.load-more-btn:hover {
  background: #40a9ff;
  transform: translateY(-1px);
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
