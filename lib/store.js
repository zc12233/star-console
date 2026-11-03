/**
 * 文件层：bridge 的 config.json / roles / current-role.json。
 *
 * 所有写操作都走「备份 → 临时文件 → rename」，避免写一半把桥接配置弄坏。
 * 路径默认指向本机实际安装位置，可用插件 config 覆盖（见 lib/index.js）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// 默认指向用户目录下的占位路径；实际部署时用插件 config（bridgeDir / snowlumaDir）覆盖。
export const DEFAULT_PATHS = {
  bridgeDir: path.join(os.homedir(), '.star-console', 'bridge'),
  snowlumaDir: path.join(os.homedir(), '.star-console', 'gateway'),
}

export function resolvePaths(overrides = {}) {
  const bridgeDir = String(overrides.bridgeDir || DEFAULT_PATHS.bridgeDir)
  return {
    bridgeDir,
    configFile: path.join(bridgeDir, 'config.json'),
    stateDir: path.join(bridgeDir, 'state'),
    rolesDir: path.join(bridgeDir, 'roles'),
    backupDir: path.join(bridgeDir, 'backups'),
    consoleTokenFile: path.join(bridgeDir, 'state', 'console-token'),
    currentRoleFile: path.join(bridgeDir, 'state', 'current-role.json'),
    snowlumaDir: String(overrides.snowlumaDir || DEFAULT_PATHS.snowlumaDir),
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function atomicWrite(file, text) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

export function readConfig(paths) {
  const cfg = readJson(paths.configFile, null)
  if (!cfg || typeof cfg !== 'object') throw new Error(`读不到桥接配置：${paths.configFile}`)
  return cfg
}

export function writeConfig(paths, cfg) {
  atomicWrite(paths.configFile, `${JSON.stringify(cfg, null, 2)}\n`)
}

/** 备份 config + roles + current-role 到 backups/<时间戳>/。 */
export function backupAll(paths, reason = 'manual') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = path.join(paths.backupDir, `${stamp}-${reason}`)
  fs.mkdirSync(target, { recursive: true })
  for (const [src, name] of [
    [paths.configFile, 'config.json'],
    [paths.currentRoleFile, 'current-role.json'],
  ]) {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, name))
  }
  if (fs.existsSync(paths.rolesDir)) {
    fs.cpSync(paths.rolesDir, path.join(target, 'roles'), { recursive: true })
  }
  return target
}

export function listRoles(paths) {
  if (!fs.existsSync(paths.rolesDir)) return []
  return fs
    .readdirSync(paths.rolesDir)
    .filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md')
    .map((n) => n.slice(0, -3))
}

const ROLE_NAME_RE = /^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .-]{0,39}$/
export function assertRoleName(name) {
  const n = String(name || '').trim()
  if (!ROLE_NAME_RE.test(n) || n === 'README') throw new Error('角色名不合法（1~40 字，不能是 README/系统保留名）')
  return n
}

export function readRole(paths, name) {
  const safe = assertRoleName(name)
  const file = path.join(paths.rolesDir, `${safe}.md`)
  if (!fs.existsSync(file)) throw new Error(`角色不存在：${safe}`)
  return fs.readFileSync(file, 'utf8')
}

export function writeRole(paths, name, content) {
  const safe = assertRoleName(name)
  fs.mkdirSync(paths.rolesDir, { recursive: true })
  atomicWrite(path.join(paths.rolesDir, `${safe}.md`), String(content))
  return safe
}

export function readCurrentRole(paths) {
  const v = readJson(paths.currentRoleFile, { role: null, mode: 'active' })
  return { role: v?.role ?? null, mode: v?.mode ?? 'active' }
}

export function writeCurrentRole(paths, role) {
  atomicWrite(paths.currentRoleFile, `${JSON.stringify({ role: role ?? null, mode: 'active' }, null, 2)}\n`)
}

/** 点分路径取值。 */
export function getPath(obj, key) {
  if (!key || key.includes(':')) return undefined
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
}

/** 点分路径写值（自动建中间对象）。 */
export function setPath(obj, key, value) {
  const parts = String(key).split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {}
    cur = cur[k]
  }
  cur[parts[parts.length - 1]] = value
  return obj
}

/** 深合并（只用于 import 的整树覆盖）。 */
export function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice()
  if (!patch || typeof patch !== 'object') return patch
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v)
  return out
}
