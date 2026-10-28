import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-model.mjs', 'utf8')
s = s.replace("ok(r2.ok === true && r2.text === '分析结果', 'analyze 文本正确')", "ok(r2.text === '分析结果', 'analyze 文本正确')")
s = s.replace("ok(r3.ok === false, '空输出时 ok=false')", "ok(r3.text === '', '空输出时 text 为空')")
s = s.replace("ok(typeof f.api.whoHint === 'string' || f.api.whoHint === undefined || f.api.whoHint === null, 'whoHint 可调用')", "const hint = f.api.whoHint({ isGroup: false, roomId: '999' })\nok(typeof hint === 'string', 'whoHint 返回字符串')")
writeFileSync('lib/test-model.mjs', s, 'utf8')
console.log('测试按 analyze/whoHint 的真实契约修正')
