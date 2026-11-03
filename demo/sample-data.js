/* 演示用示例数据：结构来自控制台 schema，值全部清空，不含任何真实配置或用户数据。 */
window.DEMO_BOOT = {
    "ok":  true,
    "version":  "0.1.0-demo",
    "tree":  {
                 "id":  "root",
                 "label":  "星图",
                 "icon":  "🐟",
                 "children":  [
                                  {
                                      "id":  "connection",
                                      "label":  "连接",
                                      "icon":  "🔌",
                                      "children":  [
                                                       {
                                                           "id":  "connection.addr",
                                                           "label":  "协议与地址",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "connection.protocol",
                                                                              "label":  "协议",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "onebot11",
                                                                                              "onebot12",
                                                                                              "satori",
                                                                                              "milky",
                                                                                              "qq-official"
                                                                                          ],
                                                                              "requiresRestart":  true,
                                                                              "hint":  "bridge 只实现 OneBot v11；其它值是偏好记录，选中后群管理节点会置灰"
                                                                          },
                                                                          {
                                                                              "key":  "snowluma.wsUrl",
                                                                              "label":  "WebSocket 地址",
                                                                              "type":  "string",
                                                                              "requiresRestart":  true,
                                                                              "placeholder":  "ws://127.0.0.1:3001"
                                                                          },
                                                                          {
                                                                              "key":  "snowluma.httpUrl",
                                                                              "label":  "HTTP 地址",
                                                                              "type":  "string",
                                                                              "requiresRestart":  true,
                                                                              "placeholder":  "http://127.0.0.1:3000"
                                                                          },
                                                                          {
                                                                              "key":  "dsh.baseUrl",
                                                                              "label":  "DSH 地址",
                                                                              "type":  "string",
                                                                              "requiresRestart":  true,
                                                                              "placeholder":  "http://127.0.0.1:56221"
                                                                          },
                                                                          {
                                                                              "key":  "action:sync-dsh",
                                                                              "label":  "把 DSH 地址同步为当前端口",
                                                                              "type":  "action"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "connection.auth",
                                                           "label":  "凭证",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "snowluma.accessToken",
                                                                              "label":  "OneBot 令牌",
                                                                              "type":  "secret"
                                                                          },
                                                                          {
                                                                              "key":  "dsh.authToken",
                                                                              "label":  "DSH 启动令牌（通常留空）",
                                                                              "type":  "secret"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "connection.bind",
                                                           "label":  "绑定与探测",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "action:open-snowluma",
                                                                              "label":  "打开 Gateway 扫码绑定",
                                                                              "type":  "action"
                                                                          },
                                                                          {
                                                                              "key":  "action:probe",
                                                                              "label":  "重新探测连通性",
                                                                              "type":  "action"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "connection.retry",
                                                           "label":  "重连策略",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "snowluma.followDiscoveredEndpoint",
                                                                              "label":  "跟随自动发现的端点",
                                                                              "type":  "bool",
                                                                              "requiresRestart":  true
                                                                          },
                                                                          {
                                                                              "key":  "snowluma.silenceWarnMs",
                                                                              "label":  "静默告警阈值",
                                                                              "type":  "number",
                                                                              "min":  60000,
                                                                              "max":  3600000,
                                                                              "step":  30000,
                                                                              "unit":  "ms"
                                                                          }
                                                                      ]
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "behavior",
                                      "label":  "对话行为",
                                      "icon":  "💬",
                                      "children":  [
                                                       {
                                                           "id":  "behavior.model",
                                                           "label":  "模型",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "dsh.provider",
                                                                              "label":  "Provider",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "deepseek-account",
                                                                                              "deepseek-official"
                                                                                          ]
                                                                          },
                                                                          {
                                                                              "key":  "dsh.model",
                                                                              "label":  "模型",
                                                                              "type":  "string",
                                                                              "placeholder":  "deepseek-flash"
                                                                          },
                                                                          {
                                                                              "key":  "dsh.reasoningEffort",
                                                                              "label":  "推理强度",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "low",
                                                                                              "medium",
                                                                                              "high",
                                                                                              "max"
                                                                                          ]
                                                                          },
                                                                          {
                                                                              "key":  "dsh.temperature",
                                                                              "label":  "温度（仅记录）",
                                                                              "type":  "number",
                                                                              "min":  0,
                                                                              "max":  2,
                                                                              "step":  0.1,
                                                                              "custom":  true
                                                                          },
                                                                          {
                                                                              "key":  "features.streaming",
                                                                              "label":  "流式输出（仅记录）",
                                                                              "type":  "bool",
                                                                              "custom":  true
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "behavior.preset",
                                                           "label":  "预设与模式",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "agentPreset",
                                                                              "label":  "一代预设",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "qq-chat",
                                                                                              "qq-chat-v2"
                                                                                          ]
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.agentPreset",
                                                                              "label":  "二代预设",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "qq-chat",
                                                                                              "qq-chat-v2"
                                                                                          ]
                                                                          },
                                                                          {
                                                                              "key":  "workspaceTitle",
                                                                              "label":  "DSH 工作区名",
                                                                              "type":  "string"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "behavior.session",
                                                           "label":  "会话与上下文",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.context.recentLimit",
                                                                              "label":  "历史条数",
                                                                              "type":  "number",
                                                                              "min":  10,
                                                                              "max":  200,
                                                                              "step":  10
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.context.contextWindow",
                                                                              "label":  "上下文窗口",
                                                                              "type":  "number",
                                                                              "min":  5,
                                                                              "max":  100,
                                                                              "step":  1
                                                                          },
                                                                          {
                                                                              "key":  "session.timeoutMs",
                                                                              "label":  "会话超时（仅记录）",
                                                                              "type":  "number",
                                                                              "min":  60000,
                                                                              "max":  86400000,
                                                                              "step":  60000,
                                                                              "unit":  "ms",
                                                                              "custom":  true
                                                                          },
                                                                          {
                                                                              "key":  "questionTimeoutMs",
                                                                              "label":  "处理超时",
                                                                              "type":  "number",
                                                                              "min":  30000,
                                                                              "max":  900000,
                                                                              "step":  30000,
                                                                              "unit":  "ms"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "behavior.voice",
                                                           "label":  "语音与唱歌",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.voice.enabled",
                                                                              "label":  "允许发语音",
                                                                              "type":  "bool",
                                                                              "hint":  "总开关；关掉后 qq_list_voices / qq_send_voice 都会拒绝"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.tools.sendVoice",
                                                                              "label":  "把语音工具交给模型",
                                                                              "type":  "bool",
                                                                              "hint":  "关掉只是模型看不到这两个工具，不影响你手动发"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.voice.maxSeconds",
                                                                              "label":  "单条时长上限",
                                                                              "type":  "number",
                                                                              "min":  5,
                                                                              "max":  300,
                                                                              "step":  5,
                                                                              "unit":  "s"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.voice.maxPerHour",
                                                                              "label":  "每小时条数上限",
                                                                              "type":  "number",
                                                                              "min":  1,
                                                                              "max":  50,
                                                                              "step":  1
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.voice.loudness",
                                                                              "label":  "响度处理",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "quiet",
                                                                                              "normal",
                                                                                              "loud"
                                                                                          ]
                                                                          },
                                                                          {
                                                                              "key":  "action:refresh-voices",
                                                                              "label":  "刷新语音库列表",
                                                                              "type":  "action"
                                                                          }
                                                                      ]
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "voicekit",
                                      "label":  "嗓子与启动",
                                      "icon":  "🎤",
                                      "children":  [
                                                       {
                                                           "id":  "voicekit.gsv",
                                                           "label":  "启动 GPT-SoVITS（终端）",
                                                           "icon":  "🗣️",
                                                           "action":  {
                                                                          "kind":  "service",
                                                                          "action":  "start-gsv-term",
                                                                          "label":  "启动 GPT-SoVITS"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.gsv-stop",
                                                           "label":  "停止 GPT-SoVITS",
                                                           "icon":  "⏹️",
                                                           "action":  {
                                                                          "kind":  "service",
                                                                          "action":  "stop-gsv",
                                                                          "label":  "停止 GPT-SoVITS"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.bridge",
                                                           "label":  "桥接控制台（3100）",
                                                           "icon":  "🌉",
                                                           "action":  {
                                                                          "kind":  "openUrl",
                                                                          "url":  "http://127.0.0.1:3100"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.bridge-term",
                                                           "label":  "桥接终端",
                                                           "icon":  "🖥️",
                                                           "action":  {
                                                                          "kind":  "service",
                                                                          "action":  "open-bridge-term",
                                                                          "label":  "打开桥接终端"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.snow",
                                                           "label":  "Gateway 控制台（5099）",
                                                           "icon":  "❄️",
                                                           "action":  {
                                                                          "kind":  "openUrl",
                                                                          "url":  "http://127.0.0.1:5099"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.snow-login",
                                                           "label":  "Gateway 一键登录（5099）",
                                                           "icon":  "⚡",
                                                           "action":  {
                                                                          "kind":  "service",
                                                                          "action":  "open-snowluma-login",
                                                                          "label":  "打开 Gateway 登录"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.snow-start",
                                                           "label":  "启动 Gateway",
                                                           "icon":  "▶️",
                                                           "action":  {
                                                                          "kind":  "service",
                                                                          "action":  "start-snowluma",
                                                                          "label":  "启动 Gateway"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.snow-restart",
                                                           "label":  "重启 Gateway",
                                                           "icon":  "🔄",
                                                           "action":  {
                                                                          "kind":  "service",
                                                                          "action":  "restart-snowluma",
                                                                          "label":  "重启 Gateway"
                                                                      }
                                                       },
                                                       {
                                                           "id":  "voicekit.snow-stop",
                                                           "label":  "停止 Gateway",
                                                           "icon":  "⏹️",
                                                           "action":  {
                                                                          "kind":  "service",
                                                                          "action":  "stop-snowluma",
                                                                          "label":  "停止 Gateway"
                                                                      }
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "group",
                                      "label":  "群聊规则",
                                      "icon":  "👥",
                                      "disabledWhen":  {
                                                           "key":  "connection.protocol",
                                                           "notIn":  [
                                                                         "onebot11"
                                                                     ]
                                                       },
                                      "children":  [
                                                       {
                                                           "id":  "group.allow",
                                                           "label":  "准入",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "allow.groups",
                                                                              "label":  "放行群号",
                                                                              "type":  "list",
                                                                              "itemType":  "number",
                                                                              "placeholder":  "输入群号后回车"
                                                                          },
                                                                          {
                                                                              "key":  "group.requireAt",
                                                                              "label":  "必须 @ 才回（仅记录）",
                                                                              "type":  "bool",
                                                                              "custom":  true
                                                                          },
                                                                          {
                                                                              "key":  "social.mustReplyKeywords",
                                                                              "label":  "必回关键词",
                                                                              "type":  "list",
                                                                              "itemType":  "string"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "group.rhythm",
                                                           "label":  "节奏",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.send.maxMessageChars",
                                                                              "label":  "分片长度",
                                                                              "type":  "number",
                                                                              "min":  50,
                                                                              "max":  2000,
                                                                              "step":  10
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.send.maxSendPerMinute",
                                                                              "label":  "每分钟上限",
                                                                              "type":  "number",
                                                                              "min":  1,
                                                                              "max":  30,
                                                                              "step":  1
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.send.burstMaxMessages",
                                                                              "label":  "中间发言条数",
                                                                              "type":  "number",
                                                                              "min":  1,
                                                                              "max":  10,
                                                                              "step":  1
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.proactive.probability",
                                                                              "label":  "主动发言概率",
                                                                              "type":  "number",
                                                                              "min":  0,
                                                                              "max":  1,
                                                                              "step":  0.01
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.context.unreadLimit",
                                                                              "label":  "上下文条数",
                                                                              "type":  "number",
                                                                              "min":  5,
                                                                              "max":  100,
                                                                              "step":  5
                                                                          }
                                                                      ]
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "private",
                                      "label":  "私聊规则",
                                      "icon":  "✉️",
                                      "children":  [
                                                       {
                                                           "id":  "private.allow",
                                                           "label":  "准入",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "allow.private",
                                                                              "label":  "放行 QQ",
                                                                              "type":  "list",
                                                                              "itemType":  "number"
                                                                          },
                                                                          {
                                                                              "key":  "allowAllWhenEmpty",
                                                                              "label":  "白名单为空时放行所有人",
                                                                              "type":  "bool",
                                                                              "hint":  "危险：等于把账号交给任何能私聊到它的人"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "private.quota",
                                                           "label":  "主动发言配额",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.proactive.enabled",
                                                                              "label":  "允许主动找我",
                                                                              "type":  "bool"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.proactive.checkIntervalMinMs",
                                                                              "label":  "主动检查间隔",
                                                                              "type":  "number",
                                                                              "min":  60000,
                                                                              "max":  86400000,
                                                                              "step":  60000,
                                                                              "unit":  "ms"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.send.maxSendPerHour",
                                                                              "label":  "每小时上限",
                                                                              "type":  "number",
                                                                              "min":  1,
                                                                              "max":  500,
                                                                              "step":  1
                                                                          },
                                                                          {
                                                                              "key":  "sendDelayMs",
                                                                              "label":  "发送间隔",
                                                                              "type":  "number",
                                                                              "min":  0,
                                                                              "max":  5000,
                                                                              "step":  50,
                                                                              "unit":  "ms"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "private.ack",
                                                           "label":  "慢回复提示",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "ackMessage",
                                                                              "label":  "收到消息后立刻回一句",
                                                                              "type":  "string",
                                                                              "placeholder":  "留空关闭"
                                                                          }
                                                                      ]
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "persona",
                                      "label":  "人格与表达",
                                      "icon":  "🎭",
                                      "children":  [
                                                       {
                                                           "id":  "persona.card",
                                                           "label":  "人格卡",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "currentRole",
                                                                              "label":  "当前人格卡",
                                                                              "type":  "role"
                                                                          },
                                                                          {
                                                                              "key":  "action:edit-role",
                                                                              "label":  "编辑人格卡内容",
                                                                              "type":  "action"
                                                                          },
                                                                          {
                                                                              "key":  "role.maxInjectChars",
                                                                              "label":  "注入长度上限",
                                                                              "type":  "number",
                                                                              "min":  1000,
                                                                              "max":  20000,
                                                                              "step":  500
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "persona.prompt",
                                                           "label":  "附加提示词",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "prompt.groupExtra",
                                                                              "label":  "群聊附加 prompt（仅记录）",
                                                                              "type":  "text",
                                                                              "custom":  true,
                                                                              "rows":  5
                                                                          },
                                                                          {
                                                                              "key":  "prompt.privateExtra",
                                                                              "label":  "私聊附加 prompt（仅记录）",
                                                                              "type":  "text",
                                                                              "custom":  true,
                                                                              "rows":  5
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "persona.language",
                                                           "label":  "口癖与禁区",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "persona.catchphrases",
                                                                              "label":  "口癖（仅记录）",
                                                                              "type":  "list",
                                                                              "itemType":  "string",
                                                                              "custom":  true
                                                                          },
                                                                          {
                                                                              "key":  "persona.taboos",
                                                                              "label":  "禁区（仅记录）",
                                                                              "type":  "list",
                                                                              "itemType":  "string",
                                                                              "custom":  true
                                                                          }
                                                                      ]
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "diary",
                                      "label":  "日记",
                                      "icon":  "📔",
                                      "hint":  "memory 的本地档案：日记 / 手记 / 人格内核，点节点直接打开阅读。",
                                      "children":  [
                                                       {
                                                           "id":  "diary.today",
                                                           "label":  "肥鱼日记",
                                                           "view":  {
                                                                        "kind":  "diary",
                                                                        "tab":  "diary"
                                                                    },
                                                           "fields":  [

                                                                      ],
                                                           "hint":  "插件自动写的日记，按天分组；想删某条去日记.md 上面对应的 jsonl。"
                                                       },
                                                       {
                                                           "id":  "diary.notes",
                                                           "label":  "手记",
                                                           "view":  {
                                                                        "kind":  "diary",
                                                                        "tab":  "notes"
                                                                    },
                                                           "fields":  [

                                                                      ],
                                                           "hint":  "你手写、插件永远只读的一份：一行一条，以「- 」开头。"
                                                       },
                                                       {
                                                           "id":  "diary.persona",
                                                           "label":  "人格内核",
                                                           "view":  {
                                                                        "kind":  "diary",
                                                                        "tab":  "persona"
                                                                    },
                                                           "fields":  [

                                                                      ],
                                                           "hint":  "它对自己的认知，随对话缓慢演化；想改直接用记事本编辑 persona.md。"
                                                       },
                                                       {
                                                           "id":  "diary.records",
                                                           "label":  "记录清理",
                                                           "icon":  "🧹",
                                                           "view":  {
                                                                        "kind":  "records"
                                                                    },
                                                           "fields":  [

                                                                      ],
                                                           "hint":  "搜索日记记录，勾选删掉不想要的；只删日记，不动手记。"
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "moments",
                                      "label":  "动态",
                                      "icon":  "✨",
                                      "hint":  "QQ 空间说说：她自己发的日常分享（socialV2.qzone）。",
                                      "children":  [
                                                       {
                                                           "id":  "moments.switch",
                                                           "label":  "开关",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.qzone.enabled",
                                                                              "label":  "允许发动态",
                                                                              "type":  "bool",
                                                                              "hint":  "总开关；关掉后 qq_post_moment 会拒绝"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.tools.postMoment",
                                                                              "label":  "把动态工具交给模型",
                                                                              "type":  "bool",
                                                                              "hint":  "关掉只是她看不到工具；你在面板仍可手动发"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "moments.quota",
                                                           "label":  "配额",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.qzone.maxPerDay",
                                                                              "label":  "每天上限",
                                                                              "type":  "number",
                                                                              "min":  1,
                                                                              "max":  20,
                                                                              "step":  1,
                                                                              "hint":  "她自发动态的每日上限；你让她发不受限"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.qzone.minIntervalMinutes",
                                                                              "label":  "最小间隔",
                                                                              "type":  "number",
                                                                              "min":  0,
                                                                              "max":  1440,
                                                                              "step":  5,
                                                                              "unit":  "min",
                                                                              "hint":  "0 = 不限；你让她发不受限"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "moments.visibility",
                                                           "label":  "可见范围",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.qzone.ugcRight",
                                                                              "label":  "查看权限",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "1",
                                                                                              "4",
                                                                                              "16",
                                                                                              "64",
                                                                                              "128"
                                                                                          ],
                                                                              "hint":  "1=所有人 4=好友 16=部分好友 64=仅自己 128=部分好友不可见"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "moments.act",
                                                           "label":  "手动操作",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "action:post-moment",
                                                                              "label":  "发一条动态",
                                                                              "type":  "action"
                                                                          },
                                                                          {
                                                                              "key":  "action:list-moments",
                                                                              "label":  "看她发过的动态",
                                                                              "type":  "action"
                                                                          },
                                                                          {
                                                                              "key":  "action:moment-reset",
                                                                              "label":  "清零配额（立刻能发）",
                                                                              "type":  "action"
                                                                          }
                                                                      ]
                                                       }
                                                   ]
                                  },
                                  {
                                      "id":  "security",
                                      "label":  "安全边界",
                                      "icon":  "🛡",
                                      "children":  [
                                                       {
                                                           "id":  "security.admin",
                                                           "label":  "管理员",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "ownerQQ",
                                                                              "label":  "owner QQ",
                                                                              "type":  "number",
                                                                              "min":  10000,
                                                                              "max":  99999999999,
                                                                              "step":  1
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "security.tools",
                                                           "label":  "工具开关",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "socialV2.tools.sendVoice",
                                                                              "label":  "语音条",
                                                                              "type":  "bool"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.tools.getImages",
                                                                              "label":  "看图",
                                                                              "type":  "bool"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.tools.memory",
                                                                              "label":  "轻量记忆",
                                                                              "type":  "bool"
                                                                          },
                                                                          {
                                                                              "key":  "socialV2.tools.sendSticker",
                                                                              "label":  "发表情",
                                                                              "type":  "bool"
                                                                          }
                                                                      ]
                                                       },
                                                       {
                                                           "id":  "security.filter",
                                                           "label":  "拦截与审批",
                                                           "fields":  [
                                                                          {
                                                                              "key":  "security.interceptNotify",
                                                                              "label":  "敏感调用通知管理员",
                                                                              "type":  "bool"
                                                                          },
                                                                          {
                                                                              "key":  "security.sensitiveWords",
                                                                              "label":  "敏感词（仅记录）",
                                                                              "type":  "list",
                                                                              "itemType":  "string",
                                                                              "custom":  true
                                                                          },
                                                                          {
                                                                              "key":  "security.commands",
                                                                              "label":  "命令白名单（仅记录）",
                                                                              "type":  "list",
                                                                              "itemType":  "string",
                                                                              "custom":  true
                                                                          },
                                                                          {
                                                                              "key":  "security.fileScope",
                                                                              "label":  "文件发送范围（仅记录）",
                                                                              "type":  "enum",
                                                                              "options":  [
                                                                                              "none",
                                                                                              "workspace",
                                                                                              "home"
                                                                                          ],
                                                                              "custom":  true
                                                                          }
                                                                      ]
                                                       }
                                                   ]
                                  }
                              ]
             },
    "values":  {

               },
    "roles":  [
                  {
                      "active":  true,
                      "name":  "示例角色"
                  }
              ],
    "currentRole":  "示例角色",
    "paths":  {
                  "configFile":  "~/.star-console/bridge/config.json"
              }
};

window.DEMO_STATUS = {
  bridge: { online: true, mode: 'demo' },
  onebot: { online: true, nickname: '示例账号', uin: 10000 },
  snowluma: { online: true, status: 'demo' }
};

window.DEMO_DIARY = {
  ok: true,
  count: 6,
  diary: [
    { id: 'd_20260101_01', date: '2026-01-01', kind: 'chat', salience: 0.7, created_at: 1767273000000, text: '示例记忆：今天在图书馆待了一下午，窗边的光很好。' },
    { id: 'd_20260102_01', date: '2026-01-02', kind: 'win', salience: 0.6, created_at: 1767362400000, text: '示例记忆：第一次把一整段流程跑通了，虽然中途出了点小问题。' },
    { id: 'd_20260103_01', date: '2026-01-03', kind: 'failure', salience: 0.5, created_at: 1767436800000, text: '示例记忆：今天状态不太好，事情做得乱七八糟。' },
    { id: 'd_20260104_01', date: '2026-01-04', kind: 'disclosure', salience: 0.8, created_at: 1767536100000, text: '示例记忆：聊到很晚，说了一些平时不太会说出口的话。' },
    { id: 'd_20260105_01', date: '2026-01-05', kind: 'grievance', salience: 0.4, created_at: 1767585600000, text: '示例记忆：被误会了一次，解释完就算了。' },
    { id: 'd_20260106_01', date: '2026-01-06', kind: 'chat', salience: 0.6, created_at: 1767663000000, text: '示例记忆：早上出门下雨，没带伞，小跑着去上课。' }
  ]
};