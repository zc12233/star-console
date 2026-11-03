/**
 * 星图控制台 —— Browser 半边（注入式，无构建、无外部依赖）。
 *
 * 结构：launcher → overlay(header / canvas + drawer / footer)
 * 数据：GET bootstrap 拿树与值；改动只进 drafts；SAVE 才 POST apply。
 * 布局：横向 tidy tree（后序算子高、父节点居中），节点用绝对定位 div，连线用 SVG。
 */
(() => {
  'use strict'
  if (window.__BFC_MOUNTED__) return
  window.__BFC_MOUNTED__ = true

  const API = '/star-console/api'
  const NODE_W = 198
  const NODE_H = 44
  const ROOT_W = 156
  const DEPTH_W = 248
  const V_GAP = 16

  // ── 小工具 ────────────────────────────────────────────────────────────
  function h(tag, props, ...kids) {
    const el = document.createElement(tag)
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue
        if (k === 'class') el.className = v
        else if (k === 'text') el.textContent = v
        else if (k === 'html') el.innerHTML = v
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
        else if (k === 'dataset') Object.assign(el.dataset, v)
        else el.setAttribute(k, v === true ? '' : String(v))
      }
    }
    for (const kid of kids.flat()) {
      if (kid === undefined || kid === null || kid === false) continue
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
    }
    return el
  }

  const clone = (v) => (Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  async function api(path, body) {
    const res = await fetch(API + path, body === undefined ? undefined : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let data
    try {
      data = await res.json()
    } catch {
      throw new Error(`接口返回的不是 JSON（HTTP ${res.status}）`)
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `HTTP ${res.status}`)
      err.data = data
      throw err
    }
    return data
  }

  // ── 状态 ──────────────────────────────────────────────────────────────
  const S = {
    boot: null,
    tree: null,
    values: {},
    consumed: {},
    roles: [],
    paths: {},
    origin: '',
    status: null,
    drafts: new Map(),
    collapsed: new Set(),
    selected: null,
    saved: new Set(),
    invalid: new Map(),
    search: '',
    scale: 1,
    tx: 0,
    ty: 0,
    nodeById: new Map(),
    parentById: new Map(),
    keyToNode: new Map(),
    statusTimer: null,
    dataTimer: null,
    autoRefresh: true,
    lastDataAt: 0,
    toastTimer: null,
    overlay: null,
    launcher: null,
    dragging: null,
    focusBranch: null,
    navDragging: false,
    navDragId: null,
    ambient: null,
    ambientStars: [],
    ambientRaf: 0,
    orbit: null,
    orbitPhase: 0,
    orbitPaused: false,
    orbitLastTs: 0,
    focusSky: null,
    scene3d: null,
    texCache: null,
    orbit2d: null,
    belt: [],
    meteors: [],
    nextMeteor: 0,
    navCollapsed: false,
    resizeHooked: false,
  }

  // ── 树索引 ────────────────────────────────────────────────────────────
  function indexTree(node, parentId) {
    S.nodeById.set(node.id, node)
    if (parentId) S.parentById.set(node.id, parentId)
    if (node.fields) for (const f of node.fields) S.keyToNode.set(f.key, node.id)
    if (node.children) for (const c of node.children) indexTree(c, node.id)
  }

  const isBranch = (n) => Array.isArray(n.children) && n.children.length > 0
  const isExpanded = (id) => !S.collapsed.has(id)
  const visibleKids = (n) => (isBranch(n) && isExpanded(n.id) ? n.children : [])

  function branchList() {
    const out = []
    const walk = (n) => {
      if (isBranch(n)) {
        out.push(n.id)
        n.children.forEach(walk)
      }
    }
    if (S.tree) walk(S.tree)
    return out
  }

  function ancestorsOf(id) {
    const out = []
    let cur = S.parentById.get(id)
    while (cur) {
      out.push(cur)
      cur = S.parentById.get(cur)
    }
    return out
  }

  // ── 协议门控 ──────────────────────────────────────────────────────────
  function protocol() {
    // 草稿优先：切到非 onebot11 后要立刻置灰，不等保存
    return S.drafts.get('connection.protocol') ?? S.values['connection.protocol'] ?? 'onebot11'
  }
  function nodeDisabled(id) {
    if (protocol() === 'onebot11') return false
    return id === 'group' || ancestorsOf(id).includes('group') || id === 'group'
  }

  // ── 改动追踪 ──────────────────────────────────────────────────────────
  function draftCount() {
    return S.drafts.size
  }
  function fieldDirty(key) {
    return S.drafts.has(key)
  }
  function nodeDirtyCount(node) {
    let n = 0
    const walk = (item) => {
      if (item.fields) n += item.fields.filter((f) => S.drafts.has(f.key)).length
      if (item.children) item.children.forEach(walk)
    }
    walk(node)
    return n
  }
  function nodeInvalid(node) {
    let bad = false
    const walk = (item) => {
      if (item.fields) for (const f of item.fields) if (S.invalid.has(f.key)) bad = true
      if (item.children) item.children.forEach(walk)
    }
    walk(node)
    return bad
  }
  function setFieldValue(field, value) {
    const base = S.values[field.key]
    if (same(value, base)) S.drafts.delete(field.key)
    else S.drafts.set(field.key, clone(value))
    S.invalid.delete(field.key)
    S.saved.clear()
    renderCanvas()
    renderFooter()
  }

  // ── 布局 ──────────────────────────────────────────────────────────────
  function layout(root) {
    const pos = new Map()
    const edges = []
    function place(node, depth, top) {
      const w = depth === 0 ? ROOT_W : NODE_W
      const kids = visibleKids(node)
      if (!kids.length) {
        pos.set(node.id, { x: depth * DEPTH_W, y: top, w, h: NODE_H })
        return NODE_H
      }
      let cursor = top
      let total = 0
      for (let i = 0; i < kids.length; i++) {
        const kh = place(kids[i], depth + 1, cursor)
        edges.push({ from: node.id, to: kids[i].id })
        cursor += kh + V_GAP
        total += kh + (i > 0 ? V_GAP : 0)
      }
      const p = pos.get(node.id)
      const selfY = top + (total - NODE_H) / 2
      pos.set(node.id, { x: depth * DEPTH_W, y: selfY, w, h: NODE_H })
      if (p) p.y = selfY
      return total
    }
    place(root, 0, 0)
    let maxX = 0
    let maxY = 0
    for (const p of pos.values()) {
      maxX = Math.max(maxX, p.x + p.w)
      maxY = Math.max(maxY, p.y + p.h)
    }
    return { pos, edges, width: maxX + 200, height: maxY + 160 }
  }

  // ── 渲染：星系画布 ────────────────────────────────────────────────────
  const GALAXY_COLORS = ['#7cc4ff', '#ffb3c8', '#ffd39a', '#8ef0d6', '#c4a9ff', '#ff9f9f', '#a9bcff', '#f7a8ff', '#9fe870', '#ffc46b']

  function hashStr(s) {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }

  function mulberry32(a) {
    return function () {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function gaussRand(rnd) {
    let u = 0
    let v = 0
    while (u === 0) u = rnd()
    while (v === 0) v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  function nebulaArtSVG(node, color) {
    const rnd = mulberry32(hashStr(String(node.id || node.label || 'x')))
    const uid = String(node.id || 'x').replace(/[^a-zA-Z0-9_-]/g, '')

    // 云气：几团错开、很淡的椭圆，不做成一个大光球
    let clouds = ''
    for (let i = 0; i < 5; i++) {
      const cx = 60 + (rnd() - 0.5) * 30
      const cy = 60 + (rnd() - 0.5) * 26
      const rx = 14 + rnd() * 18
      const ry = 9 + rnd() * 13
      const rot = (rnd() - 0.5) * 100
      const op = 0.04 + rnd() * 0.055
      clouds += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rot.toFixed(0)} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="${color}" opacity="${op.toFixed(3)}"/>`
    }

    // 星团主体：中心密、边缘疏的一簇细星
    let stars = ''
    for (let i = 0; i < 120; i++) {
      const r = Math.abs(gaussRand(rnd)) * 14 + 1.5
      const a = rnd() * Math.PI * 2
      const x = 60 + Math.cos(a) * r
      const y = 60 + Math.sin(a) * r * 0.94
      if (x < 3 || x > 117 || y < 3 || y > 117) continue
      const s = Math.max(0.42, (0.5 + (1.3 - r / 34) * 0.9) * (0.55 + rnd() * 0.7))
      const tint = rnd() > 0.62 ? `fill:${color};` : ''
      stars += `<circle class="bfc-const__star" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}" style="${tint}animation-delay:${(rnd() * 4).toFixed(2)}s;animation-duration:${(2.6 + rnd() * 3.4).toFixed(2)}s"/>`
    }

    // 星团里较亮的几颗
    let bright = ''
    for (let i = 0; i < 10; i++) {
      const r = 3 + rnd() * 24
      const a = rnd() * Math.PI * 2
      const x = 60 + Math.cos(a) * r
      const y = 60 + Math.sin(a) * r * 0.94
      bright += `<circle class="bfc-const__anchor" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.1 + rnd() * 1.1).toFixed(1)}" style="animation-delay:${(rnd() * 3).toFixed(2)}s"/>`
    }

    // 很淡的星座连线
    const anchors = []
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i / 4) * Math.PI * 2 + (rnd() - 0.5) * 0.9
      const r = 17 + rnd() * 15
      anchors.push({ x: 60 + Math.cos(a) * r, y: 60 + Math.sin(a) * r })
    }
    let lines = ''
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]
      const b = anchors[(i + 1) % anchors.length]
      lines += `<line class="bfc-const__link" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`
    }

    // 小星河：更淡、更细的一条尘带
    let dust = ''
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2
      const x = 60 + Math.cos(t) * (33 + (rnd() - 0.5) * 8)
      const y = 60 + Math.sin(t) * (4.5 + (rnd() - 0.5) * 2.6)
      dust += `<circle class="bfc-const__dust" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.35 + rnd() * 0.55).toFixed(1)}"/>`
    }

    return `<svg class="bfc-const" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="haze-${uid}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.16"/>
          <stop offset="60%" stop-color="${color}" stop-opacity="0.05"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="river-${uid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0"/>
          <stop offset="45%" stop-color="${color}" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="46" fill="url(#haze-${uid})"/>
      ${clouds}
      <g transform="rotate(-24 60 60)">
        <ellipse cx="60" cy="60" rx="38" ry="5.5" fill="url(#river-${uid})" opacity="0.8"/>
        ${dust}
      </g>
      ${lines}
      ${bright}
      ${stars}
    </svg>`
  }
  function rgbaFromHex(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
    if (!m) return `rgba(140,160,255,${a})`
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }

  function planetTexture(key, color, light, dark) {
    const size = 192
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')
    if (!g) return ''
    const cx = size / 2
    const cy = size / 2
    const R = size / 2 - 2
    const base = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.08, cx, cy, R)
    base.addColorStop(0, light)
    base.addColorStop(0.55, color)
    base.addColorStop(1, dark)
    g.fillStyle = base
    g.beginPath()
    g.arc(cx, cy, R, 0, Math.PI * 2)
    g.fill()
    g.save()
    g.beginPath()
    g.arc(cx, cy, R, 0, Math.PI * 2)
    g.clip()
    if (key === 'jupiter' || key === 'saturn') {
      for (let i = 0; i < 30; i++) {
        const y = cy + (Math.random() - 0.5) * R * 1.9
        const h = 2 + Math.random() * R * 0.1
        g.fillStyle = `rgba(0,0,0,${(0.03 + Math.random() * 0.07).toFixed(3)})`
        g.fillRect(cx - R, y, R * 2, h)
        g.fillStyle = `rgba(255,255,255,${(0.02 + Math.random() * 0.05).toFixed(3)})`
        g.fillRect(cx - R, y + h, R * 2, h * 0.6)
      }
      if (key === 'jupiter') {
        g.fillStyle = 'rgba(150,72,42,0.32)'
        g.beginPath()
        g.ellipse(cx + R * 0.32, cy + R * 0.24, R * 0.2, R * 0.11, 0, 0, Math.PI * 2)
        g.fill()
      }
    } else if (key === 'earth') {
      for (let i = 0; i < 7; i++) {
        g.fillStyle = `rgba(${55 + Math.random() * 45},${105 + Math.random() * 45},${65 + Math.random() * 35},${(0.45 + Math.random() * 0.3).toFixed(2)})`
        g.beginPath()
        g.ellipse(cx + (Math.random() - 0.5) * R * 1.5, cy + (Math.random() - 0.5) * R * 1.3, R * (0.1 + Math.random() * 0.22), R * (0.07 + Math.random() * 0.15), Math.random() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
      for (let i = 0; i < 12; i++) {
        g.fillStyle = `rgba(255,255,255,${(0.04 + Math.random() * 0.1).toFixed(3)})`
        g.beginPath()
        g.ellipse(cx + (Math.random() - 0.5) * R * 1.7, cy + (Math.random() - 0.5) * R * 1.5, R * (0.08 + Math.random() * 0.2), R * (0.03 + Math.random() * 0.06), Math.random() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = 'rgba(240,248,255,0.7)'
      g.beginPath()
      g.ellipse(cx, cy - R * 0.92, R * 0.5, R * 0.13, 0, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.ellipse(cx, cy + R * 0.93, R * 0.45, R * 0.12, 0, 0, Math.PI * 2)
      g.fill()
    } else if (key === 'mars') {
      for (let i = 0; i < 46; i++) {
        g.fillStyle = `rgba(${85 + Math.random() * 60},${42 + Math.random() * 30},${24 + Math.random() * 20},${(0.08 + Math.random() * 0.2).toFixed(2)})`
        g.beginPath()
        g.ellipse(cx + (Math.random() - 0.5) * R * 1.9, cy + (Math.random() - 0.5) * R * 1.9, R * (0.02 + Math.random() * 0.12), R * (0.02 + Math.random() * 0.08), Math.random() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = 'rgba(240,244,250,0.55)'
      g.beginPath()
      g.ellipse(cx, cy - R * 0.93, R * 0.38, R * 0.09, 0, 0, Math.PI * 2)
      g.fill()
    } else if (key === 'mercury' || key === 'moon' || key === 'pluto') {
      for (let i = 0; i < 80; i++) {
        const cr = R * (0.015 + Math.random() * 0.06)
        const x = cx + (Math.random() - 0.5) * R * 1.9
        const y = cy + (Math.random() - 0.5) * R * 1.9
        g.fillStyle = `rgba(50,50,56,${(0.12 + Math.random() * 0.28).toFixed(2)})`
        g.beginPath()
        g.arc(x, y, cr, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = 'rgba(255,255,255,0.07)'
        g.stroke()
      }
    } else {
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(0,0,0,${(0.02 + Math.random() * 0.05).toFixed(3)})`
        g.beginPath()
        g.ellipse(cx + (Math.random() - 0.5) * R * 1.9, cy + (Math.random() - 0.5) * R * 1.7, R * (0.06 + Math.random() * 0.18), R * (0.02 + Math.random() * 0.05), 0, 0, Math.PI * 2)
        g.fill()
      }
    }
    for (let i = 0; i < 2400; i++) {
      g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${(Math.random() * 0.05).toFixed(3)})`
      g.fillRect(cx - R + Math.random() * R * 2, cy - R + Math.random() * R * 2, 1, 1)
    }
    g.restore()
    return c.toDataURL()
  }
  function nebulaTexture(node, color, size) {
    size = size || 300
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')
    if (!g) return c
    const cx = size / 2
    const cy = size / 2
    const hues = [color, '#8a5cff', '#5aa8ff', '#ff6fb0', '#3ad6c8', '#ffd27a']
    // 彩色星云团
    for (let i = 0; i < 26; i++) {
      const x = cx + (Math.random() - 0.5) * size * 0.95
      const y = cy + (Math.random() - 0.5) * size * 0.95
      const r = size * (0.07 + Math.random() * 0.22)
      const hue = hues[Math.floor(Math.random() * hues.length)]
      const grd = g.createRadialGradient(x, y, 0, x, y, r)
      grd.addColorStop(0, rgbaFromHex(hue, 0.16 + Math.random() * 0.22))
      grd.addColorStop(1, rgbaFromHex(hue, 0))
      g.fillStyle = grd
      g.fillRect(0, 0, size, size)
    }
    // 丝状纤维
    g.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 44; i++) {
      const hue = hues[Math.floor(Math.random() * hues.length)]
      g.strokeStyle = rgbaFromHex(hue, 0.05 + Math.random() * 0.06)
      g.lineWidth = 1 + Math.random() * 3
      const a0 = Math.random() * Math.PI * 2
      const r0 = size * (0.08 + Math.random() * 0.2)
      g.beginPath()
      g.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0)
      g.quadraticCurveTo(
        cx + (Math.random() - 0.5) * size * 0.7,
        cy + (Math.random() - 0.5) * size * 0.7,
        cx + (Math.random() - 0.5) * size * 0.9,
        cy + (Math.random() - 0.5) * size * 0.9)
      g.stroke()
    }
    g.globalCompositeOperation = 'source-over'
    // 亮核
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, size * 0.42)
    core.addColorStop(0, 'rgba(255,255,255,0.9)')
    core.addColorStop(0.18, rgbaFromHex(color, 0.5))
    core.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = core
    g.fillRect(0, 0, size, size)
    // 内嵌星点
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      g.fillStyle = `rgba(255,255,255,${(0.25 + Math.random() * 0.6).toFixed(3)})`
      const s = Math.random() > 0.9 ? 1.4 : 0.7
      g.fillRect(x, y, s, s)
    }
    return c
  }
  function nebulaArtEl(node, color) {
    const wrap = h('span', { class: 'bfc-nebula__art' })
    wrap.innerHTML = nebulaArtSVG(node, color)
    return wrap
  }
  function galaxyBranches() {
    const kids = Array.isArray(S.tree?.children) ? S.tree.children : []
    return kids.filter((n) => n && (isBranch(n) || n.view?.kind === 'starmap' || n.action || Array.isArray(n.fields)))
  }

  function toggleNav() {
    const main = S.overlay?.querySelector('.bfc-main')
    if (!main) return
    S.navCollapsed = !S.navCollapsed
    main.classList.toggle('nav-collapsed', S.navCollapsed)
    const btn = S.overlay.querySelector('.bfc-nav__toggle')
    if (btn) btn.textContent = S.navCollapsed ? '»' : '«'
    try {
      localStorage.setItem('bfc-nav-collapsed', S.navCollapsed ? '1' : '0')
    } catch {
      /* 隐私模式写不了就算了 */
    }
  }

  function navOrder() {
    try {
      const raw = JSON.parse(localStorage.getItem('bfc-nav-order') || '[]')
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  }

  function orderedBranches() {
    const list = galaxyBranches()
    const order = navOrder()
    if (!order.length) return list
    const rank = new Map(order.map((id, i) => [id, i]))
    return list.slice().sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : 9999
      const rb = rank.has(b.id) ? rank.get(b.id) : 9999
      return ra - rb
    })
  }

  function persistNavOrder() {
    const list = S.overlay?.querySelector('.bfc-nav__list')
    if (!list) return
    const ids = Array.from(list.querySelectorAll('.bfc-nav__item[data-id]')).map((el) => el.getAttribute('data-id'))
    try {
      localStorage.setItem('bfc-nav-order', JSON.stringify(ids))
    } catch {
      /* 隐私模式写不了就算了 */
    }
    renderCanvas()
  }

  function dragAfter(list, y) {
    const items = Array.from(list.querySelectorAll('.bfc-nav__item[data-id]:not(.is-dragging)'))
    let closest = null
    let closestOffset = Number.NEGATIVE_INFINITY
    for (const el of items) {
      const box = el.getBoundingClientRect()
      const offset = y - box.top - box.height / 2
      if (offset < 0 && offset > closestOffset) {
        closestOffset = offset
        closest = el
      }
    }
    return closest
  }

  function bindNavDrag(list) {
    if (!list) return
    list.addEventListener('dragover', (ev) => {
      if (!S.navDragId) return
      ev.preventDefault()
      const dragging = list.querySelector('.bfc-nav__item.is-dragging')
      if (!dragging) return
      const after = dragAfter(list, ev.clientY)
      if (!after) list.appendChild(dragging)
      else list.insertBefore(dragging, after)
    })
    list.addEventListener('drop', (ev) => ev.preventDefault())
  }

  function spawnParticles(nebula, color) {
    const layer = nebula.querySelector('.bfc-particles')
    if (!layer) return
    layer.innerHTML = ''
    for (let i = 0; i < 16; i++) {
      const p = h('i', { class: 'bfc-particle' })
      const a = Math.random() * Math.PI * 2
      const r = 30 + Math.random() * 55
      p.style.setProperty('--dx', `${(Math.cos(a) * r).toFixed(1)}px`)
      p.style.setProperty('--dy', `${(Math.sin(a) * r - 18).toFixed(1)}px`)
      p.style.setProperty('--dur', `${Math.round(900 + Math.random() * 1100)}ms`)
      p.style.setProperty('--delay', `${Math.round(Math.random() * 600)}ms`)
      p.style.setProperty('--size', `${(1 + Math.random() * 1.8).toFixed(1)}px`)
      p.style.background = color
      p.style.boxShadow = `0 0 8px ${color}`
      layer.append(p)
    }
  }

  function playZoom(dir) {
    const stage = S.overlay?.querySelector('.bfc-galaxy')
    if (!stage) return
    stage.classList.remove('is-zoom-in', 'is-zoom-out')
    void stage.offsetWidth
    stage.classList.add(dir === 'in' ? 'is-zoom-in' : 'is-zoom-out')
    window.setTimeout(() => stage.classList.remove('is-zoom-in', 'is-zoom-out'), 720)
  }

  function renderNav() {
    if (!S.overlay) return
    const list = S.overlay.querySelector('.bfc-nav__list')
    const foot = S.overlay.querySelector('.bfc-nav__foot')
    if (!list) return
    list.innerHTML = ''
    const branches = orderedBranches()
    const search = S.search.trim().toLowerCase()
    branches.forEach((node, i) => {
      const color = GALAXY_COLORS[i % GALAXY_COLORS.length]
      const active = S.focusBranch === node.id
      const hit = !search || (node.label || '').toLowerCase().includes(search)
      const item = h('button', {
        class: `bfc-nav__item${active ? ' is-active' : ''}${hit ? '' : ' is-dim'}`,
        type: 'button',
        title: `${node.label} · 可拖拽排序`,
        draggable: 'true',
        'data-id': node.id,
        style: { '--c': color },
        onclick: () => {
          if (S.navDragging) return
          focusBranch(node.id)
        },
      },
        h('span', { class: 'bfc-nav__icon', text: node.icon || '✦' }),
        h('span', { class: 'bfc-nav__label', text: node.label }),
        h('span', { class: 'bfc-nav__count', text: String(isBranch(node) ? node.children.length : 1) }))
      item.addEventListener('dragstart', (ev) => {
        S.navDragging = true
        S.navDragId = node.id
        item.classList.add('is-dragging')
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'move'
          try {
            ev.dataTransfer.setData('text/plain', node.id)
          } catch {
            /* 某些环境不允许 setData */
          }
        }
      })
      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging')
        S.navDragId = null
        persistNavOrder()
        setTimeout(() => {
          S.navDragging = false
        }, 240)
      })
      list.append(item)
    })
    if (foot) {
      foot.innerHTML = ''
      foot.append(h('button', { class: 'bfc-nav__item bfc-nav__item--muted', title: '退出控制台', onclick: closeConsole },
        h('span', { class: 'bfc-nav__icon', text: '↩' }),
        h('span', { class: 'bfc-nav__label', text: '退出控制台' })))
    }
  }
  function paintGalaxySky(canvas, W, H) {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = g.createRadialGradient(W * 0.5, H * 0.46, 0, W * 0.5, H * 0.46, Math.max(W, H) * 0.8)
    bg.addColorStop(0, '#0b1224')
    bg.addColorStop(0.45, '#060a16')
    bg.addColorStop(1, '#02030a')
    g.fillStyle = bg
    g.fillRect(0, 0, W, H)
    const blobs = [
      [0.16, 0.2, '120,92,255'],
      [0.84, 0.16, '64,148,255'],
      [0.8, 0.84, '255,118,182'],
      [0.18, 0.82, '64,214,206'],
      [0.52, 0.5, '255,196,132'],
    ]
    g.globalCompositeOperation = 'lighter'
    for (const [x, y, rgb] of blobs) {
      const rad = Math.max(W, H) * (0.26 + Math.random() * 0.18)
      const grd = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, rad)
      grd.addColorStop(0, `rgba(${rgb},.075)`)
      grd.addColorStop(0.5, `rgba(${rgb},.025)`)
      grd.addColorStop(1, `rgba(${rgb},0)`)
      g.fillStyle = grd
      g.fillRect(0, 0, W, H)
    }
    const asteroid = (ax, ay, ar) => {
      g.save()
      g.translate(ax, ay)
      g.rotate(Math.random() * Math.PI)
      g.beginPath()
      const segments = 9 + Math.floor(Math.random() * 4)
      for (let k = 0; k < segments; k++) {
        const a = (k / segments) * Math.PI * 2
        const r = ar * (0.68 + Math.random() * 0.34)
        const px = Math.cos(a) * r
        const py = Math.sin(a) * r * 0.86
        if (k === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.closePath()
      g.fillStyle = 'rgba(126,138,164,0.3)'
      g.fill()
      g.strokeStyle = 'rgba(195,210,240,0.32)'
      g.lineWidth = 0.8
      g.stroke()
      for (let k = 0; k < 4; k++) {
        const cx2 = (Math.random() - 0.5) * ar * 1.1
        const cy2 = (Math.random() - 0.5) * ar * 0.85
        const cr = ar * (0.09 + Math.random() * 0.16)
        g.beginPath()
        g.arc(cx2, cy2, cr, 0, Math.PI * 2)
        g.fillStyle = 'rgba(38,46,66,0.34)'
        g.fill()
        g.strokeStyle = 'rgba(180,195,230,0.1)'
        g.stroke()
      }
      g.restore()
    }

    const brightStar = (bx, by, br, rgb) => {
      const glow = g.createRadialGradient(bx, by, 0, bx, by, br * 5)
      glow.addColorStop(0, `rgba(${rgb},0.85)`)
      glow.addColorStop(0.25, `rgba(${rgb},0.28)`)
      glow.addColorStop(1, `rgba(${rgb},0)`)
      g.fillStyle = glow
      g.beginPath()
      g.arc(bx, by, br * 5, 0, Math.PI * 2)
      g.fill()
      g.lineWidth = 1
      for (const [dx, dy, len] of [[1, 0, br * 9], [0, 1, br * 9], [0.7, 0.7, br * 5], [0.7, -0.7, br * 5]]) {
        const grad = g.createLinearGradient(bx, by, bx + dx * len, by + dy * len)
        grad.addColorStop(0, `rgba(${rgb},0.5)`)
        grad.addColorStop(1, `rgba(${rgb},0)`)
        g.strokeStyle = grad
        g.beginPath()
        g.moveTo(bx, by)
        g.lineTo(bx + dx * len, by + dy * len)
        g.stroke()
      }
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(bx, by, br, 0, Math.PI * 2)
      g.fill()
    }

    // 大银河：多层光带 + 核球 + 尘埃带 + 带内密星
    const bandCx = W * 0.5
    const bandCy = H * 0.52
    const bandRot = -0.3
    const bandW = Math.max(W, H) * 1.6
    const bandH = Math.min(H * 0.42, 300)
    const cosR = Math.cos(bandRot)
    const sinR = Math.sin(bandRot)
    g.save()
    g.translate(bandCx, bandCy)
    g.rotate(bandRot)
    const halo = g.createLinearGradient(0, -bandH * 1.3, 0, bandH * 1.3)
    halo.addColorStop(0, 'rgba(120,150,220,0)')
    halo.addColorStop(0.5, 'rgba(150,175,235,0.05)')
    halo.addColorStop(1, 'rgba(120,150,220,0)')
    g.fillStyle = halo
    g.fillRect(-bandW, -bandH * 1.3, bandW * 2, bandH * 2.6)
    for (const [off, a, h] of [[-0.34, 0.05, 0.62], [-0.12, 0.075, 0.55], [0.12, 0.075, 0.55], [0.34, 0.05, 0.62], [0, 0.1, 0.42]]) {
      const y0 = (off - h) * bandH
      const y1 = (off + h) * bandH
      const grd = g.createLinearGradient(0, y0, 0, y1)
      grd.addColorStop(0, 'rgba(150,175,255,0)')
      grd.addColorStop(0.35, `rgba(178,196,255,${(a * 0.5).toFixed(3)})`)
      grd.addColorStop(0.5, `rgba(224,233,255,${a})`)
      grd.addColorStop(0.65, `rgba(178,196,255,${(a * 0.5).toFixed(3)})`)
      grd.addColorStop(1, 'rgba(150,175,255,0)')
      g.fillStyle = grd
      g.fillRect(-bandW, y0, bandW * 2, y1 - y0)
    }
    const bulge = g.createRadialGradient(-bandW * 0.12, 0, 0, -bandW * 0.12, 0, bandH * 1.15)
    bulge.addColorStop(0, 'rgba(255,236,205,0.15)')
    bulge.addColorStop(0.4, 'rgba(235,215,190,0.06)')
    bulge.addColorStop(1, 'rgba(235,215,190,0)')
    g.fillStyle = bulge
    g.fillRect(-bandW, -bandH * 1.2, bandW * 2, bandH * 2.4)
    for (const [off, w, a] of [[-0.07, 0.09, 0.32], [0.1, 0.05, 0.22]]) {
      const y0 = (off - w) * bandH
      const y1 = (off + w) * bandH
      const dust = g.createLinearGradient(0, y0, 0, y1)
      dust.addColorStop(0, 'rgba(4,5,12,0)')
      dust.addColorStop(0.5, `rgba(4,5,12,${a})`)
      dust.addColorStop(1, 'rgba(4,5,12,0)')
      g.fillStyle = dust
      g.fillRect(-bandW, y0, bandW * 2, y1 - y0)
    }
    g.restore()
    for (let i = 0; i < 3200; i++) {
      const lx = (Math.random() - 0.5) * bandW
      const ly = (Math.random() - 0.5) * bandH * (0.35 + Math.random() * 1.2)
      const x = bandCx + lx * cosR - ly * sinR
      const y = bandCy + lx * sinR + ly * cosR
      if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue
      const warm = Math.random() > 0.88
      const a = 0.1 + Math.random() * 0.5
      const s = Math.random() > 0.965 ? 1.5 : 0.7
      g.fillStyle = warm ? `rgba(255,226,190,${a.toFixed(3)})` : `rgba(214,228,255,${a.toFixed(3)})`
      g.fillRect(x, y, s, s)
    }
    // 蓝紫星云：错开的多层
    const nebulae = [
      [0.24, 0.3, '96,96,255', 0.09],
      [0.76, 0.68, '138,84,220', 0.08],
      [0.6, 0.18, '64,120,255', 0.075],
      [0.3, 0.8, '70,110,210', 0.06],
    ]
    for (const [nx, ny, rgb, alpha] of nebulae) {
      for (let k = 0; k < 3; k++) {
        const ox = W * nx + (Math.random() - 0.5) * W * 0.14
        const oy = H * ny + (Math.random() - 0.5) * H * 0.14
        const rad = Math.max(W, H) * (0.15 + Math.random() * 0.16)
        const grd = g.createRadialGradient(ox, oy, 0, ox, oy, rad)
        grd.addColorStop(0, `rgba(${rgb},${alpha})`)
        grd.addColorStop(0.55, `rgba(${rgb},${alpha * 0.35})`)
        grd.addColorStop(1, `rgba(${rgb},0)`)
        g.fillStyle = grd
        g.fillRect(0, 0, W, H)
      }
    }
    // 远景星：多、暗、小
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(220,230,255,${(0.03 + Math.random() * 0.16).toFixed(3)})`
      g.fillRect(Math.random() * W, Math.random() * H, 0.6, 0.6)
    }
    // 中景星：白、蓝、暖三色
    const tints = ['226,238,255', '150,190,255', '255,214,180', '255,186,158']
    for (let i = 0; i < 650; i++) {
      const t = tints[Math.floor(Math.random() * tints.length)]
      const a = 0.12 + Math.random() * 0.45
      const s = Math.random() > 0.9 ? 1.4 : 0.9
      g.fillStyle = `rgba(${t},${a.toFixed(3)})`
      g.fillRect(Math.random() * W, Math.random() * H, s, s)
    }
    // 近景亮星
    for (let i = 0; i < 110; i++) {
      g.fillStyle = `rgba(235,242,255,${(0.3 + Math.random() * 0.5).toFixed(3)})`
      g.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4)
    }
    // 亮星：四芒
    for (let i = 0; i < 18; i++) {
      const rgb = Math.random() > 0.7 ? '180,205,255' : '240,244,255'
      brightStar(Math.random() * W, Math.random() * H, 0.9 + Math.random() * 1.1, rgb)
    }
    // 小行星带：带陨石坑
    for (let i = 0; i < 12; i++) {
      asteroid(W * (0.08 + Math.random() * 0.84), H * (0.1 + Math.random() * 0.8), 3 + Math.random() * 9)
    }
    // 星际碎石
    for (let i = 0; i < 80; i++) {
      g.fillStyle = `rgba(160,175,205,${(0.05 + Math.random() * 0.15).toFixed(3)})`
      g.fillRect(Math.random() * W, Math.random() * H, 0.5 + Math.random() * 1.1, 0.5 + Math.random() * 1.1)
    }    g.globalCompositeOperation = 'source-over'
  }

  function makeAmbientStars(W, H) {
    const list = []
    for (let i = 0; i < 240; i++) {
      list.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() > 0.94 ? 1.6 : 0.8,
        base: 0.08 + Math.random() * 0.55,
        speed: 0.5 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
      })
    }
    return list
  }

  function makeFocusSky(W, H, id) {
    const rnd = mulberry32(hashStr('sky-' + String(id || 'x')))
    const cx = W * 0.5
    const cy = H * 0.5
    const rot = -0.36
    const bandW = Math.max(W, H) * 1.1
    const bandH = Math.min(H * 0.26, 210)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const bandStars = []
    for (let i = 0; i < 520; i++) {
      const lx = (rnd() - 0.5) * bandW * 1.7
      const ly = gaussRand(rnd) * bandH * 0.52
      const x = cx + lx * cos - ly * sin
      const y = cy + lx * sin + ly * cos
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue
      bandStars.push({
        x,
        y,
        size: rnd() > 0.94 ? 1.6 : 0.8,
        base: 0.16 + rnd() * 0.6,
        speed: 0.4 + rnd() * 1.4,
        phase: rnd() * Math.PI * 2,
        warm: rnd() > 0.86,
      })
    }
    const clouds = []
    const palette = ['120,110,255', '70,150,255', '255,120,190', '70,210,200']
    for (let i = 0; i < 4; i++) {
      clouds.push({
        x: W * (0.1 + rnd() * 0.8),
        y: H * (0.1 + rnd() * 0.72),
        r: 150 + rnd() * 220,
        rgb: palette[i % palette.length],
        a: 0.04 + rnd() * 0.035,
        phase: rnd() * Math.PI * 2,
      })
    }
    const constellations = []
    const groupAt = (gx, gy, n) => {
      const stars = []
      let ang = -0.4 + rnd() * 0.8
      let x = gx
      let y = gy
      for (let i = 0; i < n; i++) {
        stars.push({ x, y, r: 0.9 + rnd() * 1.2, phase: rnd() * Math.PI * 2, a: 0.5 + rnd() * 0.4 })
        ang += (rnd() - 0.5) * 1.2
        const len = 44 + rnd() * 64
        x += Math.cos(ang) * len
        y += Math.sin(ang) * len
      }
      return { stars, alpha: 0.14 + rnd() * 0.08 }
    }
    constellations.push(groupAt(W * 0.16, H * 0.72, 7))
    constellations.push(groupAt(W * 0.7, H * 0.16, 6))
    return { cx, cy, rot, bandW, bandH, bandStars, clouds, constellations }
  }
  function drawAmbient(ts) {
    const canvas = S.ambient
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas._w || 0
    const H = canvas._h || 0
    if (!ctx || !W || !H) return
    ctx.clearRect(0, 0, W, H)
    const t = ts / 1000

    for (const s of S.ambientStars) {
      const a = s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase))
      ctx.fillStyle = `rgba(220,232,255,${Math.max(0.02, a).toFixed(3)})`
      const x = s.x + Math.sin(t * 0.055 + s.phase) * 7
      const y = s.y + Math.cos(t * 0.045 + s.phase) * 5
      ctx.fillRect(x, y, s.r, s.r)
    }

    if (!S.nextMeteor) S.nextMeteor = t + 1.8 + Math.random() * 3
    if (t >= S.nextMeteor) {
      const ang = Math.PI * 0.25 + Math.random() * Math.PI * 0.55
      const sp = 430 + Math.random() * 380
      S.meteors.push({ sx: Math.random() * W * 0.6 + W * 0.2, sy: Math.random() * H * 0.3, dx: Math.cos(ang), dy: Math.sin(ang), sp, t0: t })
      S.nextMeteor = t + 2.4 + Math.random() * 4
    }
    S.meteors = S.meteors.filter((m) => t - m.t0 < 1.5)
    for (const m of S.meteors) {
      const dt2 = t - m.t0
      const x = m.sx + m.dx * m.sp * dt2
      const y = m.sy + m.dy * m.sp * dt2
      const tx = x - m.dx * 100
      const ty = y - m.dy * 100
      const grd = ctx.createLinearGradient(x, y, tx, ty)
      grd.addColorStop(0, 'rgba(255,255,255,.85)')
      grd.addColorStop(0.25, 'rgba(180,205,255,.45)')
      grd.addColorStop(1, 'rgba(180,205,255,0)')
      ctx.strokeStyle = grd
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(tx, ty)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,.95)'
      ctx.beginPath()
      ctx.arc(x, y, 1.3, 0, Math.PI * 2)
      ctx.fill()
    }

    if (!S.focusBranch && S.belt && S.belt.length) {
      const bccx = W * 0.5
      const bccy = H * 0.5
      const bRx = Math.min(W * 0.36, 560)
      const bRy = Math.min(H * 0.34, 320)
      for (const r of S.belt) {
        const ang = r.base + t * 0.02
        const x = bccx + Math.cos(ang) * bRx * 0.62 * r.rr
        const y = bccy + Math.sin(ang) * bRy * 0.62 * r.rr
        ctx.fillStyle = `rgba(${r.rgb},${(r.a * 0.55).toFixed(3)})`
        ctx.fillRect(x, y, r.s, r.s)
      }
    }
    if (!S.focusBranch) return
    const sky = S.focusSky
    if (!sky) return

    for (const c of sky.clouds) {
      const drift = Math.sin(t * 0.04 + c.phase) * 12
      const grd = ctx.createRadialGradient(c.x + drift, c.y, 0, c.x + drift, c.y, c.r)
      grd.addColorStop(0, `rgba(${c.rgb},${c.a.toFixed(3)})`)
      grd.addColorStop(0.5, `rgba(${c.rgb},${(c.a * 0.4).toFixed(3)})`)
      grd.addColorStop(1, `rgba(${c.rgb},0)`)
      ctx.fillStyle = grd
      ctx.beginPath()
      ctx.arc(c.x + drift, c.y, c.r, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.save()
    ctx.translate(sky.cx, sky.cy)
    ctx.rotate(sky.rot)
    const bh = sky.bandH
    const layers = [
      { off: -bh * 0.34, a: 0.085, h: bh * 0.5 },
      { off: 0, a: 0.12, h: bh * 0.42 },
      { off: bh * 0.34, a: 0.075, h: bh * 0.5 },
    ]
    for (const layer of layers) {
      const grd = ctx.createLinearGradient(0, layer.off - layer.h, 0, layer.off + layer.h)
      grd.addColorStop(0, 'rgba(150,175,255,0)')
      grd.addColorStop(0.38, `rgba(170,190,255,${(layer.a * 0.5).toFixed(3)})`)
      grd.addColorStop(0.5, `rgba(210,222,255,${layer.a.toFixed(3)})`)
      grd.addColorStop(0.62, `rgba(170,190,255,${(layer.a * 0.5).toFixed(3)})`)
      grd.addColorStop(1, 'rgba(150,175,255,0)')
      ctx.fillStyle = grd
      ctx.fillRect(-sky.bandW, layer.off - layer.h, sky.bandW * 2, layer.h * 2)
    }
    const dust = ctx.createLinearGradient(0, -bh * 0.13, 0, bh * 0.13)
    dust.addColorStop(0, 'rgba(2,4,10,0)')
    dust.addColorStop(0.5, 'rgba(2,4,10,0.34)')
    dust.addColorStop(1, 'rgba(2,4,10,0)')
    ctx.fillStyle = dust
    ctx.fillRect(-sky.bandW, -bh * 0.13, sky.bandW * 2, bh * 0.26)
    ctx.restore()

    for (const s of sky.bandStars) {
      const a = s.base * (0.6 + 0.4 * Math.sin(t * s.speed + s.phase))
      ctx.fillStyle = s.warm ? `rgba(255,226,190,${a.toFixed(3)})` : `rgba(226,238,255,${a.toFixed(3)})`
      ctx.fillRect(s.x, s.y, s.size, s.size)
    }

    for (const c of sky.constellations) {
      ctx.strokeStyle = `rgba(170,195,255,${c.alpha.toFixed(3)})`
      ctx.lineWidth = 0.7
      ctx.beginPath()
      c.stars.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.stroke()
      for (const p of c.stars) {
        const a = p.a * (0.65 + 0.35 * Math.sin(t * 0.7 + p.phase))
        ctx.fillStyle = `rgba(240,246,255,${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  function stepOrbit(ts) {
    if (S.orbit && !S.orbitPaused) {
      const dt = Math.min(0.06, (ts - (S.orbitLastTs || ts)) / 1000)
      S.orbitPhase += dt * 0.08
    }
    S.orbitLastTs = ts
    if (!S.orbit) return
    S.orbit.items.forEach((it, i) => {
      const a = it.base + S.orbitPhase
      const x = S.orbit.cx + Math.cos(a) * S.orbit.rx
      const y = S.orbit.cy + Math.sin(a) * S.orbit.ry
      it.el.style.left = `${x.toFixed(1)}px`
      it.el.style.top = `${y.toFixed(1)}px`
      const line = S.orbit.lines && S.orbit.lines[i]
      if (line) {
        line.setAttribute('x2', x.toFixed(1))
        line.setAttribute('y2', y.toFixed(1))
      }
    })
  }

  function stepScene3D(ts) {
    const scene = S.scene3d
    if (!scene || !S.overlay) return
    const t = ts / 1000
    for (const n of scene.nodes) {
      const ang = n.base + t * n.speed
      const x = scene.cx + Math.cos(ang) * scene.rx * n.radius
      const y = scene.cy + Math.sin(ang) * scene.ry * n.radius
      const z = (Math.sin(ang) + 1) / 2
      const scale = 0.86 + z * 0.22
      n.el.style.left = `${x.toFixed(1)}px`
      n.el.style.top = `${y.toFixed(1)}px`
      n.el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`
      n.el.style.zIndex = String(100 + Math.round(z * 220))
      n.ball.style.opacity = (0.62 + z * 0.38).toFixed(3)
      if (n.label) n.label.style.opacity = (0.82 + z * 0.18).toFixed(3)
    }
  }
  function stepOrbit2D(ts) {
    const o = S.orbit2d
    if (!o || !S.overlay) return
    const t = ts / 1000
    let earthX = o.cx
    let earthY = o.cy
    for (const p of o.planets) {
      const ang = p.base + t * p.def.speed
      const x = o.cx + Math.cos(ang) * o.rx * p.def.orbit
      const y = o.cy + Math.sin(ang) * o.ry * p.def.orbit
      if (p.node.id === o.earthId) {
        earthX = x
        earthY = y
      }
      if (p.g) p.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
      if (p.grad) {
        const dist = Math.hypot(o.cx - x, o.cy - y) || 1
        p.grad.setAttribute('fx', (((o.cx - x) / dist) * p.def.r * 0.45).toFixed(2))
        p.grad.setAttribute('fy', (((o.cy - y) / dist) * p.def.r * 0.45).toFixed(2))
      }
      if (p.label) {
        p.label.style.left = `${x.toFixed(1)}px`
        p.label.style.top = `${(y + p.def.r + 9).toFixed(1)}px`
      }
    }
    const m = o.moon
    if (m && m.g) {
      const ang = m.base + t * m.def.speed
      const x = earthX + Math.cos(ang) * m.dist
      const y = earthY + Math.sin(ang) * m.dist * 0.9
      m.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
      if (m.grad) {
        const dist = Math.hypot(o.cx - x, o.cy - y) || 1
        m.grad.setAttribute('fx', (((o.cx - x) / dist) * m.def.r * 0.45).toFixed(2))
        m.grad.setAttribute('fy', (((o.cy - y) / dist) * m.def.r * 0.45).toFixed(2))
      }
      if (m.label) {
        m.label.style.left = `${x.toFixed(1)}px`
        m.label.style.top = `${(y + m.def.r + 9).toFixed(1)}px`
      }
    }
  }
  function startAmbient() {
    if (S.ambientRaf) return
    const step = (ts) => {
      S.ambientRaf = requestAnimationFrame(step)
      if (!S.overlay || !S.ambient) return
      drawAmbient(ts)
      stepOrbit(ts)
      stepOrbit2D(ts)
    }
    S.ambientRaf = requestAnimationFrame(step)
  }

  function stopAmbient() {
    if (S.ambientRaf) cancelAnimationFrame(S.ambientRaf)
    S.ambientRaf = 0
  }
  function activateNode(node, ev) {
    if (!node) return
    if (ev) ev.stopPropagation()
    if (node.action) {
      runNodeAction(node)
      return
    }
    if (nodeDisabled(node.id)) {
      toast('当前协议不是 onebot11，群聊规则不可用', 'err')
      return
    }
    S.selected = node
    renderNav()
    renderDrawer()
    if (node.view?.kind === 'starmap') {
      renderCanvas()
      openStarMap()
      return
    }
    if (node.view?.kind === 'diary' || node.view?.kind === 'records') {
      renderCanvas()
      if (node.view.kind === 'records') openRecords()
      else openDiary(node.view.tab || 'diary')
      return
    }
    renderCanvas()
  }

  function focusBranch(id) {
    const node = S.nodeById.get(id)
    if (!node) return
    if (!isBranch(node)) {
      S.focusBranch = null
      activateNode(node)
      return
    }
    S.focusBranch = S.focusBranch === id ? null : id
    if (S.focusBranch) {
      S.selected = node
      renderDrawer()
    }
    renderNav()
    renderCanvas()
    playZoom(S.focusBranch ? 'in' : 'out')
  }

  function renderCanvas() {
    if (!S.overlay) return
    const host = S.overlay.querySelector('.bfc-canvas')
    if (!host) return
    const W = host.clientWidth || 900
    const H = host.clientHeight || 600

    let sky = host.querySelector('.bfc-sky')
    if (!sky) {
      sky = h('canvas', { class: 'bfc-sky' })
      host.append(sky)
    }
    if (sky._w !== W || sky._h !== H) {
      sky._w = W
      sky._h = H
      paintGalaxySky(sky, W, H)
    }

    let ambient = host.querySelector('.bfc-ambient')
    if (!ambient) {
      ambient = h('canvas', { class: 'bfc-ambient' })
      host.append(ambient)
    }
    if (ambient._w !== W || ambient._h !== H) {
      ambient._w = W
      ambient._h = H
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      ambient.width = Math.round(W * dpr)
      ambient.height = Math.round(H * dpr)
      const actx = ambient.getContext('2d')
      if (actx) actx.setTransform(dpr, 0, 0, dpr, 0, 0)
      S.ambientStars = makeAmbientStars(W, H)
    }
    S.ambient = ambient
    startAmbient()

    let stage = host.querySelector('.bfc-galaxy')
    if (!stage) {
      stage = h('div', {
        class: 'bfc-galaxy',
        onclick: () => {
          if (!S.focusBranch) return
          S.focusBranch = null
          renderNav()
          renderCanvas()
          playZoom('out')
        },
      })
      host.append(stage)
    }
    stage.innerHTML = ''
    const branches = orderedBranches()
    const focus = S.focusBranch ? S.nodeById.get(S.focusBranch) : null
    const search = S.search.trim().toLowerCase()

    if (focus && isBranch(focus)) {
      const cx = W * 0.5
      const cy = H * 0.46
      const leaves = focus.children || []
      S.focusSky = makeFocusSky(W, H, focus.id)
      S.scene3d = null
      stage.append(h('button', {
        class: 'bfc-galaxy__back',
        type: 'button',
        text: '← 返回星系',
        onclick: (ev) => {
          ev.stopPropagation()
          S.focusBranch = null
          renderNav()
          renderCanvas()
          playZoom('out')
        },
      }))
      const tex = S.texCache && S.texCache.id === focus.id ? S.texCache.c : nebulaTexture(focus, '#9fc0ff', 320)
      S.texCache = { id: focus.id, c: tex }
      const texEl = h('canvas', { class: 'bfc-nebula__tex' })
      texEl.width = tex.width
      texEl.height = tex.height
      texEl.getContext('2d').drawImage(tex, 0, 0)
      stage.append(h('div', { class: 'bfc-nebula bfc-nebula--focus is-active', style: { left: `${cx}px`, top: `${cy}px`, '--c': '#9fc0ff' } },
        texEl,
        h('span', { class: 'bfc-nebula__glow' }),
        h('span', { class: 'bfc-nebula__icon', text: focus.icon || '✦' }),
        h('span', { class: 'bfc-nebula__cap' },
          h('span', { class: 'bfc-nebula__label', text: focus.label }),
          h('span', { class: 'bfc-nebula__meta', text: `${leaves.length} 个设置 · 点星星编辑` }))))
      if (!leaves.length) {
        stage.append(h('div', { class: 'bfc-galaxy__hint', style: { left: `${cx}px`, top: `${cy + 90}px` }, text: '这个星域还没有可编辑的项' }))
      }
      const RX = Math.min(W * 0.27, 360)
      const RY = Math.min(H * 0.27, 260)
      const pts = leaves.map((leaf, i) => {
        const a = -Math.PI / 2 + (i / Math.max(1, leaves.length)) * Math.PI * 2
        return { x: cx + Math.cos(a) * RX, y: cy + Math.sin(a) * RY }
      })
      const ns = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(ns, 'svg')
      svg.setAttribute('class', 'bfc-galaxy__links')
      svg.setAttribute('width', String(W))
      svg.setAttribute('height', String(H))
      const linkEls = []
      pts.forEach((p) => {
        const line = document.createElementNS(ns, 'line')
        line.setAttribute('x1', String(cx))
        line.setAttribute('y1', String(cy))
        line.setAttribute('x2', String(p.x))
        line.setAttribute('y2', String(p.y))
        line.setAttribute('class', 'bfc-galaxy__link')
        svg.append(line)
        linkEls.push(line)
      })
      stage.append(svg)
      const orbitItems = []
      leaves.forEach((leaf, i) => {
        const { x, y } = pts[i]
        const base = -Math.PI / 2 + (i / Math.max(1, leaves.length)) * Math.PI * 2
        const color = GALAXY_COLORS[i % GALAXY_COLORS.length]
        const dirty = nodeDirtyCount(leaf)
        const cls = ['bfc-leaf-star']
        if (S.selected && S.selected.id === leaf.id) cls.push('is-sel')
        if (dirty > 0) cls.push('is-dirty')
        if (nodeInvalid(leaf)) cls.push('is-bad')
        if (nodeDisabled(leaf.id)) cls.push('is-off')
        if (search && !(leaf.label || '').toLowerCase().includes(search)) cls.push('is-dim')
        const el = h('button', {
          class: cls.join(' '),
          type: 'button',
          style: { left: `${x}px`, top: `${y}px`, '--c': color },
          title: leaf.hint || leaf.label,
          onclick: (ev) => activateNode(leaf, ev),
        },
          h('span', { class: 'bfc-leaf-star__dot' }),
          h('span', { class: 'bfc-leaf-star__label', text: leaf.label }),
          dirty > 0 ? h('em', { class: 'bfc-leaf-star__meta', text: `+${dirty}` }) : null)
        el.addEventListener('pointerenter', () => {
          S.orbitPaused = true
        })
        el.addEventListener('pointerleave', () => {
          S.orbitPaused = false
        })
        stage.append(el)
        orbitItems.push({ el, base })
      })
      S.orbit = { cx, cy, rx: RX, ry: RY, items: orbitItems, lines: linkEls }
      S.orbitPaused = false
    } else {
      S.orbit = null
      S.orbitPaused = false
      S.focusSky = null
      S.scene3d = null
      const cx = W * 0.5
      const cy = H * 0.5
      const RX = Math.min(W * 0.4, 620)
      const RY = Math.min(W * 0.38, 350)

      const PLANET_DEF = {
        connection: { key: 'earth', color: '#3d7ed0', light: '#9fd4ff', dark: '#0e2a52', r: 12, orbit: 0.56, speed: 0.105 },
        behavior: { key: 'mercury', color: '#aaa29a', light: '#efe9e3', dark: '#4e4a46', r: 6, orbit: 0.4, speed: 0.175 },
        voicekit: { key: 'venus', color: '#d8ae6c', light: '#ffe8bd', dark: '#815f2e', r: 8.5, orbit: 0.48, speed: 0.14 },
        group: { key: 'mars', color: '#c05436', light: '#ffb199', dark: '#5e1f12', r: 7.5, orbit: 0.66, speed: 0.088 },
        private: { key: 'jupiter', color: '#c98d5a', light: '#ffd9a8', dark: '#6b3f1f', r: 16, orbit: 0.78, speed: 0.05 },
        persona: { key: 'saturn', color: '#d6bd88', light: '#fff0c9', dark: '#7d683a', r: 13, orbit: 0.88, speed: 0.038, ring: true },
        diary: { key: 'uranus', color: '#87d3d8', light: '#d6ffff', dark: '#336a70', r: 10, orbit: 0.98, speed: 0.028 },
        moments: { key: 'neptune', color: '#4361c4', light: '#9fb6ff', dark: '#161f52', r: 10, orbit: 1.08, speed: 0.021 },
        security: { key: 'pluto', color: '#b09582', light: '#e8d6c6', dark: '#4f3f33', r: 5.5, orbit: 1.18, speed: 0.015 },
        starmap: { key: 'moon', color: '#c9cbd6', light: '#ffffff', dark: '#6c6f7d', r: 4.5, moon: true, speed: 0.9 },
      }

      const defs = []
      const markup = []
      const nodes = []
      let gi = 0
      const list = branches.map((node, i) => ({ node, def: PLANET_DEF[node.id] || { key: 'rock', color: '#8fb0ff', light: '#dbe6ff', dark: '#2a3a6b', r: 8, orbit: 0.7, speed: 0.06 }, i }))
      for (const p of list) {
        if (p.def.moon) continue
        const r = p.def.r
        const clip = 'bfcC' + p.i
        const shadeId = 'bfcS' + p.i
        const tex = planetTexture(p.def.key, p.def.color, p.def.light, p.def.dark)
        defs.push('<clipPath id="' + clip + '"><circle r="' + r + '"/></clipPath>')
        defs.push('<radialGradient id="' + shadeId + '" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="' + (r * 1.5).toFixed(1) + '" fx="' + (-r * 0.7).toFixed(1) + '" fy="' + (-r * 0.7).toFixed(1) + '"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="50%" stop-color="#000" stop-opacity="0.06"/><stop offset="100%" stop-color="#000" stop-opacity="0.92"/></radialGradient>')
        let ring = ''
        if (p.def.ring) {
          ring = '<ellipse rx="' + (r * 1.66).toFixed(1) + '" ry="' + (r * 0.44).toFixed(1) + '" fill="none" stroke="rgba(200,182,148,0.5)" stroke-width="2.2" transform="rotate(-14)"/>' +
            '<ellipse rx="' + (r * 1.98).toFixed(1) + '" ry="' + (r * 0.52).toFixed(1) + '" fill="none" stroke="rgba(200,182,148,0.2)" stroke-width="1.1" transform="rotate(-14)"/>'
        }
        markup.push('<g class="bfc-p2d__node" data-i="' + p.i + '">' +
          '<circle r="' + (r * 2).toFixed(1) + '" fill="rgba(150,180,255,0.045)"/>' +
          ring +
          '<image href="' + tex + '" x="' + (-r) + '" y="' + (-r) + '" width="' + (r * 2) + '" height="' + (r * 2) + '" clip-path="url(#' + clip + ')" preserveAspectRatio="xMidYMid slice"/>' +
          '<circle r="' + r + '" fill="url(#' + shadeId + ')"/>' +
          '<circle r="' + r + '" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>' +
          '</g>')
        nodes.push({ node: p.node, def: p.def, i: p.i, r, shadeId, base: -Math.PI / 2 + (p.i / Math.max(1, list.length)) * Math.PI * 2 + p.i * 0.35 })
      }      const moon = list.find((p) => p.def.moon)
      if (moon) {
        const r = moon.def.r
        const moonTex = planetTexture('moon', '#b9b9bd', '#e6e6ea', '#5c5e66')
        defs.push('<clipPath id="bfcMoonClip"><circle r="' + r + '"/></clipPath>')
        defs.push('<radialGradient id="bfcMoonShade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="' + (r * 1.5).toFixed(1) + '" fx="' + (-r * 0.7).toFixed(1) + '" fy="' + (-r * 0.7).toFixed(1) + '"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="50%" stop-color="#000" stop-opacity="0.05"/><stop offset="100%" stop-color="#000" stop-opacity="0.9"/></radialGradient>')
        markup.push('<g class="bfc-p2d__node" data-i="' + moon.i + '">' +
          '<circle r="' + (r * 2.2).toFixed(1) + '" fill="rgba(160,175,210,0.05)"/>' +
          '<image href="' + moonTex + '" x="' + (-r) + '" y="' + (-r) + '" width="' + (r * 2) + '" height="' + (r * 2) + '" clip-path="url(#bfcMoonClip)"/>' +
          '<circle r="' + r + '" fill="url(#bfcMoonShade)"/>' +
          '<circle r="' + r + '" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>' +
          '</g>')
      }

      const orbits = nodes.map((p) => '<ellipse class="bfc-star2d__orbit" cx="' + cx + '" cy="' + cy + '" rx="' + (RX * p.def.orbit).toFixed(1) + '" ry="' + (RY * p.def.orbit).toFixed(1) + '"/>').join('')
      const sunHalo = Math.min(W, H) * 0.17
      const wrap = document.createElement('div')
      wrap.className = 'bfc-star2d-wrap'
      wrap.innerHTML = '<svg class="bfc-star2d" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
        '<defs><radialGradient id="bfcSunHalo" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff3d6" stop-opacity="0.5"/><stop offset="30%" stop-color="#ffd9a0" stop-opacity="0.14"/><stop offset="100%" stop-color="#ffb347" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="bfcSunCore" cx="44%" cy="40%" r="60%"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#fff1c9"/><stop offset="100%" stop-color="#ffcf7a"/></radialGradient>' +
        defs.join('') + '</defs>' + orbits +
        '<circle class="bfc-star2d__sun-halo" cx="' + cx + '" cy="' + cy + '" r="' + sunHalo.toFixed(1) + '" fill="url(#bfcSunHalo)"/>' +
        '<circle class="bfc-star2d__sun" cx="' + cx + '" cy="' + cy + '" r="21" fill="url(#bfcSunCore)"/>' +
        markup.join('') + '</svg>'
      stage.append(wrap)
      stage.append(h('div', { class: 'bfc-star2d__name', style: { left: `${cx}px`, top: `${cy + 44}px` }, text: '星图' }))

      const byIndex = {}
      for (const g of wrap.querySelectorAll('.bfc-p2d__node')) byIndex[g.getAttribute('data-i')] = g
      const orbitPlanets = []
      const makeLabel = (node, def, g) => {
        const label = h('button', {
          class: 'bfc-p2d__label',
          type: 'button',
          style: { left: `${cx}px`, top: `${cy}px`, '--c': def.color },
          onclick: (ev) => {
            ev.stopPropagation()
            if (isBranch(node)) focusBranch(node.id)
            else activateNode(node)
          },
        }, h('i', { class: 'bfc-p2d__dot', style: { background: def.color } }), h('b', { text: node.label }))
        label.style.setProperty('--c', def.color)
        stage.append(label)
        if (g) {
          g.addEventListener('click', (ev) => {
            ev.stopPropagation()
            if (isBranch(node)) focusBranch(node.id)
            else activateNode(node)
          })
        }
        return label
      }
      for (const p of nodes) {
        const g = byIndex[p.i]
        const label = makeLabel(p.node, p.def, g)
        const grad = wrap.querySelector('#' + p.gid)
        orbitPlanets.push({ ...p, g, grad, label })
      }
      let moonObj = null
      if (moon) {
        const g = byIndex[moon.i]
        const label = makeLabel(moon.node, moon.def, g)
        moonObj = { ...moon, g, label, grad: wrap.querySelector('#bfcMoonShade'), base: -Math.PI / 2, dist: 30 }
      }
      S.orbit2d = { cx, cy, rx: RX, ry: RY, planets: orbitPlanets, moon: moonObj, earthId: 'connection' }

      S.belt = []
      for (let i = 0; i < 260; i++) {
        S.belt.push({
          base: Math.random() * Math.PI * 2,
          rr: 0.9 + Math.random() * 0.2,
          s: Math.random() > 0.9 ? 1.6 : 0.8,
          rgb: Math.random() > 0.82 ? '190,160,140' : '150,160,185',
          a: 0.1 + Math.random() * 0.3,
        })
      }
    }    renderNav()
  }
  function worldBBox() {
    const { pos, width, height } = layout(S.tree)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of pos.values()) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + p.w)
      maxY = Math.max(maxY, p.y + p.h)
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, width, height }
  }

  function fitView() {
    const host = S.overlay?.querySelector('.bfc-canvas')
    if (!host) return
    const box = worldBBox()
    const cw = host.clientWidth
    const ch = host.clientHeight
    const scale = Math.min((cw - 100) / box.w, (ch - 100) / box.h, 1.15)
    S.scale = Math.max(0.4, Math.min(scale, 1.15))
    S.tx = (cw - box.w * S.scale) / 2 - box.x * S.scale
    S.ty = (ch - box.h * S.scale) / 2 - box.y * S.scale
    renderCanvas()
  }

  // ── 渲染：抽屉 ────────────────────────────────────────────────────────
  function renderDrawer() {
    const body = S.overlay?.querySelector('.bfc-drawer__body')
    const head = S.overlay?.querySelector('.bfc-drawer__head')
    if (!body || !head) return
    head.innerHTML = ''
    body.innerHTML = ''
    const node = S.selected
    if (!node) {
      head.append(h('div', { class: 'bfc-drawer__title', text: '未选择节点' }))
      body.append(h('div', { class: 'bfc-drawer__empty', text: '点左侧任意叶子节点编辑参数；点分支节点展开/折叠。' }))
      return
    }
    head.append(
      h('div', { class: 'bfc-drawer__title', text: `${node.icon || ''} ${node.label}`.trim() }),
      h('div', { class: 'bfc-drawer__sub', text: isBranch(node) ? `分支 · ${(node.children || []).length} 个子项` : (['diary', 'records', 'starmap'].includes(node.view?.kind) ? '本地档案 · 只读' : `${(node.fields || []).length} 个参数 · ${node.id}`) }),
    )
    if (isBranch(node)) {
      body.append(h('div', { class: 'bfc-drawer__empty', text: '这是分支节点，点它下面的子节点改具体参数。' }))
      return
    }
    if (node.view?.kind === 'diary') {
      body.append(renderDiaryInfo(node))
      return
    }
    if (node.view?.kind === 'records') {
      body.append(renderRecordsInfo(node))
      return
    }
    if (node.view?.kind === 'starmap') {
      body.append(
        h('div', { class: 'bfc-field__hint', text: node.hint || '把 diary 的记忆画成自转银河，点星星看正文。' }),
        h('div', { class: 'bfc-field' },
          h('button', { class: 'bfc-btn bfc-btn--primary', text: '打开记忆星图', onclick: openStarMap })))
      return
    }
    for (const field of node.fields) body.append(renderField(field))
  }

  function renderField(field) {
    if (field.type === 'action') {
      const labelMap = {
        'action:open-snowluma': '打开 SnowLuma 控制台',
        'action:probe': '立即探测',
        'action:edit-role': '编辑人格卡内容',
        'action:sync-dsh': '同步为当前端口',
        'action:refresh-voices': '查看语音库',
        'action:post-moment': '发一条动态',
        'action:list-moments': '看她发过的动态',
        'action:moment-reset': '清零配额（立刻能发）',
      }
      return h('div', { class: 'bfc-field' },
        h('button', {
          class: 'bfc-btn',
          text: labelMap[field.key] || field.label,
          onclick: () => runAction(field.key),
        }))
    }

    const base = S.values[field.key]
    const value = fieldDirty(field.key) ? S.drafts.get(field.key) : base
    const wrap = h('div', { class: 'bfc-field' })
    const labelRow = h('div', { class: 'bfc-field__label' },
      h('span', { text: field.label }),
      field.requiresRestart ? h('span', { class: 'bfc-field__req', text: '需重启' }) : null,
      field.custom ? h('span', { class: 'bfc-field__req bfc-field__custom', text: '仅记录' }) : null)
    wrap.append(labelRow)

    const err = S.invalid.get(field.key)
    const mark = (el) => {
      if (fieldDirty(field.key)) el.classList.add(el.classList.contains('bfc-switch') ? 'bfc-x' : 'bfc-input--dirty')
    }

    if (field.type === 'bool') {
      const input = h('input', { type: 'checkbox' })
      input.checked = value === true
      input.addEventListener('change', () => setFieldValue(field, input.checked))
      wrap.append(h('label', { class: 'bfc-switch' }, input, h('span', { class: 'bfc-switch__track' }), h('span', { class: 'bfc-switch__text', text: value ? '开启' : '关闭' })))
    } else if (field.type === 'enum') {
      const sel = h('select', { class: 'bfc-select' })
      for (const opt of field.options) {
        const o = h('option', { value: opt, text: opt })
        if (opt === String(value)) o.selected = true
        sel.append(o)
      }
      sel.addEventListener('change', () => setFieldValue(field, sel.value))
      mark(sel)
      wrap.append(sel)
    } else if (field.type === 'number') {
      const row = h('div', { class: 'bfc-range' })
      const out = h('span', { class: 'bfc-range__val', text: `${value ?? 0}${field.unit ? ' ' + field.unit : ''}` })
      const range = h('input', {
        type: 'range',
        min: String(field.min ?? 0),
        max: String(field.max ?? 100),
        step: String(field.step ?? 1),
        value: String(value ?? 0),
      })
      range.addEventListener('input', () => {
        const n = Number(range.value)
        out.textContent = `${n}${field.unit ? ' ' + field.unit : ''}`
        setFieldValue(field, n)
      })
      mark(range)
      row.append(range, out)
      wrap.append(row)
    } else if (field.type === 'text') {
      const ta = h('textarea', { class: 'bfc-textarea', rows: field.rows || 5 })
      ta.value = value ?? ''
      ta.addEventListener('input', () => setFieldValue(field, ta.value))
      mark(ta)
      wrap.append(ta)
    } else if (field.type === 'list') {
      wrap.append(renderTags(field, Array.isArray(value) ? value : []))
    } else if (field.type === 'role') {
      const sel = h('select', { class: 'bfc-select' })
      sel.append(h('option', { value: '', text: '（不使用人格卡）' }))
      for (const r of S.roles) {
        const o = h('option', { value: r, text: r })
        if (r === value) o.selected = true
        sel.append(o)
      }
      sel.addEventListener('change', () => setFieldValue(field, sel.value || null))
      mark(sel)
      wrap.append(sel)
    } else {
      const input = h('input', {
        class: 'bfc-input',
        type: field.type === 'secret' ? 'password' : 'text',
        placeholder: field.type === 'secret' && S.values[`${field.key}__saved`] ? '已保存（留空表示不修改）' : (field.placeholder || ''),
      })
      input.value = value ?? ''
      input.addEventListener('input', () => setFieldValue(field, input.value))
      mark(input)
      wrap.append(input)
    }

    if (field.hint) wrap.append(h('div', { class: 'bfc-field__hint', text: field.hint }))
    if (err) wrap.append(h('div', { class: 'bfc-field__err', text: err }))
    return wrap
  }

  function renderTags(field, list) {
    const box = h('div', { class: 'bfc-tags' })
    const input = h('input', { type: 'text', placeholder: field.placeholder || '回车添加' })
    const commit = () => {
      const raw = input.value.trim()
      if (!raw) return
      const parts = raw.split(/[,，\s]+/).filter(Boolean)
      const next = list.slice()
      for (const p of parts) {
        if (field.itemType === 'number') {
          const n = Number(p)
          if (!Number.isFinite(n)) {
            toast(`「${p}」不是数字`, 'err')
            continue
          }
          if (!next.includes(n)) next.push(n)
        } else if (!next.includes(p)) next.push(p)
      }
      input.value = ''
      setFieldValue(field, next)
      renderDrawer()
    }
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ',' || ev.key === '，') {
        ev.preventDefault()
        commit()
      } else if (ev.key === 'Backspace' && !input.value && list.length) {
        setFieldValue(field, list.slice(0, -1))
        renderDrawer()
      }
    })
    input.addEventListener('blur', commit)
    box.append(input)
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      box.insertBefore(
        h('span', { class: 'bfc-tag' },
          h('span', { text: String(item) }),
          h('button', {
            type: 'button',
            text: '×',
            onclick: () => {
              const next = list.filter((_, idx) => idx !== i)
              setFieldValue(field, next)
              renderDrawer()
            },
          })),
        input,
      )
    }
    return box
  }

  // ── 渲染：页头与页脚 ──────────────────────────────────────────────────
  function renderHeader() {
    const header = S.overlay.querySelector('.bfc-header')
    header.innerHTML = ''
    header.append(
      h('div', { class: 'bfc-title' }, '星图', h('small', { text: '控制台' })),
      h('span', { class: 'bfc-pill', id: 'bfc-pill-bridge' }, '桥接 ', h('b', { text: '…' })),
      h('span', { class: 'bfc-pill', id: 'bfc-pill-qq' }, 'QQ ', h('b', { text: '…' })),
      h('span', { class: 'bfc-pill', id: 'bfc-pill-snow' }, 'SnowLuma ', h('b', { text: '…' })),
      S.boot?.mismatch
        ? h('button', {
          class: 'bfc-pill bfc-pill--bad',
          title: `配置里是 ${S.boot.mismatch.configured}，当前是 ${S.boot.mismatch.origin}`,
          text: 'DSH 地址待同步',
          onclick: () => runAction('action:sync-dsh'),
        })
        : null,
      h('div', { class: 'bfc-spacer' }),
      h('input', {
        class: 'bfc-search',
        placeholder: '搜索星域 / 节点…',
        value: S.search,
        oninput: (ev) => {
          S.search = ev.target.value
          if (S.search.trim() && S.focusBranch && S.nodeById.get(S.focusBranch)) {
            // 聚焦时搜索只在当前星域里筛，不自动跳
          }
          renderCanvas()
        },
      }),
      h('button', { class: 'bfc-btn', text: '工具', onclick: openToolbox }),
      h('button', { class: 'bfc-btn', text: '关闭', onclick: closeConsole }),
    )
    renderStatus()
  }

  function openToolbox() {
    const modal = h('div', { class: 'bfc-modal' })
    const box = h('div', { class: 'bfc-modal__box bfc-toolbox' })
    const row = (label, desc, onclick) => h('button', { class: 'bfc-toolbox__item', type: 'button', onclick },
      h('b', { text: label }),
      h('span', { text: desc }))
    box.append(
      h('div', { class: 'bfc-modal__head' },
        h('strong', { text: '⚙ 工具箱' }),
        h('div', { class: 'bfc-spacer' }),
        h('button', { class: 'bfc-btn', text: '关闭', onclick: () => modal.remove() })),
      h('div', { class: 'bfc-modal__body bfc-toolbox__body' },
        row('立即刷新', '重新读取配置与人格卡', () => { modal.remove(); refreshData(false) }),
        row(`自动刷新：${S.autoRefresh ? '开' : '关'}`, '每 10 秒同步一次（不会覆盖草稿）', () => {
          S.autoRefresh = !S.autoRefresh
          renderHeader()
          modal.remove()
          if (S.autoRefresh) refreshData()
        }),
        row('导出 JSON', '含 config、当前人格与全部人格卡', () => { modal.remove(); exportJson() }),
        row('导入 JSON', '深合并，导入前自动备份', () => { modal.remove(); importJson() }),
        row('一键备份', '把当前配置整体备份一份', () => { modal.remove(); backupNow() }),
        row('启动桥接', '拉起 bridge', () => { modal.remove(); service('start-bridge', '启动桥接') }),
        row('重启桥接', '配置改动后需要', () => { modal.remove(); service('restart-bridge', '重启桥接') }),
        row('启动 SnowLuma', '拉起 QQ 网关', () => { modal.remove(); service('start-snowluma', '启动 SnowLuma') })))
    modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove() })
    document.body.append(modal)
  }
  function renderStatus() {
    const st = S.status
    const paint = (id, label, ok, extra) => {
      const el = S.overlay?.querySelector(`#${id}`)
      if (!el) return
      el.classList.toggle('bfc-pill--ok', ok === true)
      el.classList.toggle('bfc-pill--bad', ok === false)
      el.innerHTML = ''
      el.append(document.createTextNode(`${label} `), h('b', { text: extra || (ok ? '在线' : '离线') }))
    }
    paint('bfc-pill-bridge', '桥接', st?.bridge?.online === true, st?.bridge?.online ? `在线 · ${st.bridge.mode || ''}` : '离线')
    paint('bfc-pill-qq', 'QQ', st?.onebot?.online === true, st?.onebot?.online ? `${st.onebot.nickname || ''}${st.onebot.uin ? ' ' + st.onebot.uin : ''}` : '离线')
    paint('bfc-pill-snow', 'SnowLuma', st?.snowluma?.online === true, st?.snowluma?.online ? (st.snowluma.status || '在线') : '离线')
  }

  function renderFooter() {
    const foot = S.overlay.querySelector('.bfc-footer')
    foot.innerHTML = ''
    const n = draftCount()
    foot.append(
      h('span', { class: 'bfc-footer__count' }, '未保存改动 ', h('b', { text: String(n) }), ' 项'),
      h('span', { class: 'bfc-footer__note', text: '连接类改动需重启桥接；白名单 / 管理员 / 人格卡会尽力热同步' }),
      h('span', { class: 'bfc-footer__note', id: 'bfc-refresh-at', text: refreshNoteText() }),
      h('div', { class: 'bfc-spacer' }),
      h('button', { class: 'bfc-btn', text: '重置', disabled: n === 0, onclick: resetDrafts }),
      h('button', { class: 'bfc-btn bfc-btn--primary', text: '保存', disabled: n === 0, onclick: saveDrafts }),
    )
  }

  // ── 动作 ──────────────────────────────────────────────────────────────
  async function service(action, label) {
    try {
      const res = await api('/service', { action })
      toast(`${label}：${res.note || res.out || '已执行'}`, 'ok')
      setTimeout(() => refreshStatus(true), 2600)
    } catch (error) {
      toast(`${label}失败：${error.message}`, 'err')
    }
  }

  // 思维导图上直接可点的动作节点：点一下就打开链接或拉起终端
  function runNodeAction(node) {
    const a = node.action || {}
    if (a.kind === 'openUrl' && a.url) {
      api('/open-url', { url: a.url })
        .then(() => toast(`已打开 ${a.url}；没弹出来就点右边`, 'ok', { href: a.url, hrefLabel: '打开' }))
        .catch((error) => toast(`自动打开失败：${error.message}`, 'err', { href: a.url, hrefLabel: '手动打开' }))
      return
    }
    if (a.kind === 'service' && a.action) {
      service(a.action, a.label || node.label)
      return
    }
    toast('这个节点没有配置动作', 'err')
  }

  function runAction(key) {
    if (key === 'action:open-snowluma') {
      // Electron 里 window.open 常被窗口策略拦掉，交给 Host 用系统浏览器打开。
      // 无论成功失败，气泡里都带一个真正可点的链接 —— 浏览器被拦、焦点被抢、
      // 或者页面本身跑在旧端口上时，还有一次手动打开的机会。
      const url = 'http://127.0.0.1:5099'
      api('/open-url', { url })
        .then(() => toast('已交给系统浏览器打开 SnowLuma 控制台（127.0.0.1:5099）；没弹出来就点右边', 'ok', {
          href: url,
          hrefLabel: '打开',
        }))
        .catch((error) => toast(`自动打开失败：${error.message}`, 'err', {
          href: url,
          hrefLabel: '手动打开 5099',
        }))
      return
    }
    if (key === 'action:probe') {
      refreshStatus(true)
      return
    }
    if (key === 'action:edit-role') {
      const role = S.values.currentRole || S.drafts.get('currentRole')
      if (!role) return toast('先选一张人格卡', 'err')
      openRoleEditor(role)
      return
    }
    if (key === 'action:sync-dsh') {
      const origin = S.boot?.mismatch?.origin || S.boot?.origin
      if (!origin) return toast('当前拿不到 DSH 地址（桌面壳下可能需要手填）', 'err')
      S.drafts.set('dsh.baseUrl', origin)
      S.invalid.delete('dsh.baseUrl')
      renderCanvas()
      renderDrawer()
      renderFooter()
      toast(`已填入 ${origin}，点「保存」后生效`, 'ok')
      return
    }
    if (key === 'action:refresh-voices') {
      openVoiceList()
      return
    }
    if (key === 'action:post-moment') {
      openMomentPost()
      return
    }
    if (key === 'action:list-moments') {
      openMomentList()
      return
    }
    if (key === 'action:moment-reset') {
      api('/moment-reset', {})
        .then((r) => toast(r.message || '动态配额已清零', 'ok'))
        .catch((error) => toast(`清零失败：${error.message}`, 'err'))
    }
  }

  async function openVoiceList() {
    try {
      const res = await api('/voices')
      const modal = h('div', { class: 'bfc-modal' })
      const list = h('div', { class: 'bfc-modal__body' })
      list.append(
        h('div', { class: 'bfc-drawer__sub', text: `${res.voices.length} 个音频 · 目录 ${res.dir} · 总开关 ${res.enabled ? '已开' : '已关'}` }),
      )
      if (!res.voices.length) {
        list.append(h('div', { class: 'bfc-drawer__empty', text: '语音库是空的。把 mp3/wav 放进这个目录（SnowLuma 会自动转 SILK）。' }))
      }
      for (const v of res.voices) {
        list.append(h('div', { class: 'bfc-field', style: { marginBottom: '8px' } },
          h('div', { class: 'bfc-field__label' }, h('span', { text: v.name }), h('span', { class: 'bfc-field__req', text: `${(v.bytes / 1024).toFixed(0)} KB` }))))
      }
      modal.append(h('div', { class: 'bfc-modal__box' },
        h('div', { class: 'bfc-modal__head' }, h('strong', { text: '语音库' }), h('div', { class: 'bfc-spacer' }), h('button', { class: 'bfc-btn', text: '关闭', onclick: () => modal.remove() })),
        list))
      modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove() })
      document.body.append(modal)
    } catch (error) {
      toast(`读取语音库失败：${error.message}`, 'err')
    }
  }

  // ── 动态（QQ 空间说说）────────────────────────────────────────────────
  function openMomentPost() {
    const modal = h('div', { class: 'bfc-modal' })
    const ta = h('textarea', { class: 'bfc-textarea', placeholder: '写点什么…（会发到她 QQ 空间，按「可见范围」设置）' })
    const status = h('span', { class: 'bfc-footer__note' })
    const close = () => modal.remove()
    modal.append(h('div', { class: 'bfc-modal__box' },
      h('div', { class: 'bfc-modal__head' }, h('strong', { text: '发一条动态' }), h('div', { class: 'bfc-spacer' }), status),
      h('div', { class: 'bfc-modal__body' }, ta),
      h('div', { class: 'bfc-modal__foot' },
        h('button', { class: 'bfc-btn', text: '取消', onclick: close }),
        h('button', {
          class: 'bfc-btn bfc-btn--primary',
          text: '发布',
          onclick: async () => {
            const content = ta.value.trim()
            if (!content) {
              status.textContent = '先写点内容'
              return
            }
            try {
              const r = await api('/moment', { content })
              toast(`已发布，tid=${r.tid}`, 'ok')
              close()
            } catch (error) {
              status.textContent = `失败：${error.message}`
            }
          },
        }))))
    modal.addEventListener('click', (ev) => { if (ev.target === modal) close() })
    document.body.append(modal)
  }

  function openMomentList() {
    const modal = h('div', { class: 'bfc-modal' })
    const body = h('div', { class: 'bfc-modal__body' })
    const close = () => modal.remove()
    modal.append(h('div', { class: 'bfc-modal__box' },
      h('div', { class: 'bfc-modal__head' }, h('strong', { text: '她发过的动态' }), h('div', { class: 'bfc-spacer' }), h('button', { class: 'bfc-btn', text: '关闭', onclick: close })),
      body))
    body.append(h('div', { class: 'bfc-splash', text: '读取中…' }))
    api('/moments?num=20')
      .then((r) => {
        body.innerHTML = ''
        const list = r.list?.msglist || r.list?.list || r.list || []
        if (!list.length) {
          body.append(h('div', { class: 'bfc-drawer__empty', text: '还没有动态。' }))
          return
        }
        for (const item of list) {
          const t = item.time ? new Date(Number(item.time) * 1000) : null
          body.append(h('div', { class: 'bfc-field', style: { marginBottom: '10px' } },
            h('div', { class: 'bfc-field__label' }, h('span', { text: item.content || '(无文字)' })),
            h('div', { class: 'bfc-field__hint', text: t ? `${t.toLocaleString()} · 赞 ${item.like_count ?? 0} · 评 ${item.comment_count ?? 0}` : String(item.tid || '') })))
        }
      })
      .catch((error) => {
        body.innerHTML = ''
        body.append(h('div', { class: 'bfc-drawer__empty', text: `读取失败：${error.message}` }))
      })
    modal.addEventListener('click', (ev) => { if (ev.target === modal) close() })
    document.body.append(modal)
  }

  // ── 日记（memory 档案，只读） ────────────────────────────────────
  const DIARY_TABS = [
    ['diary', '肥鱼日记'],
    ['notes', '手记'],
    ['persona', '人格内核'],
  ]

  function renderRecordsInfo(node) {
    const wrap = h('div', { class: 'bfc-diary__info' })
    wrap.append(h('div', { class: 'bfc-field__hint', text: node.hint || '搜索日记记录，勾选删掉不想要的。' }))
    wrap.append(h('div', { class: 'bfc-field' },
      h('button', { class: 'bfc-btn bfc-btn--primary', text: '打开记录清理', onclick: () => openRecords() })))
    wrap.append(h('div', { class: 'bfc-field' },
      h('button', { class: 'bfc-btn', text: '打开肥鱼日记', onclick: () => openDiary('diary') })))
    return wrap
  }

  async function diaryState() {
    const res = await fetch('/diary/state', { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return Array.isArray(data.diary) ? data.diary : []
  }

  async function forgetRecord(id) {
    const res = await fetch('/diary/forget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }

  function openRecords() {
    const modal = h('div', { class: 'bfc-modal' })
    const box = h('div', { class: 'bfc-modal__box bfc-modal__box--records' })
    const search = h('input', { class: 'bfc-input', placeholder: '搜索记录（关键词）…' })
    const list = h('div', { class: 'bfc-record-list' })
    const status = h('span', { class: 'bfc-footer__note', text: '读取中…' })
    let entries = []
    const selected = new Set()
    const close = () => modal.remove()

    const paint = () => {
      const q = search.value.trim().toLowerCase()
      const rows = entries.filter((e) => !q || String(e.text || '').toLowerCase().includes(q))
      list.innerHTML = ''
      if (!rows.length) {
        list.append(h('div', { class: 'bfc-drawer__empty', text: entries.length ? '没有匹配的记录。' : '还没有记录。' }))
      }
      for (const e of rows) {
        const cb = h('input', { type: 'checkbox' })
        cb.checked = selected.has(e.id)
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(e.id)
          else selected.delete(e.id)
          status.textContent = `共 ${entries.length} 条 · 已选 ${selected.size} 条`
        })
        list.append(h('div', { class: 'bfc-record' },
          h('label', { class: 'bfc-record__main' },
            cb,
            h('span', { class: 'bfc-record__text', text: String(e.text || '') })),
          h('div', { class: 'bfc-record__meta' },
            h('span', { text: `${new Date(Number(e.created_at) || Date.now()).toLocaleString('zh-CN', { hour12: false })} · 重要度 ${e.salience ?? '?'}` }),
            h('button', {
              class: 'bfc-btn',
              text: '删这条',
              onclick: async () => {
                if (!confirm('删掉这条记录？不可恢复。')) return
                try {
                  await forgetRecord(e.id)
                  await load()
                  toast('已删除', 'ok')
                } catch (error) {
                  toast(`删除失败：${error.message}`, 'err')
                }
              },
            }))))
      }
    }

    const load = async (notify = false) => {
      status.textContent = '读取中…'
      try {
        entries = await diaryState()
        selected.clear()
        paint()
        status.textContent = `共 ${entries.length} 条 · 已选 0 条`
        if (notify) toast(`刷新成功 · 共 ${entries.length} 条记录`, 'ok')
      } catch (error) {
        entries = []
        paint()
        status.textContent = `读取失败：${error.message}（要在已登录的 DSH 页面里用）`
        if (notify) toast(`刷新失败：${error.message}`, 'err')
      }
    }

    search.addEventListener('input', paint)
    box.append(
      h('div', { class: 'bfc-modal__head' },
        h('strong', { text: '🧹 记录清理' }),
        h('div', { class: 'bfc-spacer' }),
        h('button', { class: 'bfc-btn', text: '刷新', onclick: () => load(true) }),
        h('button', { class: 'bfc-btn', text: '关闭', onclick: close })),
      h('div', { class: 'bfc-record__tools' },
        search,
        h('button', { class: 'bfc-btn', text: '全选', onclick: () => { for (const e of entries) selected.add(e.id); paint(); status.textContent = `共 ${entries.length} 条 · 已选 ${selected.size} 条` } }),
        h('button', { class: 'bfc-btn', text: '清空选择', onclick: () => { selected.clear(); paint(); status.textContent = `共 ${entries.length} 条 · 已选 0 条` } })),
      list,
      h('div', { class: 'bfc-modal__foot' },
        status,
        h('div', { class: 'bfc-spacer' }),
        h('button', {
          class: 'bfc-btn bfc-btn--primary',
          text: '删除选中',
          onclick: async () => {
            const ids = [...selected]
            if (!ids.length) return toast('先勾选要删的记录', 'err')
            if (!confirm(`删除选中的 ${ids.length} 条记录？不可恢复。`)) return
            try {
              for (const id of ids) await forgetRecord(id)
              toast(`已删除 ${ids.length} 条`, 'ok')
              await load()
            } catch (error) {
              toast(`删除失败：${error.message}`, 'err')
            }
          },
        }),
        h('button', { class: 'bfc-btn', text: '关闭', onclick: close })),
    )
    modal.append(box)
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close()
    })
    document.body.append(modal)
    load()
  }

  function renderDiaryInfo(node) {
    const wrap = h('div', { class: 'bfc-diary__info' })
    wrap.append(h('div', { class: 'bfc-field__hint', text: node.hint || '点左侧节点直接打开；也可以从下面单独打开一份。' }))
    for (const [key, label] of DIARY_TABS) {
      wrap.append(h('div', { class: 'bfc-field' },
        h('button', { class: 'bfc-btn', text: `打开${label}`, onclick: () => openDiary(key) })))
    }
    wrap.append(h('div', { class: 'bfc-field' },
      h('button', { class: 'bfc-btn', text: '打开档案文件夹', onclick: openDiaryFolder })))
    wrap.append(h('div', { class: 'bfc-field__hint', text: '目录：~/.dsh/diary（可用 STAR_CONSOLE_DIARY_DIR 覆盖）' }))
    return wrap
  }

  async function openDiaryFolder() {
    try {
      const res = await api('/diary/open', { what: 'dir' })
      toast(`已打开 ${res.target}`, 'ok')
    } catch (error) {
      toast(`打开文件夹失败：${error.message}`, 'err')
    }
  }

  function openDiary(initial = 'diary') {
    let current = DIARY_TABS.some(([key]) => key === initial) ? initial : 'diary'
    const modal = h('div', { class: 'bfc-modal' })
    const box = h('div', { class: 'bfc-modal__box bfc-modal__box--diary' })
    const tabs = h('div', { class: 'bfc-diary__tabs' })
    const meta = h('div', { class: 'bfc-diary__meta' })
    const text = h('pre', { class: 'bfc-diary__text' })
    const close = () => modal.remove()

    const paintTabs = () => {
      tabs.innerHTML = ''
      for (const [key, label] of DIARY_TABS) {
        tabs.append(h('button', {
          class: `bfc-btn bfc-diary__tab${key === current ? ' bfc-diary__tab--on' : ''}`,
          text: label,
          onclick: () => {
            if (key === current) return
            current = key
            paintTabs()
            load()
          },
        }))
      }
    }

    const load = async (notify = false) => {
      text.textContent = '读取中…'
      meta.textContent = ''
      try {
        const res = await api(`/diary?file=${current}`)
        meta.textContent = res.exists
          ? `${res.file} · 更新于 ${new Date(res.mtime).toLocaleString()} · ${(res.bytes / 1024).toFixed(1)} KB · ${res.dir}`
          : `${res.file} 还没生成 · 目录 ${res.dir}`
        text.textContent = res.exists
          ? (res.content || '（这份档案是空的）')
          : '这份档案还没生成。先聊两句、或在「手记」里写一条，再回来点刷新。'
        if (notify) toast('刷新成功', 'ok')
      } catch (error) {
        const message = String(error?.message || error)
        text.textContent = /\b404\b/.test(message)
          ? 'Host 侧还没加载日记接口。完全退出 DSH 再打开一次，这个入口就能读了。'
          : `读取失败：${message}`
        if (notify) toast(`刷新失败：${message}`, 'err')
      }
    }

    paintTabs()
    box.append(
      h('div', { class: 'bfc-modal__head' },
        h('strong', { text: '📔 肥鱼日记' }),
        h('div', { class: 'bfc-spacer' }),
        h('button', { class: 'bfc-btn', text: '刷新', onclick: () => load(true) }),
        h('button', { class: 'bfc-btn', text: '关闭', onclick: close })),
      tabs,
      meta,
      h('div', { class: 'bfc-modal__body bfc-diary__body' }, text),
      h('div', { class: 'bfc-modal__foot' },
        h('button', { class: 'bfc-btn', text: '打开档案文件夹', onclick: openDiaryFolder }),
        h('button', {
          class: 'bfc-btn',
          text: '打开当前文件',
          onclick: async () => {
            try {
              const res = await api('/diary/open', { what: 'file', file: current })
              toast(`已打开 ${res.target}`, 'ok')
            } catch (error) {
              toast(`打开失败：${error.message}`, 'err')
            }
          },
        }),
        h('button', { class: 'bfc-btn bfc-btn--primary', text: '关闭', onclick: close })),
    )
    modal.append(box)
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close()
    })
    document.body.append(modal)
    load()
  }

  // ── 记忆星图（只读 diary） ───────────────────────────────────────
  const STAR_KINDS = {
    chat: { label: '闲聊', color: '#a9bcff' },
    win: { label: '干得不错', color: '#ffd39a' },
    failure: { label: '搞砸了', color: '#ff9f9f' },
    disclosure: { label: '交底', color: '#c4a9ff' },
    grievance: { label: '委屈', color: '#ffa9c3' },
  }
  const STAR_FALLBACK = { label: '其他', color: '#9fb0c8' }
  const starTwo = (n) => String(n).padStart(2, '0')

  function starKindMeta(kind) {
    return STAR_KINDS[kind] || STAR_FALLBACK
  }

  function starFirstSentence(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim()
    if (!t) return ''
    const cut = t.search(/[。！？!?…]/)
    return cut >= 0 ? t.slice(0, cut + 1) : t.slice(0, 60)
  }

  function starTitle(text) {
    const s = starFirstSentence(text).replace(/[。！？!?…]$/, '')
    return s.length > 22 ? `${s.slice(0, 22)}…` : s || '（没有正文）'
  }

  async function fetchStarMemories() {
    const res = await fetch('/diary/state', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!data || data.ok === false) throw new Error(data?.error || 'diary 返回失败')
    const list = Array.isArray(data.diary) ? data.diary.slice() : []
    return list
      .filter((d) => d && d.text)
      .sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0))
      .map((d, i) => {
        const meta = starKindMeta(d.kind)
        const at = new Date(Number(d.created_at) || Date.now())
        return {
          id: d.id || `m${i}`,
          text: String(d.text),
          quote: starFirstSentence(d.text),
          title: starTitle(d.text),
          kindLabel: meta.label,
          color: meta.color,
          salience: Math.max(0.2, Math.min(1, Number(d.salience) || 0.5)),
          date: `${at.getFullYear()}-${starTwo(at.getMonth() + 1)}-${starTwo(at.getDate())}`,
        }
      })
  }

  /** 全屏记忆星图：把 diary 的记忆铺成自转银河，点星星看正文。 */
  function openStarMap() {
    if (document.querySelector('.bfc-modal--starmap')) return
    const modal = h('div', { class: 'bfc-modal bfc-modal--starmap' })
    const box = h('div', { class: 'bfc-starmap' })
    const countEl = h('span', { class: 'bfc-starmap__count', text: '读取中…' })
    const head = h('div', { class: 'bfc-starmap__head' },
      h('strong', { class: 'bfc-starmap__logo', text: '🌌 记忆星图' }),
      countEl,
      h('div', { class: 'bfc-spacer' }),
      h('span', { class: 'bfc-starmap__hint', text: '只读 · 点星星看记忆 · ← → 切换 · Esc 关闭' }),
      h('button', { class: 'bfc-btn', text: '关闭', onclick: () => modal.remove() }))

    const stage = h('div', { class: 'bfc-starmap__stage' })
    const canvas = h('canvas', { class: 'bfc-starmap__sky' })
    const core = h('div', { class: 'bfc-starmap__core' },
      h('div', { class: 'halo' }),
      h('div', { class: 'ring' }),
      h('div', { class: 'orbit' }, h('i', { class: 'is-a' }), h('i', { class: 'is-b' })))
    const nodes = h('div', { class: 'bfc-starmap__nodes' })
    const quote = h('div', { class: 'bfc-starmap__quote' })
    const card = h('div', { class: 'bfc-starmap__card' })
    const cardDate = h('div', { class: 'bfc-starmap__date' })
    const cardTitle = h('h3', { class: 'bfc-starmap__title' })
    const cardText = h('p', { class: 'bfc-starmap__text' })
    card.append(cardDate, cardTitle, cardText)
    const detail = h('div', { class: 'bfc-starmap__detail' })
    stage.append(canvas, core, nodes, quote, card, detail)
    box.append(head, stage)
    modal.append(box)
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) modal.remove()
    })
    document.body.append(modal)

    let memories = []
    let stars = []
    let W = 0
    let H = 0
    let CX = 0
    let CY = 0
    let R0 = 0
    let R1 = 0
    let clock = 0
    let lastTs = 0
    let raf = 0
    let slow = false
    let index = -1
    let pollTimer = 0
    let quoteTimer = 0
    let memorySig = ''
    const KY = 0.62
    const BASE_SPEED = 0.05

    function measure() {
      const r = stage.getBoundingClientRect()
      W = Math.max(320, r.width)
      H = Math.max(220, r.height)
      const min = Math.min(W, H)
      CX = W * 0.53
      CY = H * 0.5
      R0 = min * 0.20
      R1 = min * 0.455
      core.style.left = `${CX}px`
      core.style.top = `${CY}px`
    }

    let bgStatic = null
    let bgRiver = null
    let bgPlate = null
    let bgPlate2 = null
    let twinkles = []
    let meteors = []
    let hover = -1
    const sprites = new Map()

    function rgba(hex, alpha) {
      let h = String(hex).replace('#', '')
      if (h.length === 3) h = h.split('').map((c) => c + c).join('')
      const n = parseInt(h, 16)
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
    }

    /** 预渲染「真实感」星点：亮核 + 光晕 + 四芒星芒，绘制时只 drawImage。 */
    function starSprite(color, size) {
      const key = `${color}|${size.toFixed(1)}`
      const cached = sprites.get(key)
      if (cached) return cached
      const S = 128
      const c = document.createElement('canvas')
      c.width = S
      c.height = S
      const g = c.getContext('2d')
      if (!g) return c
      const cx = S / 2
      const cy = S / 2
      const R = 42

      const halo = g.createRadialGradient(cx, cy, 0, cx, cy, R)
      halo.addColorStop(0, rgba(color, 0.46))
      halo.addColorStop(0.08, rgba(color, 0.26))
      halo.addColorStop(0.26, rgba(color, 0.075))
      halo.addColorStop(0.55, rgba(color, 0.026))
      halo.addColorStop(1, rgba(color, 0))
      g.fillStyle = halo
      g.fillRect(0, 0, S, S)

      const spike = (angle, len, width, alpha) => {
        g.save()
        g.translate(cx, cy)
        g.rotate(angle)
        g.globalCompositeOperation = 'lighter'
        const lg = g.createLinearGradient(0, 0, len, 0)
        lg.addColorStop(0, 'rgba(255,255,255,0.95)')
        lg.addColorStop(0.05, rgba(color, 0.75))
        lg.addColorStop(0.3, rgba(color, alpha))
        lg.addColorStop(1, rgba(color, 0))
        g.fillStyle = lg
        g.beginPath()
        g.moveTo(0, -width)
        g.lineTo(len, 0)
        g.lineTo(0, width)
        g.closePath()
        g.fill()
        g.restore()
      }
      for (let k = 0; k < 4; k++) spike((Math.PI / 2) * k, R * 1.25, 1.35, 0.16)
      spike(Math.PI / 4, R * 0.72, 0.7, 0.08)
      spike((Math.PI / 4) * 3, R * 0.72, 0.7, 0.08)

      const core = g.createRadialGradient(cx, cy, 0, cx, cy, size * 1.6)
      core.addColorStop(0, 'rgba(255,255,255,1)')
      core.addColorStop(0.3, rgba('#ffffff', 0.98))
      core.addColorStop(0.55, rgba(color, 0.85))
      core.addColorStop(1, rgba(color, 0))
      g.fillStyle = core
      g.beginPath()
      g.arc(cx, cy, size * 1.6, 0, Math.PI * 2)
      g.fill()

      sprites.set(key, c)
      return c
    }

    /** 旋臂尘埃板：预渲染一次，每帧只转着画一遍。 */
    function makePlate(size, dpr, count, outer) {
      const c = document.createElement('canvas')
      c.width = Math.round(size * dpr)
      c.height = Math.round(size * dpr)
      const p = c.getContext('2d')
      if (!p) return c
      p.setTransform(dpr, 0, 0, dpr, 0, 0)
      p.translate(size / 2, size / 2)
      const half = size / 2

      // 先把三条旋臂的「云气」铺出来，再撒星点，臂才看得出来
      if (!outer) {
        for (let i = 0; i < 260; i++) {
          const arm = i % 3
          const rr = Math.pow(Math.random(), 0.7) * half * 0.96
          const aa = arm * ((Math.PI * 2) / 3) + (rr / half) * 2.7 + (Math.random() - 0.5) * 0.3
          const x = Math.cos(aa) * rr
          const y = Math.sin(aa) * rr
          const rad = 18 + Math.random() * 46
          const grd = p.createRadialGradient(x, y, 0, x, y, rad)
          grd.addColorStop(0, 'rgba(150,176,255,.035)')
          grd.addColorStop(0.5, 'rgba(120,146,235,.015)')
          grd.addColorStop(1, 'rgba(120,146,235,0)')
          p.fillStyle = grd
          p.beginPath()
          p.arc(x, y, rad, 0, Math.PI * 2)
          p.fill()
        }
        const coreHaze = p.createRadialGradient(0, 0, 0, 0, 0, half * 0.34)
        coreHaze.addColorStop(0, 'rgba(255,228,185,.10)')
        coreHaze.addColorStop(0.45, 'rgba(255,206,150,.04)')
        coreHaze.addColorStop(1, 'rgba(255,206,150,0)')
        p.fillStyle = coreHaze
        p.beginPath()
        p.arc(0, 0, half * 0.34, 0, Math.PI * 2)
        p.fill()
      }
      for (let i = 0; i < count; i++) {
        const arm = i % 3
        const rr = Math.pow(Math.random(), outer ? 0.55 : 0.72) * half * 0.98
        const aa = arm * ((Math.PI * 2) / 3) + (rr / half) * 2.7 + (Math.random() - 0.5) * (outer ? 0.6 : 0.45)
        const al = (outer ? 0.018 : 0.04) + Math.random() * (outer ? 0.055 : 0.12)
        const warm = Math.random() > (outer ? 0.9 : 0.8)
        p.fillStyle = warm
          ? `rgba(255,236,208,${al.toFixed(3)})`
          : `rgba(196,212,255,${al.toFixed(3)})`
        p.beginPath()
        p.arc(Math.cos(aa) * rr, Math.sin(aa) * rr, 0.3 + Math.random() * (outer ? 0.7 : 0.9), 0, Math.PI * 2)
        p.fill()
      }
      return c
    }

    /** 预渲染：星云 + 星系盘 + 银河带 + 尘埃 + 星点 + 光斑 + 两片旋臂板。 */
    function buildBackground() {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cw = Math.max(1, Math.round(W * dpr))
      const ch = Math.max(1, Math.round(H * dpr))

      bgStatic = document.createElement('canvas')
      bgStatic.width = cw
      bgStatic.height = ch
      const g = bgStatic.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)

      const base = g.createLinearGradient(0, 0, 0, H)
      base.addColorStop(0, '#05060e')
      base.addColorStop(0.5, '#070a16')
      base.addColorStop(1, '#03040a')
      g.fillStyle = base
      g.fillRect(0, 0, W, H)

      const nebulae = [
        [0.18, 0.24, 0.55, '126,92,255', 0.07],
        [0.82, 0.2, 0.42, '64,148,255', 0.05],
        [0.68, 0.74, 0.5, '255,118,182', 0.038],
        [0.26, 0.78, 0.46, '64,214,206', 0.035],
        [0.52, 0.46, 0.62, '255,196,132', 0.045],
        [0.4, 0.62, 0.3, '150,120,255', 0.05],
      ]
      g.save()
      g.globalCompositeOperation = 'lighter'
      for (const [nx, ny, nr, rgb, na] of nebulae) {
        const rad = Math.max(W, H) * nr
        const ng = g.createRadialGradient(W * nx, H * ny, 0, W * nx, H * ny, rad)
        ng.addColorStop(0, `rgba(${rgb},${na})`)
        ng.addColorStop(0.45, `rgba(${rgb},${na * 0.35})`)
        ng.addColorStop(1, `rgba(${rgb},0)`)
        g.fillStyle = ng
        g.fillRect(0, 0, W, H)
      }
      g.restore()

      g.save()
      g.translate(CX, CY)
      g.scale(1, KY)
      const disk = g.createRadialGradient(0, 0, R0 * 0.04, 0, 0, R1 * 1.6)
      disk.addColorStop(0, 'rgba(255,236,200,.14)')
      disk.addColorStop(0.12, 'rgba(255,214,160,.09)')
      disk.addColorStop(0.34, 'rgba(168,184,255,.12)')
      disk.addColorStop(0.62, 'rgba(92,108,196,.05)')
      disk.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = disk
      g.fillRect(-R1 * 1.7, -R1 * 1.7, R1 * 3.4, R1 * 3.4)
      g.restore()

      // 星河：一条宽的、一条更细的交叉星流；主河带里再压一条暗尘带
      const riverGauss = () => {
        const u = Math.random() || 1e-6
        const v = Math.random() || 1e-6
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      }

      const drawStream = (q, opts) => {
        const c = Math.cos(opts.angle)
        const s = Math.sin(opts.angle)
        const span = Math.hypot(W, H) * (opts.span || 0.55)
        const width = Math.min(W, H) * opts.width
        const shift = opts.shift || 0
        const warmOK = opts.warm !== false
        const at = (t, off) => [CX + c * t * span - s * (shift + off), CY + s * t * span + c * (shift + off)]

        q.save()
        q.globalCompositeOperation = 'lighter'
        for (let i = 0; i < (opts.haze || 0); i++) {
          const t = Math.random() * 2 - 1
          const off = riverGauss() * width * 0.7 + Math.sin(t * 3.1) * width * 0.55
          const p = at(t, off)
          const rad = (opts.hazeRad || 36) + Math.random() * (opts.hazeSpread || 110)
          const grd = q.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad)
          const a = (opts.hazeAlpha || 0.03) + Math.random() * (opts.hazeAlpha2 || 0.04)
          grd.addColorStop(0, `rgba(168,190,255,${a.toFixed(3)})`)
          grd.addColorStop(0.55, 'rgba(120,146,235,0.012)')
          grd.addColorStop(1, 'rgba(120,146,235,0)')
          q.fillStyle = grd
          q.beginPath()
          q.arc(p[0], p[1], rad, 0, Math.PI * 2)
          q.fill()
        }
        for (let i = 0; i < (opts.coreHaze || 0); i++) {
          const t = Math.random() * 2 - 1
          const off = riverGauss() * width * 0.3 + Math.sin(t * 3.1) * width * 0.6
          const p = at(t, off)
          const rad = 14 + Math.random() * 34
          const grd = q.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad)
          grd.addColorStop(0, `rgba(206,220,255,${(0.05 + Math.random() * 0.05).toFixed(3)})`)
          grd.addColorStop(1, 'rgba(160,180,255,0)')
          q.fillStyle = grd
          q.beginPath()
          q.arc(p[0], p[1], rad, 0, Math.PI * 2)
          q.fill()
        }
        q.restore()

        const stars = (count, w, aMin, aMax, sizeMax) => {
          for (let i = 0; i < count; i++) {
            const t = Math.random() * 2 - 1
            const off = riverGauss() * width * w + Math.sin(t * 3.1) * width * 0.6
            const p = at(t, off)
            if (p[0] < -4 || p[0] > W + 4 || p[1] < -4 || p[1] > H + 4) continue
            const pick = Math.random()
            const al = aMin + Math.random() * (aMax - aMin)
            const size = pick > 0.99 ? sizeMax * 1.5 : pick > 0.9 ? sizeMax : sizeMax * 0.6
            const warm = warmOK && Math.random() > 0.86
            q.fillStyle = warm
              ? `rgba(255,226,190,${al.toFixed(3)})`
              : `rgba(220,232,255,${al.toFixed(3)})`
            q.fillRect(p[0], p[1], size, size)
          }
        }
        // 发光的河芯：一条连续的亮丝，星点再叠在上面
        if (opts.filament) {
          const steps = 200
          const pts = []
          for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * 2 - 1
            pts.push(at(t, Math.sin(t * 3.1) * width * 0.55))
          }
          q.save()
          q.globalCompositeOperation = 'lighter'
          q.lineCap = 'round'
          q.lineJoin = 'round'
          const widths = opts.filamentWidths || [3, 9, 22, 46]
          const alphas = opts.filamentAlphas || [0.35, 0.12, 0.045, 0.02]
          for (let layer = 0; layer < widths.length; layer++) {
            q.lineWidth = widths[layer]
            q.strokeStyle = `rgba(214,228,255,${alphas[layer]})`
            q.beginPath()
            pts.forEach((p, i) => {
              if (i === 0) q.moveTo(p[0], p[1])
              else q.lineTo(p[0], p[1])
            })
            q.stroke()
          }
          q.restore()
        }

        const wA = opts.wideAlpha || [0.04, 0.3]
        const cA = opts.coreAlpha || [0.16, 0.92]
        stars(opts.wide || 0, 1.9, wA[0], wA[1], 0.5)
        stars(opts.core || 0, 0.5, cA[0], cA[1], 0.8)

        // 暗尘带：沿河偏一点，用几层软笔触压出一条暗带
        if (opts.dust) {
          for (let i = 0; i < 260; i++) {
            const t = Math.random() * 2 - 1
            const wob = Math.sin(t * 4.6 + 1.2) * 0.2
            const p = at(t, width * (0.5 + wob) + riverGauss() * width * 0.12)
            const rad = 9 + Math.random() * 22
            const grd = q.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad)
            grd.addColorStop(0, `rgba(2,3,8,${(0.12 + Math.random() * 0.1).toFixed(3)})`)
            grd.addColorStop(1, 'rgba(2,3,8,0)')
            q.fillStyle = grd
            q.beginPath()
            q.arc(p[0], p[1], rad, 0, Math.PI * 2)
            q.fill()
          }
        }

        for (let i = 0; i < (opts.bright || 0); i++) {
          const t = Math.random() * 2 - 1
          const off = riverGauss() * width * 0.45 + Math.sin(t * 3.1) * width * 0.6
          const p = at(t, off)
          const rad = 5 + Math.random() * 11
          const grd = q.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad)
          grd.addColorStop(0, 'rgba(255,248,236,.8)')
          grd.addColorStop(0.3, 'rgba(210,226,255,.16)')
          grd.addColorStop(1, 'rgba(180,200,255,0)')
          q.fillStyle = grd
          q.beginPath()
          q.arc(p[0], p[1], rad, 0, Math.PI * 2)
          q.fill()
        }
      }

      const river = document.createElement('canvas')
      river.width = cw
      river.height = ch
      const rq = river.getContext('2d')
      if (rq) {
        rq.setTransform(dpr, 0, 0, dpr, 0, 0)
        // 主星河：从一角铺到另一角，带暗尘带
        drawStream(rq, {
          angle: -0.45,
          width: 0.06,
          wide: 7200,
          core: 7400,
          bright: 110,
          haze: 46,
          coreHaze: 56,
          hazeAlpha: 0.012,
          hazeAlpha2: 0.02,
          dust: true,
        })
        bgRiver = river
      }
      g.save()
      g.translate(CX, CY)
      g.rotate(-0.45)
      g.scale(1, 0.42)
      const band = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H) * 0.62)
      band.addColorStop(0, 'rgba(180,198,255,.085)')
      band.addColorStop(0.3, 'rgba(128,150,238,.035)')
      band.addColorStop(0.65, 'rgba(74,92,180,.014)')
      band.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = band
      g.fillRect(-W * 2, -W * 2, W * 4, W * 4)
      g.restore()


      const tint = () => {
        const r = Math.random()
        if (r > 0.9) return '255,214,170'
        if (r > 0.72) return '190,210,255'
        if (r > 0.5) return '226,233,255'
        return '248,250,255'
      }
      let i
      for (i = 0; i < 2200; i++) {
        const x = Math.random() * W
        const y = Math.random() * H
        const al = 0.03 + Math.random() * 0.4
        g.fillStyle = `rgba(${tint()},${al.toFixed(3)})`
        const sz = Math.random() > 0.94 ? 1.4 : 0.6
        g.fillRect(x, y, sz, sz)
      }
      for (i = 0; i < 3200; i++) {
        const rr = R0 * 0.28 + Math.random() * R1 * 1.35
        const ang = Math.random() * Math.PI * 2
        const x = CX + Math.cos(ang) * rr + (Math.random() - 0.5) * W * 0.03
        const y = CY + Math.sin(ang) * rr * KY + (Math.random() - 0.5) * H * 0.03
        if (x < 0 || x > W || y < 0 || y > H) continue
        const r = Math.random()
        const al = Math.max(0.04, (0.16 + Math.random() * 0.62) * (1 - rr / (R1 * 1.8)))
        g.fillStyle = `rgba(${tint()},${al.toFixed(3)})`
        g.beginPath()
        g.arc(x, y, r > 0.98 ? 1.15 : 0.5, 0, Math.PI * 2)
        g.fill()
      }

      const vig = g.createRadialGradient(CX, CY, Math.min(W, H) * 0.3, CX, CY, Math.max(W, H) * 0.8)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(0.6, 'rgba(0,0,0,.16)')
      vig.addColorStop(1, 'rgba(0,0,0,.58)')
      g.fillStyle = vig
      g.fillRect(0, 0, W, H)


      for (i = 0; i < 30; i++) {
        const rr = R0 * 0.4 + Math.random() * R1 * 1.35
        const ang = Math.random() * Math.PI * 2
        const x = CX + Math.cos(ang) * rr
        const y = CY + Math.sin(ang) * rr * KY
        const rad = 4 + Math.random() * 8
        const warm = Math.random() > 0.82
        const glow = g.createRadialGradient(x, y, 0, x, y, rad)
        glow.addColorStop(0, warm ? 'rgba(255,232,196,.75)' : 'rgba(224,236,255,.7)')
        glow.addColorStop(0.35, warm ? 'rgba(255,206,150,.16)' : 'rgba(170,196,255,.14)')
        glow.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = glow
        g.beginPath()
        g.arc(x, y, rad, 0, Math.PI * 2)
        g.fill()
      }

      // 横贯中心的镜头光斑
      g.save()
      g.globalCompositeOperation = 'lighter'
      const flare = g.createLinearGradient(CX - W * 0.42, CY, CX + W * 0.42, CY)
      flare.addColorStop(0, 'rgba(255,214,160,0)')
      flare.addColorStop(0.42, 'rgba(255,220,175,.05)')
      flare.addColorStop(0.5, 'rgba(255,240,210,.14)')
      flare.addColorStop(0.58, 'rgba(255,220,175,.05)')
      flare.addColorStop(1, 'rgba(255,214,160,0)')
      g.fillStyle = flare
      g.fillRect(CX - W * 0.42, CY - 1, W * 0.84, 2)
      const flareV = g.createLinearGradient(CX, CY - H * 0.32, CX, CY + H * 0.32)
      flareV.addColorStop(0, 'rgba(200,220,255,0)')
      flareV.addColorStop(0.48, 'rgba(220,232,255,.05)')
      flareV.addColorStop(0.5, 'rgba(240,246,255,.12)')
      flareV.addColorStop(0.52, 'rgba(220,232,255,.05)')
      flareV.addColorStop(1, 'rgba(200,220,255,0)')
      g.fillStyle = flareV
      g.fillRect(CX - 1, CY - H * 0.32, 2, H * 0.64)
      g.restore()

      twinkles = []
      for (i = 0; i < 190; i++) {
        const rr = R0 * 0.2 + Math.random() * R1 * 1.45
        const ang = Math.random() * Math.PI * 2
        twinkles.push({
          x: CX + Math.cos(ang) * rr,
          y: CY + Math.sin(ang) * rr * KY,
          size: 0.6 + Math.random() * 1.2,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 1.8,
          amp: 0.22 + Math.random() * 0.6,
        })
      }

      const size = Math.ceil(R1 * 2.7)
      bgPlate = makePlate(size, dpr, 3000, false)
      bgPlate2 = makePlate(size * 1.12, dpr, 1300, true)
    }

    function spawnMeteor() {
      meteors.push({
        x: Math.random() * W * 1.2 - W * 0.1,
        y: -30 + Math.random() * H * 0.25,
        ang: 0.45 + Math.random() * 0.35,
        len: 130 + Math.random() * 130,
        speed: 420 + Math.random() * 320,
        t0: clock,
        life: 0.8 + Math.random() * 0.7,
      })
    }

    /** 每帧：静态底图 + 两层旋臂 + 闪烁 + 流星 + 记忆星。 */
    function renderFrame() {
      const ctx = canvas.getContext('2d')
      if (!ctx || !bgStatic) return
      if (canvas.width !== bgStatic.width || canvas.height !== bgStatic.height) {
        canvas.width = bgStatic.width
        canvas.height = bgStatic.height
      }
      const dpr = canvas.width / Math.max(1, W)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(bgStatic, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (bgPlate2) {
        const s2 = bgPlate2.width / dpr
        ctx.save()
        ctx.translate(CX, CY)
        ctx.scale(1, KY)
        ctx.rotate(-clock * 0.014)
        ctx.globalAlpha = 0.55
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(bgPlate2, -s2 / 2, -s2 / 2, s2, s2)
        ctx.restore()
      }
      if (bgPlate) {
        const size = bgPlate.width / dpr
        ctx.save()
        ctx.translate(CX, CY)
        ctx.scale(1, KY)
        ctx.rotate(clock * 0.025)
        ctx.globalAlpha = 0.95
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(bgPlate, -size / 2, -size / 2, size, size)
        ctx.restore()
      }

      if (bgRiver) {
        ctx.drawImage(bgRiver, 0, 0, W, H)
      }

      for (let k = 0; k < twinkles.length; k++) {
        const t = twinkles[k]
        const a = t.amp * (0.5 + 0.5 * Math.sin(clock * t.speed + t.phase))
        ctx.fillStyle = `rgba(228,236,255,${Math.max(0.02, a).toFixed(3)})`
        ctx.fillRect(t.x, t.y, t.size, t.size)
      }

      for (let k = 0; k < meteors.length; k++) {
        const m = meteors[k]
        const p = (clock - m.t0) / m.life
        if (p >= 1) continue
        const travel = p * m.speed
        const x = m.x + Math.cos(m.ang) * travel
        const y = m.y + Math.sin(m.ang) * travel
        const tail = m.len * (1 - p * 0.35)
        const x2 = x - Math.cos(m.ang) * tail
        const y2 = y - Math.sin(m.ang) * tail
        const lg = ctx.createLinearGradient(x2, y2, x, y)
        const a = 1 - p
        lg.addColorStop(0, 'rgba(200,220,255,0)')
        lg.addColorStop(0.65, `rgba(200,220,255,${(0.3 * a).toFixed(3)})`)
        lg.addColorStop(1, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`)
        ctx.strokeStyle = lg
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(x2, y2)
        ctx.lineTo(x, y)
        ctx.stroke()
      }
      meteors = meteors.filter((m) => clock - m.t0 < m.life)

      const breathe = 0.92 + 0.08 * Math.sin(clock * 0.7)
      const glow = ctx.createRadialGradient(CX, CY, 0, CX, CY, R1 * 0.5 * breathe)
      glow.addColorStop(0, 'rgba(255,226,180,.10)')
      glow.addColorStop(0.35, 'rgba(170,190,255,.05)')
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(CX, CY, R1 * 0.5 * breathe, 0, Math.PI * 2)
      ctx.fill()

      if (stars.length) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let k = 0; k < stars.length; k++) {
          const s = stars[k]
          const sel = k === index
          const hov = k === hover
          const tw = 0.74 + 0.26 * Math.sin(clock * s.twSpeed + s.twPhase)
          const scale = (sel ? 1.62 : hov ? 1.3 : 1) * s.scale
          const dim = index >= 0 && !sel ? 0.8 : 1
          ctx.globalAlpha = (sel ? 0.94 + 0.06 * Math.sin(clock * 2.2) : hov ? 0.98 : tw) * dim
          const spr = starSprite(s.color, s.size)
          const d = 128 * scale
          ctx.drawImage(spr, s.x - d / 2, s.y - d / 2, d, d)
        }
        ctx.restore()

        if (index >= 0 && stars[index]) {
          const s = stars[index]
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          const hg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 48)
          hg.addColorStop(0, rgba(s.color, 0.16))
          hg.addColorStop(0.55, rgba(s.color, 0.05))
          hg.addColorStop(1, rgba(s.color, 0))
          ctx.fillStyle = hg
          ctx.beginPath()
          ctx.arc(s.x, s.y, 48, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
          ctx.save()
          ctx.strokeStyle = rgba(s.color, 0.8)
          ctx.lineWidth = 1.2
          ctx.setLineDash([3, 5])
          ctx.beginPath()
          ctx.arc(s.x, s.y, 18 + Math.sin(clock * 2) * 2, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
      }
    }

    function starHash(text) {
      let hsh = 2166136261
      for (let i = 0; i < text.length; i++) {
        hsh ^= text.charCodeAt(i)
        hsh = Math.imul(hsh, 16777619)
      }
      hsh += 0x6d2b79f5
      let t = hsh
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    function buildStars() {
      nodes.innerHTML = ''
      stars = []
      const n = memories.length
      memories.forEach((m, i) => {
        const arm = i % 3
        let rn = ((i * 7) % n) / Math.max(1, n - 1)
        rn = (rn + arm * 0.09) % 1
        const a0 = arm * ((Math.PI * 2) / 3) + rn * 2.3 + (starHash(`${m.id}${i}`) - 0.5) * 0.24
        const el = h('button', {
          class: 'bfc-starmap__node',
          type: 'button',
          title: `${m.date} · ${m.title}`,
        }, h('b', { text: starTwo(i + 1) }))
        el.style.setProperty('--c', m.color)
        el.addEventListener('pointerenter', () => {
          slow = true
          hover = i
          el.classList.add('is-hover')
          peekQuote(i)
          card.classList.remove('show')
        })
        el.addEventListener('pointerleave', () => {
          slow = false
          if (hover === i) hover = -1
          el.classList.remove('is-hover')
          if (memories.length) card.classList.add('show')
        })
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          select(i)
          openDetail(i)
        })
        nodes.append(el)
        stars.push({
          el,
          rn,
          a0,
          x: CX,
          y: CY,
          color: m.color,
          size: 2.2 + m.salience * 2.6,
          scale: 0.58 + m.salience * 0.42,
          twPhase: starHash(`${m.id}t`) * Math.PI * 2,
          twSpeed: 0.8 + starHash(`${m.id}s`) * 1.6,
        })
      })
    }

    function paint() {
      for (const s of stars) {
        const r = R0 + s.rn * (R1 - R0)
        const a = s.a0 + BASE_SPEED * Math.pow(R0 / r, 0.6) * clock
        s.x = CX + Math.cos(a) * r
        s.y = CY + Math.sin(a) * r * KY
        s.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%,-50%)`
      }
    }

    /** 划过星星时只把引句亮出来，不弹卡片。 */
    function peekQuote(i) {
      const m = memories[i]
      if (!m) return
      quote.textContent = m.quote
      quote.classList.remove('is-on')
      void quote.offsetWidth
      quote.classList.add('is-on')
      clearTimeout(quoteTimer)
      quoteTimer = setTimeout(() => {
        quote.classList.remove('is-on')
      }, 3000)
    }

    function select(i) {
      if (!memories.length) return
      index = ((i % memories.length) + memories.length) % memories.length
      const m = memories[index]
      for (let k = 0; k < nodes.children.length; k++) {
        nodes.children[k].classList.toggle('is-sel', k === index)
      }
      quote.textContent = m.quote
      quote.classList.remove('is-on')
      void quote.offsetWidth
      quote.classList.add('is-on')
      clearTimeout(quoteTimer)
      quoteTimer = setTimeout(() => {
        quote.classList.remove('is-on')
      }, 3000)
      card.style.setProperty('--c', m.color)
      cardDate.textContent = `${m.date} · ${m.kindLabel}`
      cardTitle.textContent = m.title
      cardText.textContent = m.text
      countEl.textContent = `${memories.length} 条 · ${index + 1}/${memories.length}`
    }


    function openDetail(i) {
      const m = memories[i]
      if (!m) return
      detail.innerHTML = ''
      const delBtn = h('button', { class: 'bfc-btn', text: '删除', onclick: () => onDelete() })
      const card = h('div', { class: 'bfc-starmap__detail-card' },
        h('div', { class: 'bfc-starmap__detail-head' },
          h('span', { class: 'bfc-starmap__detail-date', text: `${m.date} · ${m.kindLabel}` }),
          h('div', { class: 'bfc-spacer' }),
          delBtn,
          h('button', { class: 'bfc-btn', text: '编辑', onclick: () => beginEdit() }),
          h('button', { class: 'bfc-btn', text: '关闭', onclick: closeDetail })),
        h('h3', { class: 'bfc-starmap__detail-title', text: m.title }),
        h('p', { class: 'bfc-starmap__detail-text', text: m.text }))
      detail.append(card)
      detail.classList.add('is-on')

      // 删除：第一下变成确认，第二下才真删；Host 会先备份原文件。
      let delArmed = false
      let delTimer = 0
      async function onDelete() {
        if (!delArmed) {
          delArmed = true
          delBtn.textContent = '再点一次确认删除'
          delBtn.classList.add('bfc-btn--danger')
          clearTimeout(delTimer)
          delTimer = setTimeout(() => {
            delArmed = false
            delBtn.textContent = '删除'
            delBtn.classList.remove('bfc-btn--danger')
          }, 4000)
          return
        }
        clearTimeout(delTimer)
        delArmed = false
        delBtn.disabled = true
        delBtn.textContent = '删除中…'
        try {
          await api('/diary/delete', { id: m.id })
          const at = memories.findIndex((x) => x.id === m.id)
          if (at >= 0) memories.splice(at, 1)
          memorySig = memories.map((x) => `${x.id}:${x.text.length}`).join('|')
          closeDetail()
          buildStars()
          if (memories.length) {
            index = Math.min(index, memories.length - 1)
            select(index)
            if (countEl) countEl.textContent = `${memories.length} 条 · ${index + 1}/${memories.length}`
          } else {
            if (countEl) countEl.textContent = '0 条'
            quote.textContent = 'diary 里还没有记忆。'
          }
          toast('已删除这条记忆（原文件已备份）', 'ok')
        } catch (error) {
          delBtn.disabled = false
          delBtn.textContent = '删除'
          toast(`删除失败：${error.message}`, 'err')
        }
      }

      function beginEdit() {
        const ta = h('textarea', { class: 'bfc-starmap__edit' })
        ta.value = m.text
        const status = h('span', { class: 'bfc-starmap__edit-status', text: '保存前会自动备份原文件' })
        card.innerHTML = ''
        card.append(
          h('div', { class: 'bfc-starmap__detail-head' },
            h('span', { class: 'bfc-starmap__detail-date', text: `${m.date} · ${m.kindLabel}` }),
            status,
            h('div', { class: 'bfc-spacer' }),
            h('button', { class: 'bfc-btn', text: '取消', onclick: () => openDetail(i) }),
            h('button', { class: 'bfc-btn bfc-btn--primary', text: '保存', onclick: submit })),
          ta)
        ta.focus()

        async function submit() {
          const next = String(ta.value || '').trim()
          if (!next) {
            status.textContent = '不能为空'
            return
          }
          status.textContent = '保存中…'
          try {
            await api('/diary/entry', { id: m.id, text: next })
            m.text = next
            m.quote = starFirstSentence(next)
            m.title = starTitle(next)
            memorySig = memories.map((x) => `${x.id}:${x.text.length}`).join('|')
            openDetail(i)
            if (i === index) renderDetail()
          } catch (error) {
            status.textContent = `失败：${error.message}`
          }
        }
      }
    }

    function closeDetail() {
      detail.classList.remove('is-on')
    }

    detail.addEventListener('click', (ev) => {
      if (ev.target === detail) closeDetail()
    })

    /** 每 5 秒对一次记忆库：写进新记忆，星图上就会多一颗星。 */
    function startPolling() {
      clearInterval(pollTimer)
      pollTimer = setInterval(async () => {
        if (!modal.isConnected) {
          clearInterval(pollTimer)
          return
        }
        if (document.hidden) return
        try {
          const list = await fetchStarMemories()
          const next = list.map((m) => `${m.id}:${m.text.length}`).join('|')
          if (!next || next === memorySig) return
          memorySig = next
          const keep = memories[index]?.id
          memories = list
          if (!memories.length) return
          buildStars()
          const pos = memories.findIndex((m) => m.id === keep)
          select(pos >= 0 ? pos : memories.length - 1)
        } catch {
          /* 读不到就等下一轮，不打扰 */
        }
      }, 5000)
    }

    function frame(ts) {
      if (!modal.isConnected) {
        cancelAnimationFrame(raf)
        clearInterval(pollTimer)
        clearTimeout(quoteTimer)
        window.removeEventListener('resize', onResize)
        document.removeEventListener('keydown', onKey, true)
        slow = false
        return
      }
      if (!lastTs) lastTs = ts
      const dt = Math.min(0.08, (ts - lastTs) / 1000)
      lastTs = ts
      if (!document.hidden) clock += dt * (slow ? 0.25 : 1)
      if (!document.hidden && Math.random() < dt * 0.1) spawnMeteor()
      paint()
      renderFrame()
      raf = requestAnimationFrame(frame)
    }

    function onResize() {
      measure()
      buildBackground()
      paint()
      renderFrame()
    }

    function onKey(ev) {
      if (!modal.isConnected) return
      if (ev.key === 'Escape' && detail.classList.contains('is-on')) {
        ev.preventDefault()
        ev.stopPropagation()
        closeDetail()
        return
      }
      if (ev.key === 'ArrowRight') {
        ev.preventDefault()
        select(index + 1)
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault()
        select(index - 1)
      }
    }

    window.addEventListener('resize', onResize)
    document.addEventListener('keydown', onKey, true)

    measure()
    buildBackground()
    renderFrame()
    // 首帧尺寸可能还没稳定（模态刚插入），下一帧再量一次
    requestAnimationFrame(() => {
      measure()
      buildBackground()
      renderFrame()
    })

    fetchStarMemories()
      .then((list) => {
        memories = list
        if (!list.length) {
          quote.textContent = 'diary 里还没有记忆。'
          quote.classList.add('is-on')
          countEl.textContent = '0 条'
          return
        }
        buildStars()
        select(list.length - 1)
        memorySig = list.map((m) => `${m.id}:${m.text.length}`).join('|')
        lastTs = 0
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(frame)
        startPolling()
      })
      .catch((error) => {
        quote.textContent = `读取记忆失败：${error.message}`
        quote.classList.add('is-on')
        countEl.textContent = '读取失败'
      })
  }

  try {
    window.__BFC_STARMAP__ = openStarMap
  } catch {
    /* 调试钩子，挂不上不影响 */
  }

  function resetDrafts() {
    S.drafts.clear()
    S.invalid.clear()
    S.saved.clear()
    renderCanvas()
    renderDrawer()
    renderFooter()
    toast('已丢弃草稿')
  }

  async function saveDrafts() {
    if (!S.drafts.size) return
    const patch = {}
    for (const [k, v] of S.drafts) {
      if (v === '' && S.values[`${k}__saved`]) continue // 空 secret = 不修改
      patch[k] = v
    }
    if (!Object.keys(patch).length) {
      S.drafts.clear()
      renderFooter()
      return
    }
    const touched = [...new Set(Object.keys(patch).map((k) => S.keyToNode.get(k)).filter(Boolean))]
    try {
      const res = await api('/apply', { patch })
      S.values = res.values
      S.drafts.clear()
      S.invalid.clear()
      S.saved = new Set(touched)
      if (res.requiresRestart) {
        toast('已写入 config.json；连接/模型类参数需要重启桥接才生效', 'ok', {
          label: '立即重启桥接',
          run: async () => {
            try {
              await api('/service', { action: 'restart-bridge' })
              toast('桥接重启中…', 'ok')
              setTimeout(() => refreshStatus(true), 3000)
            } catch (e) {
              toast(`重启失败：${e.message}`, 'err')
            }
          },
        })
      } else {
        toast('已保存并热同步', 'ok')
      }
      renderCanvas()
      renderDrawer()
      renderFooter()
      refreshStatus(true)
      setTimeout(() => {
        S.saved.clear()
        renderCanvas()
      }, 2600)
    } catch (e) {
      const errors = e.data?.errors || {}
      for (const [k, msg] of Object.entries(errors)) S.invalid.set(k, msg)
      renderCanvas()
      renderDrawer()
      toast(e.message || '保存失败', 'err')
    }
  }

  async function refreshStatus(verbose = false) {
    try {
      S.status = await api('/status')
    } catch {
      S.status = null
      if (verbose) toast('状态探测失败：DSH 路由没响应', 'err')
    }
    renderStatus()
  }

  async function backupNow() {
    try {
      const res = await api('/backup', {})
      toast(`已备份到 ${res.target}`, 'ok')
    } catch (e) {
      toast(`备份失败：${e.message}`, 'err')
    }
  }

  async function exportJson() {
    try {
      const res = await fetch(`${API}/export`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const blob = new Blob([text], { type: 'application/json' })
      const a = h('a', { href: URL.createObjectURL(blob), download: `star-console-${Date.now()}.json` })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      toast('已导出 JSON', 'ok')
    } catch (e) {
      toast(`导出失败：${e.message}`, 'err')
    }
  }

  function importJson() {
    const input = h('input', { type: 'file', accept: '.json,application/json' })
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const payload = JSON.parse(await file.text())
        const res = await api('/import', { payload })
        await reload()
        toast(`已导入（备份：${res.backup}）`, 'ok')
      } catch (e) {
        toast(`导入失败：${e.message}`, 'err')
      }
    })
    input.click()
  }

  function openRoleEditor(name) {
    const modal = h('div', { class: 'bfc-modal' })
    const box = h('div', { class: 'bfc-modal__box' })
    const body = h('div', { class: 'bfc-modal__body' })
    const ta = h('textarea', { class: 'bfc-textarea' })
    const status = h('span', { class: 'bfc-footer__note' })
    const close = () => modal.remove()
    box.append(
      h('div', { class: 'bfc-modal__head' },
        h('strong', { text: `编辑人格卡：${name}` }),
        h('div', { class: 'bfc-spacer' }),
        status),
      body,
      h('div', { class: 'bfc-modal__foot' },
        h('button', { class: 'bfc-btn', text: '取消', onclick: close }),
        h('button', {
          class: 'bfc-btn bfc-btn--primary',
          text: '保存并启用',
          onclick: async () => {
            try {
              await api('/role', { op: 'save', name, content: ta.value })
              await api('/role/select', { role: name })
              status.textContent = '已保存'
              toast('人格卡已保存并启用（下一条消息生效）', 'ok')
              close()
            } catch (e) {
              status.textContent = `失败：${e.message}`
            }
          },
        })),
    )
    body.append(ta)
    modal.append(box)
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) close()
    })
    document.body.append(modal)
    api('/role', { op: 'read', name })
      .then((res) => {
        ta.value = res.content
      })
      .catch((e) => {
        ta.value = ''
        status.textContent = `读取失败：${e.message}`
      })
  }

  // 气泡容器：从下往上叠，超出 3 条就把最老的挤掉。
  function toastHost() {
    let host = document.getElementById('bfc-toasts')
    if (!host) {
      host = h('div', { id: 'bfc-toasts', class: 'bfc-toasts' })
      document.body.append(host)
    }
    return host
  }

  // 每条气泡自己管自己的计时器。旧实现共用一个 S.toastTimer：
  // 新气泡一 clearTimeout 就把上一条的计时器掐了，上一条于是永远不消失，
  // 叠满右下角后连底下的按钮都点不到。
  function toast(message, kind = 'ok', extra) {
    const box = h('div', { class: `bfc-toast bfc-toast--${kind === 'err' ? 'err' : 'ok'}` },
      h('span', { text: message }))
    if (extra && typeof extra === 'object') {
      if (extra.href) {
        box.append(h('a', {
          class: 'bfc-toast__link',
          href: extra.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: extra.hrefLabel || extra.href,
        }))
      }
      if (typeof extra.run === 'function') {
        box.append(h('button', {
          class: 'bfc-btn',
          style: { marginLeft: '10px' },
          text: extra.label || '执行',
          onclick: () => {
            extra.run()
            box.remove()
          },
        }))
      }
    }
    const host = toastHost()
    box.title = '点击关闭'
    box.addEventListener('click', (ev) => {
      if (ev.target.closest('a, button')) return
      box.remove()
    })
    host.append(box)
    while (host.children.length > 3) host.firstElementChild.remove()
    setTimeout(() => box.remove(), extra ? 9000 : 3600)
  }

  // ── 画布交互 ──────────────────────────────────────────────────────────
  function bindCanvas(host) {
    host.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.bfc-node')) return
      S.dragging = { x: ev.clientX, y: ev.clientY, tx: S.tx, ty: S.ty }
      host.classList.add('bfc-canvas--dragging')
      host.setPointerCapture(ev.pointerId)
    })
    host.addEventListener('pointermove', (ev) => {
      if (!S.dragging) return
      S.tx = S.dragging.tx + (ev.clientX - S.dragging.x)
      S.ty = S.dragging.ty + (ev.clientY - S.dragging.y)
      const world = host.querySelector('.bfc-world')
      if (world) world.style.transform = `translate(${S.tx}px, ${S.ty}px) scale(${S.scale})`
    })
    host.addEventListener('pointerup', (ev) => {
      S.dragging = null
      host.classList.remove('bfc-canvas--dragging')
      try {
        host.releasePointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
    })
    host.addEventListener('wheel', (ev) => {
      ev.preventDefault()
      const rect = host.getBoundingClientRect()
      const mx = ev.clientX - rect.left
      const my = ev.clientY - rect.top
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1
      const next = Math.max(0.35, Math.min(1.6, S.scale * factor))
      S.tx = mx - ((mx - S.tx) * next) / S.scale
      S.ty = my - ((my - S.ty) * next) / S.scale
      S.scale = next
      const world = host.querySelector('.bfc-world')
      if (world) world.style.transform = `translate(${S.tx}px, ${S.ty}px) scale(${S.scale})`
    }, { passive: false })
  }

  // ── 打开 / 关闭 ───────────────────────────────────────────────────────
  // 客户端兜底：Host 还没重启时，schema 里新加的「记录清理」节点也先挂出来。
  function ensureRecordsNode(tree) {
    try {
      const branch = tree?.children?.find((n) => n.id === 'diary')
      if (!branch || !Array.isArray(branch.children)) return
      if (branch.children.some((n) => n.view?.kind === 'records')) return
      branch.children.push({
        id: 'diary.records',
        label: '记录清理',
        icon: '🧹',
        view: { kind: 'records' },
        fields: [],
        hint: '搜索日记记录，勾选删掉不想要的；只删日记，不动手记。',
      })
    } catch {
      /* 兜底失败不影响控制台 */
    }
  }

  /**
   * 客户端兜底：schema 里还没有「记忆星图」节点时，先把它挂到根上。
   * Host 重启后如果 schema 也加了同 id 的节点，这里会自动跳过。
   */
  function ensureStarmapNode(tree) {
    try {
      if (!tree || !Array.isArray(tree.children)) return
      if (tree.children.some((n) => n.view?.kind === 'starmap')) return
      tree.children.push({
        id: 'starmap',
        label: '记忆星图',
        icon: '🌌',
        view: { kind: 'starmap' },
        fields: [],
        hint: '把 diary 的记忆画成自转银河：点星星看正文。只读，不改记忆。',
      })
    } catch {
      /* 兜底失败不影响控制台 */
    }
  }

  async function reload() {
    const data = await api('/bootstrap')
    S.boot = data
    S.tree = data.tree
    ensureRecordsNode(S.tree)
    ensureStarmapNode(S.tree)
    S.values = data.values
    S.consumed = data.consumed || {}
    S.roles = data.roles || []
    S.paths = data.paths || {}
    S.nodeById = new Map()
    S.parentById = new Map()
    S.keyToNode = new Map()
    indexTree(S.tree, null)
    S.selected = S.nodeById.get('connection.addr') || null
    renderCanvas()
    renderDrawer()
    renderFooter()
  }

  /** 抽屉里正在编辑时不要重画抽屉，否则输入框会被重建、光标跳走。 */
  function drawerBusy() {
    const el = document.activeElement
    const drawer = S.overlay?.querySelector('.bfc-drawer')
    if (!el || !drawer) return false
    let cur = el
    while (cur) {
      if (cur === drawer) return true
      cur = cur.parentElement
    }
    return false
  }

  function clockText(ts) {
    const d = new Date(ts)
    const p = (n) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  function refreshNoteText() {
    if (!S.lastDataAt) return `自动刷新 ${S.autoRefresh ? '开' : '关'} · 还没刷新过`
    return `自动刷新 ${S.autoRefresh ? '开' : '关'} · 上次 ${clockText(S.lastDataAt)}`
  }

  function renderRefreshNote() {
    const el = S.overlay?.querySelector('#bfc-refresh-at')
    if (el) el.textContent = refreshNoteText()
  }

  /** 自动刷新：重拉配置/人格卡，但保留未保存的草稿与正在编辑的抽屉。 */
  async function refreshData(silent = true) {
    if (!S.overlay) return
    try {
      const data = await api('/bootstrap')
      const prev = JSON.stringify(S.values)
      S.boot = data
      S.roles = data.roles || []
      S.paths = data.paths || S.paths
      S.values = data.values || {}
      S.consumed = data.consumed || S.consumed
      S.lastDataAt = Date.now()
      const changed = JSON.stringify(S.values) !== prev
      if (changed) {
        renderCanvas()
        if (!S.drafts.size && !drawerBusy()) renderDrawer()
        renderFooter()
      }
      renderRefreshNote()
      if (!silent) toast(changed ? '刷新成功 · 数据有更新' : '刷新成功 · 没有变化', 'ok')
    } catch (error) {
      renderRefreshNote()
      if (!silent) toast(`刷新失败：${error.message}`, 'err')
    }
  }

  async function openConsole() {
    if (S.overlay) return
    const overlay = h('div', { class: 'bfc-overlay' })
    try {
      S.navCollapsed = localStorage.getItem('bfc-nav-collapsed') === '1'
    } catch {
      S.navCollapsed = false
    }
    const nav = h('aside', { class: 'bfc-nav' },
      h('div', { class: 'bfc-nav__head' },
        h('span', { class: 'bfc-nav__logo', text: '🐟' }),
        h('div', { class: 'bfc-nav__brand' }, h('b', { text: '星图' }), h('small', { text: '控制台' })),
        h('button', { class: 'bfc-nav__toggle', title: '收起 / 展开导航', text: '«', onclick: toggleNav })),
      h('div', { class: 'bfc-nav__list' }),
      h('div', { class: 'bfc-nav__foot' }))
    const main = h('div', { class: 'bfc-main' + (S.navCollapsed ? ' nav-collapsed' : '') },
      nav,
      h('div', { class: 'bfc-canvas' }),
      h('div', { class: 'bfc-drawer' },
        h('div', { class: 'bfc-drawer__head' }),
        h('div', { class: 'bfc-drawer__body' })))
    overlay.append(h('div', { class: 'bfc-header' }), main, h('div', { class: 'bfc-footer' }))
    document.body.append(overlay)
    S.overlay = overlay
    S.launcher?.style.setProperty('display', 'none')
    bindNavDrag(nav.querySelector('.bfc-nav__list'))
    startAmbient()
    const navToggle = overlay.querySelector('.bfc-nav__toggle')
    if (navToggle && S.navCollapsed) navToggle.textContent = '»'
    overlay.querySelector('.bfc-canvas').append(h('div', { class: 'bfc-splash', text: '正在驶入星系…' }))
    if (!S.resizeHooked) {
      S.resizeHooked = true
      window.addEventListener('resize', () => {
        if (S.overlay) renderCanvas()
      })
    }
    renderHeader()
    renderFooter()
    try {
      await reload()
      renderHeader() // bootstrap 之后重画一次，才能显示「DSH 地址待同步」这类提示
      S.overlay.querySelector('.bfc-splash')?.remove()
      await refreshStatus()
      clearInterval(S.statusTimer)
      S.statusTimer = setInterval(() => refreshStatus(), 6000)
      clearInterval(S.dataTimer)
      S.dataTimer = setInterval(() => {
        if (S.autoRefresh) refreshData()
      }, 10000)
    } catch (e) {
      overlay.querySelector('.bfc-canvas').innerHTML = ''
      overlay.querySelector('.bfc-canvas').append(h('div', { class: 'bfc-splash', text: `读取失败：${e.message}` }))
    }
  }

  function closeConsole() {
    if (!S.overlay) return
    clearInterval(S.statusTimer)
    clearInterval(S.dataTimer)
    for (const modal of Array.from(document.querySelectorAll('.bfc-modal--starmap'))) modal.remove()
    S.overlay.remove()
    S.overlay = null
    S.focusBranch = null
    S.orbit = null
    stopAmbient()
    S.launcher?.style.setProperty('display', 'flex')
  }

  // ── 启动 ──────────────────────────────────────────────────────────────
  function mountLauncher() {
    const dot = h('span', { class: 'bfc-launcher__dot' })
    const btn = h('button', {
      class: 'bfc-launcher',
      title: '星图控制台（Alt+Shift+B）',
      onclick: openConsole,
    }, h('span', { text: '🐟' }), h('span', { text: '星图' }), dot)
    document.body.append(btn)
    S.launcher = btn
    const paintStatus = (d) => {
      const on = d?.bridge?.online === true
      dot.classList.add(on ? 'bfc-launcher__dot--on' : 'bfc-launcher__dot--off')
      btn.title = on ? '星图控制台 · 桥接在线' : '星图控制台 · 桥接离线'
    }
    // DSH 每次重启都会换端口，旧标签页上的接口会整个连不上（不是返回错误）。
    // 重试一次仍然失败，就直接告诉用户「刷新」，别让人对着一个死页面瞎点。
    const probe = (retry) => {
      fetch(`${API}/status`)
        .then((r) => r.json())
        .then(paintStatus)
        .catch(() => {
          if (retry) {
            setTimeout(() => probe(false), 1500)
            return
          }
          dot.classList.add('bfc-launcher__dot--off')
          toast('连不上 DSH 接口：这个页面可能还停在重启前的旧端口，按 F5 刷新一下', 'err')
        })
    }
    probe(true)
  }

  function boot() {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', boot, { once: true })
      return
    }
    // 桌面端窗口按钮悬浮在顶部 42px，给顶栏多留一点上边距，避免按钮被盖住点不到。
    try {
      if (String(navigator?.userAgent || '').includes('Electron')) {
        document.documentElement.classList.add('bfc-electron')
      }
    } catch {
      /* 识别不了就算了 */
    }
    mountLauncher()
    // 页面整体刷新后给一次反馈：不然按了 F5 也不知道到底刷没刷。
    try {
      if (sessionStorage.getItem('bfc-just-reloaded') === '1') {
        sessionStorage.removeItem('bfc-just-reloaded')
        setTimeout(() => toast('刷新成功 · 控制台已重载', 'ok'), 300)
      }
    } catch {
      /* 无痕模式之类拿不到 storage，忽略 */
    }
    // 切回这个标签页时顺手刷一次：从别处改了配置（或她自己写的）回来就能看到
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S.overlay && S.autoRefresh) refreshData()
    })
    window.addEventListener('keydown', (ev) => {
      if (ev.altKey && ev.shiftKey && (ev.key === 'B' || ev.key === 'b')) {
        ev.preventDefault()
        if (S.overlay) closeConsole()
        else openConsole()
      } else if (ev.key === 'F5' || ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'r')) {
        ev.preventDefault()
        try {
          sessionStorage.setItem('bfc-just-reloaded', '1')
        } catch {
          /* 没有 storage 也照样刷新 */
        }
        location.reload()
      } else if (ev.key === 'Escape' && S.overlay) {
        const modal = document.querySelector('.bfc-modal')
        if (modal) modal.remove()
        else closeConsole()
      }
    })
  }

  boot()
})()
