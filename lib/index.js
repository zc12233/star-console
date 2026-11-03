/**
 * dsh-star-console —— Host 半边。
 *
 * 两件事：
 *   ① 往 `webserver/index-inject` 推两行（样式 + 运行时脚本），把「🐟 星图控制台」
 *      的悬浮入口和全屏面板挂到页面上；
 *   ② 提供 /star-console/api/* 路由：读 / 校验 / 备份 / 写 bridge 的配置，
 *      以及启停 SnowLuma / 桥接这类本机操作。
 *
 * 设计约束（照抄 dsh-video-skin 踩出来的结论）：
 *   - 注入行必须**同步**注册在 apply 里，不能等任何服务就绪；
 *   - 只推 kind:'script'，绝不推 kind:'script-src'（后者失败会打掉 __DSH_BOOT_READY__）；
 *   - 注入行生成失败只 warn，绝不向上抛，不能连累 DSH 启动。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'

import { TREE, FIELD_BY_KEY, DEFAULTS, HOT_PATHS } from './schema.js'
import {
  resolvePaths, readConfig, writeConfig, backupAll, listRoles, readRole, writeRole,
  readCurrentRole, writeCurrentRole, getPath, setPath, deepMerge, readJson, atomicWrite,
} from './store.js'

export const name = 'star-console'
export const inject = []

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_DIR = path.join(PKG_ROOT, 'runtime')
const API_PREFIX = '/star-console/api'

// memory 的档案目录：默认 $DSH_HOME/diary，可用 STAR_CONSOLE_DIARY_DIR 覆盖。
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DIARY_DIR = process.env.STAR_CONSOLE_DIARY_DIR || path.join(DSH_HOME, 'diary')
const DIARY_FILES = { diary: '日记.md', notes: '手记.md', persona: 'persona.md' }
const DIARY_MAX_BYTES = 200 * 1024

const ROUTES = {
  bootstrap: `${API_PREFIX}/bootstrap`,
  status: `${API_PREFIX}/status`,
  apply: `${API_PREFIX}/apply`,
  export: `${API_PREFIX}/export`,
  import: `${API_PREFIX}/import`,
  backup: `${API_PREFIX}/backup`,
  role: `${API_PREFIX}/role`,
  roleSelect: `${API_PREFIX}/role/select`,
  service: `${API_PREFIX}/service`,
  voices: `${API_PREFIX}/voices`,
  diary: `${API_PREFIX}/diary`,
  diaryOpen: `${API_PREFIX}/diary/open`,
  diaryEntry: `${API_PREFIX}/diary/entry`,
  diaryDelete: `${API_PREFIX}/diary/delete`,
  openUrl: `${API_PREFIX}/open-url`,
  moment: `${API_PREFIX}/moment`,
  moments: `${API_PREFIX}/moments`,
  momentReset: `${API_PREFIX}/moment-reset`,
}

const BODY_LIMIT = 2 * 1024 * 1024

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** 只接受本机回环。取不到 remoteAddress 时放行（Electron 的 IPC 桥可能不给）。 */
function isLocal(req) {
  const addr = req.socket?.remoteAddress
  if (!addr) return true
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function makeRuntimeReader() {
  const cache = new Map()
  return (file) => {
    const target = path.join(RUNTIME_DIR, file)
    const stat = fs.statSync(target)
    const hit = cache.get(file)
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.text
    const text = fs.readFileSync(target, 'utf8')
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, text })
    return text
  }
}

/** 校验一个字段值；返回规范化后的值或抛错。 */
function validateField(field, value) {
  const label = field.label || field.key
  switch (field.type) {
    case 'bool':
      if (typeof value !== 'boolean') throw new Error(`${label} 需要布尔值`)
      return value
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error(`${label} 需要数字`)
      if (field.min !== undefined && n < field.min) throw new Error(`${label} 不能小于 ${field.min}`)
      if (field.max !== undefined && n > field.max) throw new Error(`${label} 不能大于 ${field.max}`)
      return n
    }
    case 'enum':
      if (!field.options.includes(value)) throw new Error(`${label} 只能是 ${field.options.join(' / ')}`)
      return value
    case 'list': {
      if (!Array.isArray(value)) throw new Error(`${label} 需要数组`)
      const out = []
      for (const raw of value) {
        if (field.itemType === 'number') {
          const n = Number(String(raw).trim())
          if (!Number.isFinite(n)) throw new Error(`${label} 里有非数字项：${raw}`)
          out.push(n)
        } else {
          const s = String(raw).trim()
          if (s) out.push(s)
        }
      }
      return [...new Set(out)]
    }
    default:
      if (typeof value !== 'string') throw new Error(`${label} 需要字符串`)
      return value
  }
}

function loadValues(paths, cfg) {
  const values = {}
  for (const [key, field] of FIELD_BY_KEY) {
    if (key.startsWith('action:')) continue
    if (key === 'currentRole') continue
    const raw = getPath(cfg, key)
    values[key] = raw === undefined ? DEFAULTS[key] : raw
    if (field.type === 'secret' && typeof raw === 'string' && raw.length > 0) {
      values[key] = '' // 只写不回显
      values[`${key}__saved`] = true
    }
  }
  values.currentRole = readCurrentRole(paths).role
  return values
}

function isConsumed(key) {
  if (key === 'currentRole') return true
  if (key.startsWith('connection.') || key.startsWith('session.') || key.startsWith('prompt.')
    || key.startsWith('persona.') || key.startsWith('group.') || key.startsWith('features.')) return false
  return true
}

function buildBootstrap(paths, cfg, origin) {
  const values = loadValues(paths, cfg)
  if (!getPath(cfg, 'dsh.baseUrl') && origin) values['dsh.baseUrl'] = origin

  // DSH 每次启动端口可能变；这里算一次「配置里的地址 vs 当前真实地址」的差异，
  // 面板据此提示用户同步，避免桥接重启后连到一个已经不存在的端口。
  let mismatch = null
  try {
    const configured = String(values['dsh.baseUrl'] || '')
    if (origin && configured) {
      const a = new URL(configured)
      const b = new URL(origin)
      if (a.host !== b.host) mismatch = { configured, origin }
    }
  } catch {
    /* 地址本身不合法时不提示，交给字段校验 */
  }

  return {
    mismatch,
    ok: true,
    version: '0.1.0',
    tree: TREE,
    values,
    consumed: Object.fromEntries([...FIELD_BY_KEY.keys()].map((k) => [k, isConsumed(k)])),
    roles: listRoles(paths),
    currentRole: readCurrentRole(paths).role,
    paths: {
      bridgeDir: paths.bridgeDir,
      configFile: paths.configFile,
      rolesDir: paths.rolesDir,
      backupDir: paths.backupDir,
      currentRoleFile: paths.currentRoleFile,
      snowlumaDir: paths.snowlumaDir,
    },
    origin: origin || '',
    dshPort: (() => {
      try {
        return Number(new URL(origin).port) || 0
      } catch {
        return 0
      }
    })(),
  }
}

/** 探测三层服务；每层都独立超时，任何一层挂了都不影响其它层。 */
async function probe(paths, cfg) {
  const out = { bridge: null, onebot: null, snowluma: null }
  const token = (() => {
    try {
      return fs.readFileSync(paths.consoleTokenFile, 'utf8').trim()
    } catch {
      return ''
    }
  })()

  const get = async (url, headers = {}) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(1800) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  await Promise.all([
    (async () => {
      try {
        const data = await get('http://127.0.0.1:3100/api/status', { 'x-console-token': token })
        out.bridge = {
          online: true, mode: data.mode, dshReady: data.dshReady,
          ownerQQ: data.ownerQQ, allowPrivate: data.allowPrivate, allowGroups: data.allowGroups,
          snowluma: data.snowluma,
        }
      } catch (error) {
        out.bridge = { online: false, error: describe(error) }
      }
    })(),
    (async () => {
      try {
        const accessToken = getPath(cfg, 'snowluma.accessToken') || ''
        const data = await get('http://127.0.0.1:3000/get_login_info', accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        out.onebot = { online: true, uin: data?.data?.user_id ?? null, nickname: data?.data?.nickname ?? '' }
      } catch (error) {
        out.onebot = { online: false, error: describe(error) }
      }
    })(),
    (async () => {
      try {
        const data = await get('http://127.0.0.1:5099/api/status')
        out.snowluma = { online: true, status: data?.status ?? 'unknown' }
      } catch (error) {
        out.snowluma = { online: false, error: describe(error) }
      }
    })(),
  ])
  return out
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000 },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout || '').trim(), err: String(stderr || '').trim() || (error ? describe(error) : '') }),
    )
  })
}

const KILL_BRIDGE = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bridge*src*bridge.js*' -or $_.CommandLine -like '*bridge*src/bridge.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; 'done'`
const KILL_SNOWLUMA = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*SnowLuma*index.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; 'done'`
const KILL_GSV = `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*gsv*server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; 'done'`

function startDetached(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return child.pid
}

// 可见终端：给控制台节点用，用户能看到日志、关掉窗口就停
function startVisible(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => {})
  child.unref()
  return child.pid
}

async function probeGsv() {
  try {
    const res = await fetch('http://127.0.0.1:5111/health', { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

async function runService(paths, action) {
  const bridgeBat = path.join(paths.bridgeDir, 'start-qq.bat')
  const snowlumaVbs = path.join(paths.snowlumaDir, 'launch-hidden.vbs')
  switch (action) {
    case 'start-bridge':
      if (!fs.existsSync(bridgeBat)) throw new Error(`找不到 ${bridgeBat}`)
      return { ok: true, pid: startDetached('cmd.exe', ['/c', 'start', '', bridgeBat]), note: '桥接已在后台启动' }
    case 'stop-bridge':
      return runPowerShell(KILL_BRIDGE)
    case 'restart-bridge': {
      const killed = await runPowerShell(KILL_BRIDGE)
      await new Promise((r) => setTimeout(r, 1500))
      const pid = startDetached('cmd.exe', ['/c', 'start', '', bridgeBat])
      return { ok: true, pid, killed: killed.out }
    }
    case 'start-snowluma':
      if (!fs.existsSync(snowlumaVbs)) throw new Error(`找不到 ${snowlumaVbs}`)
      return { ok: true, pid: startDetached('wscript.exe', [snowlumaVbs]), note: 'SnowLuma 已在后台启动' }
    case 'stop-snowluma':
      return runPowerShell(KILL_SNOWLUMA)
    case 'restart-snowluma': {
      const killed = await runPowerShell(KILL_SNOWLUMA)
      await new Promise((r) => setTimeout(r, 2000))
      if (!fs.existsSync(snowlumaVbs)) throw new Error(`找不到 ${snowlumaVbs}`)
      return { ok: true, pid: startDetached('wscript.exe', [snowlumaVbs]), killed: killed.out, note: 'SnowLuma 已重启，等 30~40 秒登录' }
    }
    case 'open-snowluma-login': {
      const upNow = async () => {
        try {
          const res = await fetch('http://127.0.0.1:5099/', { signal: AbortSignal.timeout(1500) })
          return res.status < 500
        } catch {
          return false
        }
      }
      let running = await upNow()
      if (!running) {
        if (!fs.existsSync(snowlumaVbs)) throw new Error(`找不到 ${snowlumaVbs}`)
        startDetached('wscript.exe', [snowlumaVbs])
        for (let i = 0; i < 40 && !running; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          running = await upNow()
        }
      }
      startVisible('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:5099'])
      return {
        ok: true,
        note: running ? '已打开 SnowLuma 登录页（5099）' : '已尝试拉起 SnowLuma，页面打不开的话等几秒再点一次',
      }
    }
    case 'start-gsv-term': {
      const gsvDir = process.env.STAR_CONSOLE_GSV_DIR || path.join(DSH_HOME, 'gsv')
      const bat = path.join(gsvDir, 'start-gsv.bat')
      if (!fs.existsSync(bat)) throw new Error(`找不到 ${bat}`)
      if (await probeGsv()) return { ok: true, note: 'GPT-SoVITS 已经在运行（5111），不用重复启动' }
      const pid = startVisible('cmd.exe', ['/c', 'start', '', bat])
      return { ok: true, pid, note: 'GPT-SoVITS 终端已打开，模型加载约 40 秒' }
    }
    case 'stop-gsv':
      return runPowerShell(KILL_GSV)
    case 'open-bridge-term': {
      const bat = path.join(paths.bridgeDir, 'start-qq.bat')
      if (!fs.existsSync(bat)) throw new Error(`找不到 ${bat}`)
      const pid = startVisible('cmd.exe', ['/c', 'start', '', bat])
      return { ok: true, pid, note: '桥接终端已打开' }
    }
    default:
      throw new Error(`未知操作：${action}`)
  }
}

export function apply(ctx) {
  const paths = resolvePaths({
    bridgeDir: process.env.STAR_CONSOLE_BRIDGE_DIR,
    snowlumaDir: process.env.STAR_CONSOLE_SNOWLUMA_DIR,
  })
  const readRuntime = makeRuntimeReader()
  const log = (message) => {
    try {
      ctx.logger?.info?.(`[star-console] ${message}`)
    } catch {
      /* 没有 logger 也不影响功能 */
    }
  }

  // ── ① 注入行：同步注册，失败只 warn ────────────────────────────────────
  ctx.on('webserver/index-inject', (table) => {
    if (!Array.isArray(table)) return
    try {
      table.push({ kind: 'style', text: readRuntime('panel.css') })
      table.push({ kind: 'script', placement: 'body', text: readRuntime('panel.js') })
    } catch (error) {
      log(`注入行生成失败，控制台入口不会出现：${describe(error)}`)
    }
  })

  // ── ② 路由 ─────────────────────────────────────────────────────────────
  ctx.inject(['webServer'], (child) => {
    child.effect(() => {
      const disposers = []
      const register = (routePath, handler) => {
        disposers.push(child.webServer.register({
          kind: 'exact',
          path: routePath,
          handler: async (req, res) => {
            if (!isLocal(req)) return json(res, 403, { ok: false, error: '仅本机可访问' })
            try {
              await handler(req, res)
            } catch (error) {
              json(res, 500, { ok: false, error: describe(error) })
            }
          },
        }))
      }

      const origin = (() => {
        try {
          return child.webServer.getOrigin()
        } catch {
          return ''
        }
      })()

      register(ROUTES.bootstrap, async (req, res) => {
        const cfg = readConfig(paths)
        const payload = buildBootstrap(paths, cfg, origin)
        // 把当前 DSH 端口写给桥接：它探活失败时会读这个文件自动跟随，
        // 这样 DSH 重启换了端口也不用再手改 config.json。
        try {
          if (payload.dshPort) {
            atomicWrite(path.join(paths.stateDir, 'dsh-port.txt'), String(payload.dshPort))
          }
        } catch {
          /* 写不了端口提示不影响面板本身 */
        }
        json(res, 200, payload)
      })

      register(ROUTES.status, async (req, res) => {
        const cfg = readConfig(paths)
        json(res, 200, { ok: true, ...(await probe(paths, cfg)) })
      })

      register(ROUTES.apply, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' })
        const body = await readBody(req)
        const patch = body?.patch
        if (!patch || typeof patch !== 'object') return json(res, 400, { ok: false, error: '缺少 patch' })

        const cfg = readConfig(paths)
        const errors = {}
        const applied = []
        let nextRole
        for (const [key, raw] of Object.entries(patch)) {
          if (key === 'currentRole') {
            if (raw !== null && !listRoles(paths).includes(String(raw))) {
              errors[key] = `角色不存在：${raw}`
              continue
            }
            nextRole = raw === null ? null : String(raw)
            applied.push(key)
            continue
          }
          const field = FIELD_BY_KEY.get(key)
          if (!field) {
            errors[key] = '未知字段'
            continue
          }
          try {
            const value = validateField(field, raw)
            setPath(cfg, key, value)
            applied.push(key)
          } catch (error) {
            errors[key] = describe(error)
          }
        }
        if (Object.keys(errors).length > 0) return json(res, 400, { ok: false, errors })

        const backup = backupAll(paths, 'apply')
        writeConfig(paths, cfg)
        if (nextRole !== undefined) writeCurrentRole(paths, nextRole)

        // 能热更新的字段顺手推给运行中的桥接；推不动不算失败。
        const hot = {}
        try {
          if (applied.some((k) => k.startsWith('allow.') || k.startsWith('deny.') || k === 'ownerQQ')) {
            const token = fs.readFileSync(paths.consoleTokenFile, 'utf8').trim()
            const r = await fetch('http://127.0.0.1:3100/api/whitelist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-console-token': token },
              body: JSON.stringify({
                allow: getPath(cfg, 'allow') ?? { private: [], groups: [] },
                deny: getPath(cfg, 'deny') ?? { private: [], groups: [] },
                ownerQQ: getPath(cfg, 'ownerQQ') ?? null,
              }),
              signal: AbortSignal.timeout(2500),
            })
            hot.whitelist = r.ok
          }
          if (nextRole !== undefined) {
            const token = fs.readFileSync(paths.consoleTokenFile, 'utf8').trim()
            const r = await fetch('http://127.0.0.1:3100/api/role', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-console-token': token },
              body: JSON.stringify({ role: nextRole }),
              signal: AbortSignal.timeout(2500),
            })
            hot.role = r.ok
          }
        } catch {
          hot.offline = true
        }

        const requiresRestart = applied.some((k) => !HOT_PATHS.includes(k))
        const fresh = readConfig(paths)
        json(res, 200, {
          ok: true,
          applied,
          requiresRestart,
          hot,
          backup,
          values: loadValues(paths, fresh),
        })
      })

      register(ROUTES.export, async (req, res) => {
        const cfg = readConfig(paths)
        const payload = {
          exportedAt: new Date().toISOString(),
          version: 1,
          config: cfg,
          currentRole: readCurrentRole(paths).role,
          roles: Object.fromEntries(listRoles(paths).map((n) => [n, readRole(paths, n)])),
        }
        const text = JSON.stringify(payload, null, 2)
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="star-console-${Date.now()}.json"`,
          'Content-Length': Buffer.byteLength(text),
          'Cache-Control': 'no-store',
        })
        res.end(text)
      })

      register(ROUTES.import, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' })
        const body = await readBody(req)
        const incoming = body?.payload
        if (!incoming || typeof incoming !== 'object') return json(res, 400, { ok: false, error: '导入内容为空' })
        const cfg = readConfig(paths)
        const merged = incoming.config && typeof incoming.config === 'object' ? deepMerge(cfg, incoming.config) : cfg
        const backup = backupAll(paths, 'import')
        writeConfig(paths, merged)
        if (typeof incoming.currentRole === 'string' || incoming.currentRole === null) {
          writeCurrentRole(paths, incoming.currentRole)
        }
        if (incoming.roles && typeof incoming.roles === 'object') {
          for (const [roleName, content] of Object.entries(incoming.roles)) {
            try {
              writeRole(paths, roleName, String(content))
            } catch {
              /* 非法角色名跳过 */
            }
          }
        }
        json(res, 200, { ok: true, backup, requiresRestart: true, values: loadValues(paths, readConfig(paths)) })
      })

      register(ROUTES.backup, async (req, res) => {
        const target = backupAll(paths, 'manual')
        json(res, 200, { ok: true, target })
      })

      register(ROUTES.role, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') {
          return json(res, 405, { ok: false, error: '需要 POST（{op:"read"|"save", name, content}）' })
        }
        const body = await readBody(req)
        if (!body?.name) return json(res, 400, { ok: false, error: '缺少 name' })
        if (body.op === 'read') {
          return json(res, 200, { ok: true, name: body.name, content: readRole(paths, body.name) })
        }
        const saved = writeRole(paths, body.name, body.content ?? '')
        json(res, 200, { ok: true, name: saved, roles: listRoles(paths) })
      })

      register(ROUTES.roleSelect, async (req, res) => {
        const body = await readBody(req)
        const roleName = body?.role ?? null
        if (roleName !== null && !listRoles(paths).includes(String(roleName))) {
          return json(res, 400, { ok: false, error: `角色不存在：${roleName}` })
        }
        writeCurrentRole(paths, roleName === null ? null : String(roleName))
        let hot = false
        try {
          const token = fs.readFileSync(paths.consoleTokenFile, 'utf8').trim()
          const r = await fetch('http://127.0.0.1:3100/api/role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-console-token': token },
            body: JSON.stringify({ role: roleName }),
            signal: AbortSignal.timeout(2500),
          })
          hot = r.ok
        } catch {
          hot = false
        }
        json(res, 200, { ok: true, role: roleName, hot })
      })

      register(ROUTES.service, async (req, res) => {
        const body = await readBody(req)
        const result = await runService(paths, String(body?.action || ''))
        json(res, 200, { ok: true, ...result })
      })

      // 语音库列表：给「语音与唱歌」节点用，读的是 bridge/audio/
      register(ROUTES.voices, async (req, res) => {
        const cfg = readConfig(paths)
        const rel = String(cfg?.socialV2?.voice?.dir || 'audio')
        const dir = path.resolve(paths.bridgeDir, rel)
        const exts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.amr', '.silk']
        const voices = []
        const walk = (cur, prefix = '') => {
          let entries = []
          try {
            entries = fs.readdirSync(cur, { withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue
            const full = path.join(cur, entry.name)
            if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
            else if (exts.includes(path.extname(entry.name).toLowerCase())) {
              const st = fs.statSync(full)
              voices.push({ name: `${prefix}${entry.name}`, bytes: st.size, mtime: st.mtimeMs })
            }
          }
        }
        walk(dir)
        voices.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        json(res, 200, { ok: true, dir, enabled: cfg?.socialV2?.voice?.enabled === true, voices })
      })

      // 肥鱼日记档案：给「日记」分支用，只读三份人可读文件，不碰 jsonl。
      register(ROUTES.diary, async (req, res) => {
        const url = (() => {
          try {
            return new URL(String(req.url || ''), 'http://127.0.0.1')
          } catch {
            return null
          }
        })()
        const key = String(url?.searchParams?.get('file') || 'diary')
        const file = DIARY_FILES[key]
        if (!file) return json(res, 400, { ok: false, error: `未知档案：${key}` })
        const target = path.join(DIARY_DIR, file)
        let content = ''
        let exists = false
        let mtime = null
        let bytes = 0
        try {
          const stat = fs.statSync(target)
          exists = true
          mtime = stat.mtimeMs
          bytes = stat.size
          content = fs.readFileSync(target, 'utf8')
          if (content.length > DIARY_MAX_BYTES) content = `${content.slice(0, DIARY_MAX_BYTES)}\n\n…（文件较大，已截断）`
        } catch {
          /* 档案还没生成：返回 exists:false，由面板提示 */
        }
        json(res, 200, { ok: true, dir: DIARY_DIR, key, file, path: target, exists, mtime, bytes, content })
      })

      // 在资源管理器里打开档案目录（或某一份文件）。
      register(ROUTES.diaryOpen, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' })
        const body = await readBody(req)
        const what = String(body?.what || 'dir')
        let target = DIARY_DIR
        if (what !== 'dir') {
          const file = DIARY_FILES[String(body?.file || 'diary')]
          if (!file) return json(res, 400, { ok: false, error: '未知档案' })
          target = path.join(DIARY_DIR, file)
        }
        if (!fs.existsSync(target)) return json(res, 404, { ok: false, error: `路径不存在：${target}` })
        try {
          const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true })
          child.unref()
        } catch (error) {
          return json(res, 500, { ok: false, error: describe(error) })
        }
        json(res, 200, { ok: true, target })
      })

      // 编辑一条日记记忆：改 diary/*.jsonl 的 text 字段，改前先备份原文件。
      register(ROUTES.diaryEntry, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' })
        if (!isLocal(req)) return json(res, 403, { ok: false, error: '只允许本机' })
        const body = await readBody(req)
        const id = String(body?.id || '')
        const text = String(body?.text ?? '').trim()
        if (!/^d_\d{8}_\d+$/.test(id)) return json(res, 400, { ok: false, error: '记忆 id 不合法' })
        if (!text) return json(res, 400, { ok: false, error: 'text 不能为空' })
        if (text.length > 4000) return json(res, 400, { ok: false, error: 'text 太长（上限 4000 字）' })

        const dir = path.join(DIARY_DIR, 'diary')
        let files = []
        try {
          files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
        } catch (error) {
          return json(res, 500, { ok: false, error: `读不到记忆目录：${describe(error)}` })
        }

        for (const file of files) {
          const target = path.join(dir, file)
          let raw
          try {
            raw = fs.readFileSync(target, 'utf8')
          } catch {
            continue
          }
          const lines = raw.split(/\r?\n/)
          let hit = -1
          let entry = null
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()
            if (!line) continue
            let parsed
            try {
              parsed = JSON.parse(line)
            } catch {
              continue
            }
            if (String(parsed?.id) !== id) continue
            hit = i
            entry = parsed
            break
          }
          if (hit < 0) continue

          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const backupDir = path.join(DIARY_DIR, 'backups')
          let backup = ''
          try {
            fs.mkdirSync(backupDir, { recursive: true })
            backup = path.join(backupDir, `${stamp}-${file}`)
            fs.copyFileSync(target, backup)
          } catch (error) {
            return json(res, 500, { ok: false, error: `备份失败：${describe(error)}` })
          }

          entry.text = text
          entry.edited_at = Date.now()
          lines[hit] = JSON.stringify(entry)
          const tmp = `${target}.tmp-${process.pid}`
          try {
            fs.writeFileSync(tmp, lines.join('\n'), 'utf8')
            fs.renameSync(tmp, target)
          } catch (error) {
            try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
            return json(res, 500, { ok: false, error: `写回失败：${describe(error)}` })
          }
          return json(res, 200, { ok: true, id, file, backup })
        }
        json(res, 404, { ok: false, error: `没找到记忆 ${id}` })
      })

      // 删除一条日记记忆：从 diary/*.jsonl 里整行移除，删前先备份原文件。
      register(ROUTES.diaryDelete, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' })
        if (!isLocal(req)) return json(res, 403, { ok: false, error: '只允许本机' })
        const body = await readBody(req)
        const id = String(body?.id || '')
        if (!/^d_\d{8}_\d+$/.test(id)) return json(res, 400, { ok: false, error: '记忆 id 不合法' })

        const dir = path.join(DIARY_DIR, 'diary')
        let files = []
        try {
          files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
        } catch (error) {
          return json(res, 500, { ok: false, error: `读不到记忆目录：${describe(error)}` })
        }

        for (const file of files) {
          const target = path.join(dir, file)
          let raw
          try {
            raw = fs.readFileSync(target, 'utf8')
          } catch {
            continue
          }
          const lines = raw.split(/\r?\n/)
          let hit = -1
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()
            if (!line) continue
            let parsed
            try {
              parsed = JSON.parse(line)
            } catch {
              continue
            }
            if (String(parsed?.id) !== id) continue
            hit = i
            break
          }
          if (hit < 0) continue

          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const backupDir = path.join(DIARY_DIR, 'backups')
          let backup = ''
          try {
            fs.mkdirSync(backupDir, { recursive: true })
            backup = path.join(backupDir, `${stamp}-${file}`)
            fs.copyFileSync(target, backup)
          } catch (error) {
            return json(res, 500, { ok: false, error: `备份失败：${describe(error)}` })
          }

          lines.splice(hit, 1)
          const tmp = `${target}.tmp-${process.pid}`
          try {
            fs.writeFileSync(tmp, lines.join('\n'), 'utf8')
            fs.renameSync(tmp, target)
          } catch (error) {
            try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
            return json(res, 500, { ok: false, error: `写回失败：${describe(error)}` })
          }
          return json(res, 200, { ok: true, id, file, backup })
        }
        json(res, 404, { ok: false, error: `没找到记忆 ${id}` })
      })

      // 用系统默认浏览器打开一个本机服务页面（Electron 的 window.open 会被窗口策略拦）。
      // 只放行控制台自己列出的两个地址，避免变成任意 URL 启动器。
      register(ROUTES.openUrl, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' })
        const body = await readBody(req)
        const requested = String(body?.url || '').trim()
        const allowed = ['http://127.0.0.1:5099', 'http://127.0.0.1:3100', 'http://localhost:5099', 'http://localhost:3100']
        const target = allowed.find((prefix) => requested === prefix || requested.startsWith(`${prefix}/`))
        if (!target) return json(res, 400, { ok: false, error: `不允许的地址：${requested}` })
        const launch = (command, args) => {
          const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
          // spawn 的失败是异步事件；不挂监听会把整个进程带崩。
          child.on('error', () => {})
          child.unref()
          return child
        }
        const fallback = () => {
          try {
            launch('rundll32.exe', ['url.dll,FileProtocolHandler', target])
            return true
          } catch {
            return false
          }
        }
        try {
          const child = launch('cmd.exe', ['/c', 'start', '', target])
          // 关联被改坏时 start 会静默失败（退出码非 0），再走一次协议处理器。
          child.once('exit', (code) => {
            if (code !== 0) fallback()
          })
        } catch (error) {
          if (!fallback()) return json(res, 500, { ok: false, error: describe(error) })
        }
        json(res, 200, { ok: true, target })
      })

      // ── QQ 空间动态：转发给桥接（用控制台令牌，等于主人操作，不受配额限制） ──
      const consoleTokenNow = () => {
        try {
          return fs.readFileSync(paths.consoleTokenFile, 'utf8').trim()
        } catch {
          return ''
        }
      }
      const BRIDGE_HTTP = 'http://127.0.0.1:3100'

      register(ROUTES.moment, async (req, res) => {
        if (String(req.method).toUpperCase() !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' })
        const body = await readBody(req)
        const content = String(body?.content ?? '').trim()
        if (!content) return json(res, 400, { ok: false, error: 'content 不能为空' })
        try {
          const r = await fetch(`${BRIDGE_HTTP}/api/socialV2/post-moment`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-console-token': consoleTokenNow() },
            body: JSON.stringify({ content }),
            signal: AbortSignal.timeout(45000),
          })
          const data = await r.json().catch(() => ({}))
          json(res, r.status, data)
        } catch (error) {
          json(res, 500, { ok: false, error: `转发失败：${describe(error)}` })
        }
      })

      register(ROUTES.moments, async (req, res) => {
        try {
          let query = ''
          try {
            const u = new URL(String(req.url || ''), 'http://127.0.0.1')
            query = u.search || ''
          } catch {
            /* 无参数 */
          }
          const r = await fetch(`${BRIDGE_HTTP}/api/socialV2/moments${query}`, {
            headers: { 'x-console-token': consoleTokenNow() },
            signal: AbortSignal.timeout(45000),
          })
          const data = await r.json().catch(() => ({}))
          json(res, r.status, data)
        } catch (error) {
          json(res, 500, { ok: false, error: `转发失败：${describe(error)}` })
        }
      })

      register(ROUTES.momentReset, async (req, res) => {
        try {
          atomicWrite(path.join(paths.stateDir, 'qzone-state.json'), `${JSON.stringify({ lastAt: 0, byDay: {} })}\n`)
          json(res, 200, { ok: true, message: '动态配额已清零（间隔与每日条数）' })
        } catch (error) {
          json(res, 500, { ok: false, error: describe(error) })
        }
      })

      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* 卸载失败不影响进程退出 */
          }
        }
      }
    })
  })

  log(`已挂载，配置目录 ${paths.bridgeDir}`)
}
