<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(
  defineProps<{
    icon: Component;
    title?: string;
    description?: string;
  }>(),
  {
    title: '暂无数据',
    description: '',
  },
);
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
    <div class="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-400">
      <component :is="icon" class="h-5 w-5" />
    </div>
    <p class="text-sm font-medium text-slate-600">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-xs text-slate-400">{{ description }}</p>
  </div>
</template>
