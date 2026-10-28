// ESLint 配置：只做"引用错误"这一类检查，不为风格吵人。
// 目标：让 recentErrors 这种"名字用到了但没定义/没导入"的问题在 CI 就被抓住。
export default [
  {
    files: ['lib/**/*.mjs'],
    ignores: ['lib/test-*.mjs', 'lib/client.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
        structuredClone: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        WebSocket: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-unused-private-class-members': 'error',
    },
  },
]
