/**
 * 探针：用最小 ctx 调一次 apply()，把"插件加载时才会炸"的错误抓出来。
 * 用法：node tools/probe-apply.mjs
 */
import { apply } from '../lib/index.js'

const registered = []
const ctx = {
  effect(fn) {
    try {
      const d = fn()
      return typeof d === 'function' ? d : () => {}
    } catch (e) {
      console.error('[effect 内抛错]', e?.stack || e)
      throw e
    }
  },
  get(name) {
    if (name === 'llm') {
      return {
        listProviders: () => [{ id: 'probe-provider' }],
        listModels: async () => [{ id: 'probe-model', inputModalities: ['text'] }],
        stream: () => {
          throw new Error('probe: 不真正调用模型')
        },
      }
    }
    if (name === 'attachments') return { saveImages: async () => [] }
    if (name === 'hmr') return null
    return null
  },
  llm: {
    listProviders: () => [],
    listModels: async () => [],
    stream: () => {
      throw new Error('probe: 不真正调用模型')
    },
  },
  tools: { register: (t) => registered.push(t) },
  logger: console,
}

let failed = null
try {
  const ret = apply(ctx, {})
  if (ret && typeof ret.then === 'function') {
    ret.catch((e) => {
      failed = e
    })
  }
  console.log('apply() 调用完成，已注册工具:', registered.length)
  const names = registered.map((t) => t.name).join(', ')
  if (names) console.log('工具:', names.slice(0, 300))
} catch (e) {
  failed = e
}

setTimeout(() => {
  if (failed) {
    console.error('\n❌ apply 失败：')
    console.error(failed?.stack || failed)
    process.exit(1)
  }
  console.log('\n✅ apply 没有抛错')
  process.exit(0)
}, 1500)
