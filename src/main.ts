import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { suppressNativeContextMenu } from './lib/contextMenu'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/editor.css'

suppressNativeContextMenu()

createApp(App).use(createPinia()).mount('#app')
