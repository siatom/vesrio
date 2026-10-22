<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  label: string
}>()

const emit = defineEmits<{
  resize: [width: number]
  commit: [width: number]
  reset: []
}>()

const dragging = ref(false)

let startX = 0
let startWidth = 0
let lastWidth = 0

const ariaValueNow = computed(() => Math.round(props.width))

function clamp(value: number) {
  return Math.min(props.max, Math.max(props.min, Math.round(value)))
}

function apply(width: number) {
  lastWidth = clamp(width)
  emit('resize', lastWidth)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  dragging.value = true
  startX = event.clientX
  startWidth = props.width
  lastWidth = props.width
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  document.body.classList.add('is-resizing')
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const delta = event.clientX - startX
  apply(props.side === 'left' ? startWidth + delta : startWidth - delta)
}

function finish() {
  if (!dragging.value) return
  dragging.value = false
  document.body.classList.remove('is-resizing')
  emit('commit', lastWidth)
}

function onKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? 32 : 8
  let next: number | null = null
  if (event.key === 'ArrowLeft') next = props.width + (props.side === 'left' ? -step : step)
  else if (event.key === 'ArrowRight') next = props.width + (props.side === 'left' ? step : -step)
  else if (event.key === 'Home') next = props.min
  else if (event.key === 'End') next = props.max
  if (next == null) return
  event.preventDefault()
  apply(next)
  emit('commit', lastWidth)
}
</script>

<template>
  <div
    class="resize-handle"
    :class="{ 'is-dragging': dragging }"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="ariaValueNow"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="finish"
    @pointercancel="finish"
    @lostpointercapture="finish"
    @keydown="onKeydown"
    @dblclick="emit('reset')"
  >
    <span class="resize-handle__line" aria-hidden="true" />
  </div>
</template>
