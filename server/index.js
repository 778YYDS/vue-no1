import dotenv from 'dotenv'
import express from 'express'
import axios from 'axios'
import cors from 'cors'
import crypto from 'crypto'
import https from 'https'

dotenv.config()

const app = express()
app.use(express.json())
app.use(cors())

// 规范化路径：将连续的多个斜杠合并为一个，避免 "//api/..." 不匹配路由
app.use((req, _res, next) => {
  req.url = req.url.replace(/\/{2,}/g, '/');
  next();
});

const PORT = process.env.PORT || 3001

// 多用户配置存储：按 clientId 进行隔离
const CONFIGS = new Map()

// 全局共享的WebSocket Token
let GLOBAL_WS_TOKEN = process.env.WS_TOKEN || 'ws_' + crypto.randomBytes(16).toString('hex')

function generateSign(orderId, key) {
  const ts = String(Math.floor(Date.now() / 1000))
  const uid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')
  const raw = `${key}_${uid}_orderId=${orderId}_${ts}`
  const sign = crypto.createHash('md5').update(raw).digest('hex')
  return { sign, uid, ts }
}

// 接收/更新指定 clientId 的配置
app.post('/api/config', (req, res) => {
  const { clientId, key, version, token } = req.body || {}
  if (!clientId) return res.status(400).json({ ok: false, msg: 'clientId is required' })
  if (typeof key !== 'string' || typeof version !== 'string' || typeof token !== 'string') {
    return res.status(400).json({ ok: false, msg: 'key/version/token must be strings' })
  }
  CONFIGS.set(clientId, { key, version, token })
  return res.json({ ok: true })
})

// 查询指定 clientId 的配置
app.get('/api/config', (req, res) => {
  const clientId = req.query.clientId
  const conf = clientId ? CONFIGS.get(clientId) : null
  if (!conf) return res.status(404).json({ ok: false, msg: 'config not found' })
  return res.json({ ok: true, config: conf })
})

// 抢单：按 clientId 使用对应配置，互不干扰
app.post('/api/grab-order', async (req, res) => {
  const { clientId, orderId } = req.body || {}
  if (!orderId) return res.status(400).json({ code: 400, msg: 'orderId is required' })
  if (!clientId) return res.status(400).json({ code: 400, msg: 'clientId is required' })

  const conf = CONFIGS.get(clientId)
  if (!conf) return res.status(400).json({ code: 400, msg: 'Config not set for this clientId' })

  const { sign, uid, ts } = generateSign(orderId, conf.key)
  const headers = {
    'Content-Type': 'application/json;charset:utf-8',
    'Version': conf.version,
    'X-Auth-Token': conf.token,
    'Sign': sign,
    'Uuid': uid,
    'Timestamp': ts,
  }
  const url = 'https://hongniu.fengbaikeji.com/api/order/putOrderByDs'
  const payload = { orderId }

  try {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false })
    const resp = await axios.post(url, payload, { headers, httpsAgent, timeout: 10000 })
    const data = resp.data
    console.log('🚀 抢单响应:', data)
    return res.json(data)
  } catch (err) {
    console.error('请求失败:', err.response?.data || err.message)
    return res.status(502).json({
      code: 502,
      msg: 'Upstream request failed',
      error: err.response?.data || err.message,
    })
  }
})

// 获取WebSocket Token
app.get('/api/get-ws-token', (req, res) => {
  res.json({ ok: true, wsToken: GLOBAL_WS_TOKEN })
})

// 保存WebSocket Token
app.post('/api/save-ws-token', (req, res) => {
  const { wsToken } = req.body || {}
  if (!wsToken || typeof wsToken !== 'string') {
    return res.status(400).json({ ok: false, msg: 'wsToken must be a string' })
  }
  GLOBAL_WS_TOKEN = wsToken
  console.log(`WebSocket Token已更新: ${wsToken}`)
  return res.json({ ok: true })
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() })
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
  console.log(`当前WebSocket Token: ${GLOBAL_WS_TOKEN}`)
})