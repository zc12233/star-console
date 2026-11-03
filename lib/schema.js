/**
 * 星图控制台 —— schema 单一事实源。
 *
 * 这里只描述「树长什么样、字段怎么渲染、值落在哪」三件事：
 *   - 每个 leaf 节点带 fields；branch 节点只有 children。
 *   - field.key 是点分路径，直接落进 bridge 的 config.json；少数 `custom.*` 前缀
 *     的键桥接并不消费，用于记录尚未实现的偏好（面板上会标「仅记录」）。
 *   - currentRole 是特例：落 state/current-role.json，不走 config.json。
 *
 * 客户端不硬编码任何字段，全部由 GET /star-console/api/bootstrap 下发，
 * 因此加字段只改这个文件。
 */

/** bridge 实际消费的键（其余 custom.* 只记录）。 */
export const CONSUMED_PREFIXES = [
  'dsh.', 'snowluma.', 'allow.', 'deny.', 'social.', 'socialV2.', 'agentPreset',
  'ownerQQ', 'ackMessage', 'allowAllWhenEmpty', 'role.', 'security.', 'console',
  'sendDelayMs', 'questionTimeoutMs', 'workspaceTitle', 'slang.', 'webSearch.',
]

/** 改完立即生效的路径（其余需要重启桥接）。 */
export const HOT_PATHS = [
  'allow.private', 'allow.groups', 'deny.private', 'deny.groups', 'ownerQQ', 'currentRole',
]

/** 默认值：config.json 里没有该键时，面板显示这个。 */
export const DEFAULTS = {
  'connection.protocol': 'onebot11',
  'snowluma.wsUrl': 'ws://127.0.0.1:3001',
  'snowluma.httpUrl': 'http://127.0.0.1:3000',
  'snowluma.silenceWarnMs': 600000,
  'dsh.baseUrl': 'http://127.0.0.1:56221',
  'dsh.provider': 'deepseek-account',
  'dsh.model': 'deepseek-flash',
  'dsh.reasoningEffort': 'high',
  'agentPreset': 'qq-chat',
  'socialV2.agentPreset': 'qq-chat-v2',
  'socialV2.context.recentLimit': 100,
  'socialV2.context.contextWindow': 20,
  'socialV2.context.unreadLimit': 30,
  'socialV2.send.maxMessageChars': 500,
  'socialV2.send.maxSendPerMinute': 8,
  'socialV2.send.maxSendPerHour': 60,
  'socialV2.send.burstMaxMessages': 8,
  'socialV2.proactive.enabled': true,
  'socialV2.proactive.probability': 0.3,
  'socialV2.proactive.checkIntervalMinMs': 1800000,
  'role.maxInjectChars': 6000,
  'allowAllWhenEmpty': false,
  'ackMessage': '',
}

const f = (key, label, type, extra = {}) => ({ key, label, type, ...extra })

export const TREE = {
  id: 'root',
  label: '星图',
  icon: '🐟',
  children: [
    {
      id: 'connection',
      label: '连接',
      icon: '🔌',
      children: [
        {
          id: 'connection.addr',
          label: '协议与地址',
          fields: [
            f('connection.protocol', '协议', 'enum', {
              options: ['onebot11', 'onebot12', 'satori', 'milky', 'qq-official'],
              requiresRestart: true,
              hint: 'bridge 只实现 OneBot v11；其它值是偏好记录，选中后群管理节点会置灰',
            }),
            f('snowluma.wsUrl', 'WebSocket 地址', 'string', { requiresRestart: true, placeholder: 'ws://127.0.0.1:3001' }),
            f('snowluma.httpUrl', 'HTTP 地址', 'string', { requiresRestart: true, placeholder: 'http://127.0.0.1:3000' }),
            f('dsh.baseUrl', 'DSH 地址', 'string', { requiresRestart: true, placeholder: 'http://127.0.0.1:56221' }),
            f('action:sync-dsh', '把 DSH 地址同步为当前端口', 'action'),
          ],
        },
        {
          id: 'connection.auth',
          label: '凭证',
          fields: [
            f('snowluma.accessToken', 'OneBot 令牌', 'secret'),
            f('dsh.authToken', 'DSH 启动令牌（通常留空）', 'secret'),
          ],
        },
        {
          id: 'connection.bind',
          label: '绑定与探测',
          fields: [
            f('action:open-snowluma', '打开 SnowLuma 扫码绑定', 'action'),
            f('action:probe', '重新探测连通性', 'action'),
          ],
        },
        {
          id: 'connection.retry',
          label: '重连策略',
          fields: [
            f('snowluma.followDiscoveredEndpoint', '跟随自动发现的端点', 'bool', { requiresRestart: true }),
            f('snowluma.silenceWarnMs', '静默告警阈值', 'number', { min: 60000, max: 3600000, step: 30000, unit: 'ms' }),
          ],
        },
      ],
    },
    {
      id: 'behavior',
      label: '对话行为',
      icon: '💬',
      children: [
        {
          id: 'behavior.model',
          label: '模型',
          fields: [
            f('dsh.provider', 'Provider', 'enum', { options: ['deepseek-account', 'deepseek-official'] }),
            f('dsh.model', '模型', 'string', { placeholder: 'deepseek-flash' }),
            f('dsh.reasoningEffort', '推理强度', 'enum', { options: ['low', 'medium', 'high', 'max'] }),
            f('dsh.temperature', '温度（仅记录）', 'number', { min: 0, max: 2, step: 0.1, custom: true }),
            f('features.streaming', '流式输出（仅记录）', 'bool', { custom: true }),
          ],
        },
        {
          id: 'behavior.preset',
          label: '预设与模式',
          fields: [
            f('agentPreset', '一代预设', 'enum', { options: ['qq-chat', 'qq-chat-v2'] }),
            f('socialV2.agentPreset', '二代预设', 'enum', { options: ['qq-chat', 'qq-chat-v2'] }),
            f('workspaceTitle', 'DSH 工作区名', 'string'),
          ],
        },
        {
          id: 'behavior.session',
          label: '会话与上下文',
          fields: [
            f('socialV2.context.recentLimit', '历史条数', 'number', { min: 10, max: 200, step: 10 }),
            f('socialV2.context.contextWindow', '上下文窗口', 'number', { min: 5, max: 100, step: 1 }),
            f('session.timeoutMs', '会话超时（仅记录）', 'number', { min: 60000, max: 86400000, step: 60000, unit: 'ms', custom: true }),
            f('questionTimeoutMs', '处理超时', 'number', { min: 30000, max: 900000, step: 30000, unit: 'ms' }),
          ],
        },
        {
          id: 'behavior.voice',
          label: '语音与唱歌',
          fields: [
            f('socialV2.voice.enabled', '允许发语音', 'bool', { hint: '总开关；关掉后 qq_list_voices / qq_send_voice 都会拒绝' }),
            f('socialV2.tools.sendVoice', '把语音工具交给模型', 'bool', { hint: '关掉只是模型看不到这两个工具，不影响你手动发' }),
            f('socialV2.voice.maxSeconds', '单条时长上限', 'number', { min: 5, max: 300, step: 5, unit: 's' }),
            f('socialV2.voice.maxPerHour', '每小时条数上限', 'number', { min: 1, max: 50, step: 1 }),
            f('socialV2.voice.loudness', '响度处理', 'enum', { options: ['quiet', 'normal', 'loud'] }),
            f('action:refresh-voices', '刷新语音库列表', 'action'),
          ],
        },
      ],
    },
    {
      id: 'voicekit',
      label: '嗓子与启动',
      icon: '🎤',
      children: [
        {
          id: 'voicekit.gsv',
          label: '启动 GPT-SoVITS（终端）',
          icon: '🗣️',
          action: { kind: 'service', action: 'start-gsv-term', label: '启动 GPT-SoVITS' },
        },
        {
          id: 'voicekit.gsv-stop',
          label: '停止 GPT-SoVITS',
          icon: '⏹️',
          action: { kind: 'service', action: 'stop-gsv', label: '停止 GPT-SoVITS' },
        },
        {
          id: 'voicekit.bridge',
          label: '桥接控制台（3100）',
          icon: '🌉',
          action: { kind: 'openUrl', url: 'http://127.0.0.1:3100' },
        },
        {
          id: 'voicekit.bridge-term',
          label: '桥接终端',
          icon: '🖥️',
          action: { kind: 'service', action: 'open-bridge-term', label: '打开桥接终端' },
        },
        {
          id: 'voicekit.snow',
          label: 'SnowLuma 控制台（5099）',
          icon: '❄️',
          action: { kind: 'openUrl', url: 'http://127.0.0.1:5099' },
        },
        {
          id: 'voicekit.snow-login',
          label: 'SnowLuma 一键登录（5099）',
          icon: '⚡',
          action: { kind: 'service', action: 'open-snowluma-login', label: '打开 SnowLuma 登录' },
        },
        {
          id: 'voicekit.snow-start',
          label: '启动 SnowLuma',
          icon: '▶️',
          action: { kind: 'service', action: 'start-snowluma', label: '启动 SnowLuma' },
        },
        {
          id: 'voicekit.snow-restart',
          label: '重启 SnowLuma',
          icon: '🔄',
          action: { kind: 'service', action: 'restart-snowluma', label: '重启 SnowLuma' },
        },
        {
          id: 'voicekit.snow-stop',
          label: '停止 SnowLuma',
          icon: '⏹️',
          action: { kind: 'service', action: 'stop-snowluma', label: '停止 SnowLuma' },
        },
      ],
    },
    {
      id: 'group',
      label: '群聊规则',
      icon: '👥',
      disabledWhen: { key: 'connection.protocol', notIn: ['onebot11'] },
      children: [
        {
          id: 'group.allow',
          label: '准入',
          fields: [
            f('allow.groups', '放行群号', 'list', { itemType: 'number', placeholder: '输入群号后回车' }),
            f('group.requireAt', '必须 @ 才回（仅记录）', 'bool', { custom: true }),
            f('social.mustReplyKeywords', '必回关键词', 'list', { itemType: 'string' }),
          ],
        },
        {
          id: 'group.rhythm',
          label: '节奏',
          fields: [
            f('socialV2.send.maxMessageChars', '分片长度', 'number', { min: 50, max: 2000, step: 10 }),
            f('socialV2.send.maxSendPerMinute', '每分钟上限', 'number', { min: 1, max: 30, step: 1 }),
            f('socialV2.send.burstMaxMessages', '中间发言条数', 'number', { min: 1, max: 10, step: 1 }),
            f('socialV2.proactive.probability', '主动发言概率', 'number', { min: 0, max: 1, step: 0.01 }),
            f('socialV2.context.unreadLimit', '上下文条数', 'number', { min: 5, max: 100, step: 5 }),
          ],
        },
      ],
    },
    {
      id: 'private',
      label: '私聊规则',
      icon: '✉️',
      children: [
        {
          id: 'private.allow',
          label: '准入',
          fields: [
            f('allow.private', '放行 QQ', 'list', { itemType: 'number' }),
            f('allowAllWhenEmpty', '白名单为空时放行所有人', 'bool', { hint: '危险：等于把账号交给任何能私聊到它的人' }),
          ],
        },
        {
          id: 'private.quota',
          label: '主动发言配额',
          fields: [
            f('socialV2.proactive.enabled', '允许主动找我', 'bool'),
            f('socialV2.proactive.checkIntervalMinMs', '主动检查间隔', 'number', { min: 60000, max: 86400000, step: 60000, unit: 'ms' }),
            f('socialV2.send.maxSendPerHour', '每小时上限', 'number', { min: 1, max: 500, step: 1 }),
            f('sendDelayMs', '发送间隔', 'number', { min: 0, max: 5000, step: 50, unit: 'ms' }),
          ],
        },
        {
          id: 'private.ack',
          label: '慢回复提示',
          fields: [f('ackMessage', '收到消息后立刻回一句', 'string', { placeholder: '留空关闭' })],
        },
      ],
    },
    {
      id: 'persona',
      label: '人格与表达',
      icon: '🎭',
      children: [
        {
          id: 'persona.card',
          label: '人格卡',
          fields: [
            f('currentRole', '当前人格卡', 'role'),
            f('action:edit-role', '编辑人格卡内容', 'action'),
            f('role.maxInjectChars', '注入长度上限', 'number', { min: 1000, max: 20000, step: 500 }),
          ],
        },
        {
          id: 'persona.prompt',
          label: '附加提示词',
          fields: [
            f('prompt.groupExtra', '群聊附加 prompt（仅记录）', 'text', { custom: true, rows: 5 }),
            f('prompt.privateExtra', '私聊附加 prompt（仅记录）', 'text', { custom: true, rows: 5 }),
          ],
        },
        {
          id: 'persona.language',
          label: '口癖与禁区',
          fields: [
            f('persona.catchphrases', '口癖（仅记录）', 'list', { itemType: 'string', custom: true }),
            f('persona.taboos', '禁区（仅记录）', 'list', { itemType: 'string', custom: true }),
          ],
        },
      ],
    },
    {
      id: 'diary',
      label: '日记',
      icon: '📔',
      hint: 'memory 的本地档案：日记 / 手记 / 人格内核，点节点直接打开阅读。',
      children: [
        {
          id: 'diary.today',
          label: '肥鱼日记',
          view: { kind: 'diary', tab: 'diary' },
          fields: [],
          hint: '插件自动写的日记，按天分组；想删某条去日记.md 上面对应的 jsonl。',
        },
        {
          id: 'diary.notes',
          label: '手记',
          view: { kind: 'diary', tab: 'notes' },
          fields: [],
          hint: '你手写、插件永远只读的一份：一行一条，以「- 」开头。',
        },
        {
          id: 'diary.persona',
          label: '人格内核',
          view: { kind: 'diary', tab: 'persona' },
          fields: [],
          hint: '它对自己的认知，随对话缓慢演化；想改直接用记事本编辑 persona.md。',
        },
        {
          id: 'diary.records',
          label: '记录清理',
          icon: '🧹',
          view: { kind: 'records' },
          fields: [],
          hint: '搜索日记记录，勾选删掉不想要的；只删日记，不动手记。',
        },
      ],
    },
    {
      id: 'moments',
      label: '动态',
      icon: '✨',
      hint: 'QQ 空间说说：她自己发的日常分享（socialV2.qzone）。',
      children: [
        {
          id: 'moments.switch',
          label: '开关',
          fields: [
            f('socialV2.qzone.enabled', '允许发动态', 'bool', { hint: '总开关；关掉后 qq_post_moment 会拒绝' }),
            f('socialV2.tools.postMoment', '把动态工具交给模型', 'bool', { hint: '关掉只是她看不到工具；你在面板仍可手动发' }),
          ],
        },
        {
          id: 'moments.quota',
          label: '配额',
          fields: [
            f('socialV2.qzone.maxPerDay', '每天上限', 'number', { min: 1, max: 20, step: 1, hint: '她自发动态的每日上限；你让她发不受限' }),
            f('socialV2.qzone.minIntervalMinutes', '最小间隔', 'number', { min: 0, max: 1440, step: 5, unit: 'min', hint: '0 = 不限；你让她发不受限' }),
          ],
        },
        {
          id: 'moments.visibility',
          label: '可见范围',
          fields: [
            f('socialV2.qzone.ugcRight', '查看权限', 'enum', { options: ['1', '4', '16', '64', '128'], hint: '1=所有人 4=好友 16=部分好友 64=仅自己 128=部分好友不可见' }),
          ],
        },
        {
          id: 'moments.act',
          label: '手动操作',
          fields: [
            f('action:post-moment', '发一条动态', 'action'),
            f('action:list-moments', '看她发过的动态', 'action'),
            f('action:moment-reset', '清零配额（立刻能发）', 'action'),
          ],
        },
      ],
    },
    {
      id: 'security',
      label: '安全边界',
      icon: '🛡',
      children: [
        {
          id: 'security.admin',
          label: '管理员',
          fields: [f('ownerQQ', 'owner QQ', 'number', { min: 10000, max: 99999999999, step: 1 })],
        },
        {
          id: 'security.tools',
          label: '工具开关',
          fields: [
            f('socialV2.tools.sendVoice', '语音条', 'bool'),
            f('socialV2.tools.getImages', '看图', 'bool'),
            f('socialV2.tools.memory', '轻量记忆', 'bool'),
            f('socialV2.tools.sendSticker', '发表情', 'bool'),
          ],
        },
        {
          id: 'security.filter',
          label: '拦截与审批',
          fields: [
            f('security.interceptNotify', '敏感调用通知管理员', 'bool'),
            f('security.sensitiveWords', '敏感词（仅记录）', 'list', { itemType: 'string', custom: true }),
            f('security.commands', '命令白名单（仅记录）', 'list', { itemType: 'string', custom: true }),
            f('security.fileScope', '文件发送范围（仅记录）', 'enum', { options: ['none', 'workspace', 'home'], custom: true }),
          ],
        },
      ],
    },
  ],
}

/** 扁平化：key -> field（含所属节点）。 */
export const FIELD_BY_KEY = new Map()
export function flattenFields(node = TREE) {
  if (node.fields) for (const field of node.fields) FIELD_BY_KEY.set(field.key, { ...field, nodeId: node.id })
  if (node.children) for (const child of node.children) flattenFields(child)
}
flattenFields()

/** 分支 id -> 是否受协议影响。 */
export const BRANCH_GATES = { group: { key: 'connection.protocol', notIn: ['onebot11'] } }
