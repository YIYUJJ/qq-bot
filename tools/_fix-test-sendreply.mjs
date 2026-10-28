import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-send-reply.mjs', 'utf8')
s = s.replace("lastStickerAt: 0, lastReplyAt: 0 }", 'lastStickerAt: 0, lastReplyAt: 0, replyTimes: [], repliedTexts: [] }')
s = s.replace("{ roomId: '123456', isGroup: false, roomName: '', lineTarget: 1 }", "{ roomId: '123456', isGroup: false, roomName: '', lineTarget: 1, replyTimes: [], repliedTexts: [] }")
s = s.replace("roomName: 'x', lineTarget: 1, lastReplyAt: 0 }", "roomName: 'x', lineTarget: 1, lastReplyAt: 0, replyTimes: [], repliedTexts: [] }")
writeFileSync('lib/test-send-reply.mjs', s, 'utf8')
console.log('测试房间状态已补齐 replyTimes')
