/**
 * 访问控制：白名单闸（群/私聊）+ 必回判定。
 *
 * 所有发送路径都必须先过 isAllowedGroup / allowedHere，这里是唯一来源。
 */
export const ACCESS_DEPS = ['config', 'getCfgFor']

export function createAccess(deps) {
  const { config, getCfgFor } = deps
  if (!config) throw new Error('访问控制缺少 config')

  function isAllowedGroup(roomId) {
    return config.allowGroups.includes(String(roomId))
  }

  function assertGroupAllowed(roomId) {
    if (!isAllowedGroup(roomId)) {
      throw new Error(`群 ${roomId} 不在白名单（当前只允许：${config.allowGroups.join(', ') || '无'}）`)
    }
  }

  function allowedHere(r) {
    if (r.isGroup) return isAllowedGroup(r.roomId)
    // 私聊：白名单 + 管理员都算允许（管理员不必再单独加一遍）
    return config.allowPrivate.includes(r.roomId) || config.adminQQ.includes(String(r.roomId))
  }

  /** 这条消息是不是"必须回"：私聊管理员，或该群开了必回。 */
  function mustReply(r, sender) {
    if (!r.isGroup) return config.adminQQ.includes(String(sender ?? r.roomId))
    return !!getCfgFor()(r.roomId).alwaysReply
  }

  return { isAllowedGroup, assertGroupAllowed, allowedHere, mustReply }
}
