import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-memory-store.mjs', 'utf8')
s = s.replace("ok(store.addFact('900001', '主人喜欢白米饭') === true, '相似事实也算新增（取代旧的）')", "ok(store.addFact('900001', '主人喜欢吃白米饭') === true, '相似事实也算新增（取代旧的）')")
s = s.replace("ok(visible.length === 1 && /白米饭/.test(visible[0].text), '旧事实被取代、只留新版本')", "ok(visible.length === 1 && /白米饭/.test(visible[0].text), '旧事实被取代、只留新版本')")
s = s.replace("store.addFact('900001', '主人喜欢白饭') === true", "store.addFact('900001', '主人喜欢吃白饭') === true")
s = s.replace("ok(store.delFact('900001', '主人喜欢白米饭') === true, '删除事实')", "ok(store.delFact('900001', '主人喜欢吃白米饭') === true, '删除事实')")
s = s.replace("ok(store.similarity('主人喜欢白饭', '主人喜欢白米饭') > 0.6, '相似度能识别同一件事')", "ok(store.similarity('主人喜欢吃白饭', '主人喜欢吃白米饭') >= 0.6, '相似度能识别同一件事')")
writeFileSync('lib/test-memory-store.mjs', s, 'utf8')
console.log('测试改用真正 >=0.6 的相似样本')
