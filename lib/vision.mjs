/**
 * 视觉链路：generateVision / describeBuffer / describeImage / attachVision。
 *
 * visionBroken（同类失败只记一次日志）通过 get/set 显式读写，避免隐式全局。
 */
import { shrinkImage } from './extras.mjs'

export const VISION_DEPS = ["config","createUserMessage","ctx","getVisionBroken","guessMediaType","llm","log","noteUsage","resolveVisionRoute","setVisionBroken","track","trimVisionCache","untrack","usage","vision","visionCache","visionKey"]

export function createVisionChain(deps) {
  const missing = VISION_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('视觉链路缺少依赖：' + missing.join(', '))
  const { config, createUserMessage, ctx, getVisionBroken, guessMediaType, llm, log, noteUsage, resolveVisionRoute, setVisionBroken, track, trimVisionCache, untrack, usage, vision, visionCache, visionKey } = deps

  async function generateVision(ref, prompt, opts = {}) {
    const route = await resolveVisionRoute()
    const provider = route.provider
    const model = route.model
    const ac = new AbortController()
    const killer = track(setTimeout(() => ac.abort(new Error('视觉超时')), 30000))
    let text = ''
    let finish = null
    try {
      const stream = llm.stream({
        provider,
        model,
        messages: [
          createUserMessage({
            source: { kind: 'user' },
            content: [
              { type: 'image', attachment: ref },
              { type: 'text', text: prompt },
            ],
          }),
        ],
        maxTokens: Number(opts.maxTokens || config.visionMaxTokens) || 900,
        temperature: 0.3,
        signal: ac.signal,
      })
      for await (const c of stream) {
        if (c.type === 'text-delta') text += c.text
        else if (c.type === 'usage') noteUsage(c.usage)
        else if (c.type === 'finish') finish = c.reason
        else if (c.type === 'block-end' && !text && c.block?.type === 'text') text = c.block.text || ''
      }
    } finally {
      untrack(killer)
    }
    if (!text && finish && finish.kind !== 'stop') {
      const f = finish.failure || {}
      // 视觉模型把预算全花在"想"上时是 max-tokens：把预算翻倍再试一次，别当成永久失败
      const budget = Number(opts.maxTokens || config.visionMaxTokens) || 900
      if (String(finish.kind) === 'max-tokens' && budget < 1800) {
        log(`视觉 max-tokens（预算 ${budget}），翻倍重试`)
        return await generateVision(ref, prompt, { ...opts, maxTokens: budget * 2 })
      }
      throw new Error(
        `视觉调用失败（${provider}/${model}）：${finish.kind}` +
          (f.message ? ' - ' + f.message : '') +
          (f.code ? ` [${f.code}]` : ''),
      )
    }
    return text.trim()
  }

  async function describeBuffer(buf, mediaType, kind, prompt) {
    const att = ctx.get?.('attachments')
    if (!att || typeof att.saveImages !== 'function') throw new Error('没有 attachments 服务')
    const refs = await att.saveImages([{ data: new Uint8Array(buf), mediaType, name: kind || 'image' }])
    const ref = refs?.[0]
    if (!ref) throw new Error('附件入库失败')
    return await generateVision(ref, prompt)
  }

  async function describeImage(url, kind = 'image', c = null) {
    const eff = c || config
    const want = kind === 'mface' ? eff.visionOnEmoticon : eff.visionOnImage
    if (!want) return ''
    const key = visionKey(url)
    const hit = visionCache[key]
    if (hit?.text && Date.now() - (hit.at || 0) < 7 * 86400000) return hit.text
    if (hit?.err && Date.now() - (hit.at || 0) < 600000) return ''
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
      if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      const maxBytes = (Number(config.visionMaxMB) || 12) * 1024 * 1024
      let mediaType = guessMediaType(res, url)
      let useBuf = buf
      if (useBuf.length > maxBytes) {
        // 大图先压到 1280 宽再送视觉（群里照片经常 4MB+），别直接丢掉
        const small = await shrinkImage(useBuf, {
          mediaType,
          maxWidth: Number(config.visionMaxWidth) || 1280,
          ffmpeg: config.ffmpegPath || 'ffmpeg',
        })
        if (small && small.length <= maxBytes) {
          log('识图：图片过大已压缩 ' + Math.round(useBuf.length / 1024) + 'KB → ' + Math.round(small.length / 1024) + 'KB')
          useBuf = small
          mediaType = 'image/jpeg'
        } else {
          throw new Error(`图片过大 ${Math.round(buf.length / 1024)}KB（压缩失败）`)
        }
      }
      const att = ctx.get?.('attachments')
      if (!att || typeof att.saveImages !== 'function') throw new Error('没有 attachments 服务')
      const refs = await att.saveImages([{ data: new Uint8Array(useBuf), mediaType, name: kind }])
      const ref = refs?.[0]
      if (!ref) throw new Error('附件入库失败')
      const prompt =
        kind === 'mface'
          ? '这是一张 QQ 群聊表情包。用一两句话说明画面内容、表情/情绪、适合什么语境，不要客套。'
          : '这是群里发的一张图片。用一两句话说明画面里有什么、可能是什么意图，不要客套。'
      const text = await generateVision(ref, prompt)
      const out = String(text).replace(/\s+/g, ' ').trim().slice(0, 220)
      if (!out) throw new Error('视觉模型返回空')
      visionCache[key] = { text: out, at: Date.now(), kind }
      trimVisionCache()
      vision.persist()
      setVisionBroken('')
      return out
    } catch (e) {
      const msg = String(e?.message || e)
      visionCache[key] = { err: msg, at: Date.now(), kind }
      trimVisionCache()
      vision.persist()
      if (getVisionBroken() !== msg) {
        setVisionBroken(msg)
        log('识图失败（同类只记一次）：' + msg)
      }
      return ''
    }
  }

  async function attachVision(msg, urls, kinds, c = null) {
    const cap = Math.max(1, Math.min(9, Number(c?.visionMaxImages) || Number(config.visionMaxImages) || 2))
    const n = Math.min(urls.length, cap)
    // 两张图并行识，别一张一张等
    const list = await Promise.all(
      Array.from({ length: n }, (_, i) => describeImage(urls[i], kinds?.[i] || 'image', c).catch(() => '')),
    )
    const descs = list.filter(Boolean)
    if (!descs.length) return
    let text = msg.text
    for (const d of descs) text = text.replace(/\[(图片|表情)\]/, `[图片：${d}]`)
    msg.text = text
    msg.vision = descs
  }
  return { generateVision, describeBuffer, describeImage, attachVision }
}
