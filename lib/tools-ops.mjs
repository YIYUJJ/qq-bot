/**
 * 运维类工具：qqbot_config / qqbot_reload / qqbot_autostart / qqbot_restart。
 *
 * 依赖注入（都按引用/函数传）：
 *   config / applyConfigPatch / log
 *   rereadConfigFromDisk / reloadSelf
 *   setAutostart / isAutostartEnabled / autostartFile
 *   restartDsh / textOut
 */
export function opsTools(deps) {
  const { config, applyConfigPatch, log, rereadConfigFromDisk, reloadSelf, setAutostart, isAutostartEnabled, autostartFile, restartDsh, textOut } = deps

  return [
    {
      name: 'qqbot_config',
      description: '读或改 QQ 机器人的运行参数（改完立刻生效并落盘）。不带 value 返回全部配置。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '参数名，如 enabled / replyProbability / quietHours' },
          value: { type: 'string', description: '新值；布尔用 true/false，列表用逗号分隔' },
        },
      },
      output: textOut,
      async execute(args) {
        const key = String(args?.key ?? '').trim()
        if (!key) return Object.entries(config).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(',') : v}`).join('\n')
        if (args?.value === undefined) {
          if (!(key in config)) throw new Error(`未知参数：${key}`)
          return `${key} = ${Array.isArray(config[key]) ? config[key].join(',') : config[key]}`
        }
        const r = applyConfigPatch({ [key]: args.value })
        if (!r.ok) throw new Error(JSON.stringify(r.rejected))
        log(`配置变更 ${key} = ${JSON.stringify(r.applied[key])}`)
        return `已生效：${key} = ${Array.isArray(r.applied[key]) ? r.applied[key].join(',') : r.applied[key]}`
      },
    },
    {
      name: 'qqbot_reload',
      description:
        '重载 QQ 机器人插件本体（应用磁盘上的代码改动）；configOnly=true 时只重读 config.json/rooms.json。重载约 1 秒后发生，连接会自动恢复。',
      parameters: {
        type: 'object',
        properties: {
          configOnly: { type: 'boolean', description: 'true=只重读配置文件，不重载代码' },
        },
      },
      output: textOut,
      async execute(args) {
        if (args?.configOnly) {
          const r = rereadConfigFromDisk()
          return `已重读配置：${r.changed.length ? '变化 ' + r.changed.join(',') : '无变化'}`
        }
        const r = reloadSelf(900)
        if (!r.ok) throw new Error(r.error)
        return `已触发重载，约 ${r.inMs}ms 后生效；连接会自动重连，几秒后看状态即可。`
      },
    },
    {
      name: 'qqbot_autostart',
      description: '开机自启：get 看当前状态；set 开关（在 Windows 启动文件夹里放/删一个启动 SnowLuma 的脚本）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'get | set' },
          enabled: { type: 'boolean', description: 'set 时为 true 开启、false 关闭' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'get')
        try {
          if (action === 'set') {
            const r = setAutostart(!!args?.enabled, config.snowlumaHome)
            return (r.enabled ? '已开启' : '已关闭') + ' 开机自启｜脚本：' + r.file
          }
          return (isAutostartEnabled() ? '已开启' : '已关闭') + '｜脚本：' + (autostartFile() || '(拿不到启动目录)')
        } catch (e) {
          return '失败：' + String(e?.message || e)
        }
      },
    },
    {
      name: 'qqbot_restart',
      description: '重启 DSH（应用会中断约 4 秒然后自己回来）。面板改了客户端 UI 不生效时用它。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        try {
          const r = restartDsh()
          return '已请求重启 DSH：约 ' + Math.round(r.etaMs / 1000) + ' 秒后自动回来（脚本：' + r.script + '）'
        } catch (e) {
          return '重启失败：' + String(e?.message || e)
        }
      },
    },
  ]
}
