// 把 panel/index.html + panel/panel.css 打成 lib/client.js。
//
// 为什么这么做：DSH 的 Client 半是"一个 JS 模块 + 一个注册进 slot 的组件"，
// 没有静态资源目录可用。微信插件用的是同一套办法：CSS/DOM/JS 三块字符串塞进
// 模块里，组件挂载时把它们注入 DOM。这样面板可以继续用一个单文件 HTML 维护，
// 改完跑一次本脚本即可，不需要 webpack。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(HERE, 'panel', 'index.html'), 'utf8')
const css = readFileSync(join(HERE, 'panel', 'panel.css'), 'utf8')

const scriptStart = html.indexOf('<script>')
const scriptEnd = html.lastIndexOf('</script>')
if (scriptStart < 0 || scriptEnd < 0) throw new Error('panel/index.html 里找不到 <script> 块')
const panelJs = html.slice(scriptStart + '<script>'.length, scriptEnd)

const panelStart = html.indexOf('<div id="qq-panel"')
const beforeScript = html.slice(0, scriptStart)
const panelEnd = beforeScript.lastIndexOf('</div>')
if (panelStart < 0 || panelEnd < panelStart) throw new Error('panel/index.html 里找不到 #qq-panel 容器')
const panelDom = html.slice(panelStart, panelEnd + '</div>'.length)

const out = `window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-qq-bot",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    //#region 由 build-client.mjs 从 panel/index.html + panel/panel.css 生成（勿手改）
    const inject = ["slots"];
    const PANEL_CSS = ${JSON.stringify(css)};
    const PANEL_DOM = ${JSON.stringify(panelDom)};
    const PANEL_JS = ${JSON.stringify(panelJs)};

    function QqBotIcon() {
      return react.createElement("span", { style: { fontSize: 16, lineHeight: 1 } }, "🐳");
    }

    /** 面板整页：React 空壳 + 挂载时注入 DOM（与微信插件同款迁移法）。 */
    function QqBotPanel() {
      const hostRef = react.useRef(null);
      react.useEffect(() => {
        const root = hostRef.current;
        if (!root) return;
        document.body.classList.add("qq-embed-host");
        const styleEl = document.createElement("style");
        styleEl.setAttribute("data-qqpanel", "1");
        styleEl.textContent = PANEL_CSS;
        document.head.appendChild(styleEl);
        root.innerHTML = PANEL_DOM;
        try {
          new Function(PANEL_JS)();
        } catch (e) {
          console.error("[qq-bot client] 面板脚本执行失败:", e);
          const msg = root.querySelector("#view");
          if (msg) msg.textContent = "面板脚本加载失败：" + String(e) + "（原始页面仍可用：/qq-bot）";
        }
        return () => {
          try { (window.__qqpanelTimers || []).forEach(clearInterval); } catch { }
          window.__qqpanelTimers = [];
          try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); } catch { }
          try { document.body.classList.remove("qq-embed-host"); } catch { }
        };
      }, []);
      return react.createElement("div", { ref: hostRef, className: "qq-panel-embed" });
    }
    //#endregion

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
        name: "main",
        key: "qqbot",
        inject: () => ({})
      }, QqBotPanel)), "dsh-qq-bot: main page");
      ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist",
        id: "qqbot",
        order: 91,
        label: () => "QQ 机器人"
      }, QqBotIcon)), "dsh-qq-bot: sidebar entry");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
`

writeFileSync(join(HERE, 'lib', 'client.js'), out, 'utf8')
console.log(`lib/client.js 已生成：css ${css.length} 字节，dom ${panelDom.length} 字节，js ${panelJs.length} 字节`)
