import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { resolve } from 'path'

// Terminals inside VS Code / Electron-based tools export ELECTRON_RUN_AS_NODE=1.
// The Electron app spawned by `electron-vite dev` inherits it and boots as plain
// Node (`electron.app` is undefined), so drop it before electron-vite launches.
delete process.env.ELECTRON_RUN_AS_NODE

// Plugin para compilar o worker após o build
const buildWorkerPlugin = () => {
  return {
    name: 'build-worker',
    buildStart() {
      // Compilar o worker antes do build do main
      try {
        const workerSrc = resolve(__dirname, 'src/main/stt/workers/sttWorker.ts')
        const workerOut = resolve(__dirname, 'dist/main/stt/workers')
        execSync(`mkdir -p ${workerOut} && npx tsc ${workerSrc} --outDir ${workerOut} --module commonjs --target es2020 --esModuleInterop --skipLibCheck --resolveJsonModule --moduleResolution node`, { stdio: 'ignore' })
      } catch (error) {
        // Ignorar erros silenciosamente
      }
    },
    buildEnd() {
      // Garantir que o worker está compilado após o build
      try {
        const workerSrc = resolve(__dirname, 'src/main/stt/workers/sttWorker.ts')
        const workerOut = resolve(__dirname, 'dist/main/stt/workers')
        execSync(`mkdir -p ${workerOut} && npx tsc ${workerSrc} --outDir ${workerOut} --module commonjs --target es2020 --esModuleInterop --skipLibCheck --resolveJsonModule --moduleResolution node`, { stdio: 'ignore' })
      } catch (error) {
        // Ignorar erros silenciosamente
      }
    }
  }
}

const xyflowJsxRuntimePlugin = () => {
  return {
    name: 'xyflow-jsx-runtime-alias',
    enforce: 'pre',
    async resolveId(id: string) {
      if (
        id.startsWith('@xyflow/react/jsx-runtime') ||
        id.startsWith('@xyflow/react/jsx-dev-runtime')
      ) {
        const rewritten = id.replace('@xyflow/react', 'react')
        const resolved = await this.resolve(rewritten, undefined, { skipSelf: true })
        return resolved ? resolved.id : rewritten
      }
      return null
    }
  }
}

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin(), buildWorkerPlugin()],
        build: {
            outDir: 'dist/main',
            emptyOutDir: false // Não limpar o diretório para preservar o worker compilado
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'dist/preload'
        }
    },
    renderer: {
        plugins: [xyflowJsxRuntimePlugin(), react({ jsxImportSource: 'react' })],
        resolve: {
            alias: [
                { find: /^@xyflow\/react\/jsx-runtime/, replacement: 'react/jsx-runtime' },
                { find: /^@xyflow\/react\/jsx-dev-runtime/, replacement: 'react/jsx-dev-runtime' }
            ]
        },
        optimizeDeps: {
            include: [
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                // @xyflow/react is excluded, so its CJS-only transitive dep must be pre-bundled
                // explicitly (pnpm hides it from the optimizer scan) or the renderer crashes.
                '@xyflow/react > zustand > use-sync-external-store/shim/with-selector.js'
            ],
            exclude: ['@xyflow/react']
        },
        build: {
            outDir: 'dist/renderer'
        }
    }
})
