import { readFileSync, writeFileSync } from 'node:fs'

const p = 'panel/index.html'
let h = readFileSync(p, 'utf8')
if (!h.includes('metrics-box')) {
  const anchor = 'view.appendChild(rsBox);'
  if (!h.includes(anchor)) throw new Error('找不到 rsBox 锚点')
  h = h.replace(
    anchor,
    `${anchor}
  const mx = document.createElement('div');
  mx.className = 'section';
  mx.innerHTML = '<div class="hd">📈 运行指标</div><div class="card" id="metrics-box">读取中…</div>';
  view.appendChild(mx);
  (async () => {
    const box = $('#metrics-box'); if (!box) return;
    try {
      const m = await action('metrics');
      const c = (m && m.counters) || {};
      const lat = (m && m.latency) || {};
      const fmtLat = (k) => lat[k] ? (lat[k].p50 + ' / ' + lat[k].p95 + ' ms') : '-';
      const errs = (m && m.recentErrors) || [];
      const kv = (k, v) => '<div class="row"><span class="muted small">' + k + '</span><span style="margin-left:auto">' + v + '</span></div>';
      box.innerHTML =
        kv('收到消息', (c.msgsIn || 0)) +
        kv('LLM 调用', (c.llmCalls || 0)) +
        kv('回复成功', (c.replies || 0)) +
        kv('跳过', (c.skipped || 0)) +
        kv('首字延迟 P50/P95', fmtLat('firstTokenMs')) +
        kv('总延迟 P50/P95', fmtLat('totalMs')) +
        (errs.length
          ? '<div class="help" style="margin-top:6px">最近错误（' + errs.length + '）</div>' + errs.slice(-5).reverse().map(e => '<div class="small muted">' + esc(new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })) + ' ' + esc(e.label) + '：' + esc(e.message).slice(0, 80) + '</div>').join('')
          : '<div class="help" style="margin-top:6px">最近没有隔离的异常</div>');
    } catch (e) {
      box.textContent = '指标读取失败：' + e.message;
    }
  })();`,
  )
  writeFileSync(p, h, 'utf8')
  console.log('panel: 加运行指标卡片')
}
