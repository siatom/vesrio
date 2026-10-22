<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

<template>
  <svg
    :width="size ?? 26"
    :height="size ?? 26"
    viewBox="0 0 1024 1024"
    role="img"
    aria-label="文屿 Vesrio"
  >
    <rect width="1024" height="1024" rx="228" fill="var(--logo-bg)" />
    <circle cx="706" cy="314" r="58" fill="var(--logo-sun)" />
    <path
      d="M188 694 C310 612 402 652 500 632 C610 610 714 634 836 700 C724 800 306 808 188 694 Z"
      fill="var(--logo-paper)"
    />
    <path
      d="M300 500 L512 664 L724 500"
      stroke="var(--logo-ink)"
      stroke-width="84"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <path
      d="M512 664 L512 806"
      stroke="var(--logo-ink)"
      stroke-width="84"
      stroke-linecap="round"
      fill="none"
    />
  </svg>
</template>

<style scoped>
svg {
  display: block;
  flex: none;
}
</style>
