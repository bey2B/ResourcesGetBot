<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg';
    label?: string;
  }>(),
  {
    size: 'md',
    label: '',
  },
);
</script>

<template>
  <div class="flex items-center justify-center gap-2 py-8 text-slate-400">
    <Loader2
      class="animate-spin"
      :class="size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-7 w-7' : 'h-5 w-5'"
    />
    <span v-if="label" class="text-sm">{{ label }}</span>
  </div>
</template>
