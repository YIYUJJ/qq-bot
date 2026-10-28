import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('C:/Users/22371/.dsh/qq-bot/state.db', { readOnly: true })
const rows = db.prepare('SELECT k, length(v) AS len, at FROM state').all()
for (const r of rows) console.log(r.k, '｜长度', r.len, '｜更新于', new Date(Number(r.at)).toISOString())
const got = db.prepare("SELECT v FROM state WHERE k = 'replied'").get()
if (got) {
  const replied = JSON.parse(got.v)
  const room = replied['975427049'] || []
  console.log('975427049 已记录回复条数:', room.length, '｜最后一条:', room.length ? new Date(room[room.length - 1].at).toISOString() : '-')
}
db.close()
