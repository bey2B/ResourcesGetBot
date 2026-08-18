<script setup lang="ts">
import { computed } from 'vue';
import type { Component } from 'vue';
import { Loader2 } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    title: string;
    icon: Component;
    variant?: 'ghost' | 'outline' | 'destructive' | 'primary' | 'secondary';
    disabled?: boolean;
    loading?: boolean;
    size?: 'sm' | 'md';
  }>(),
  {
    variant: 'ghost',
    disabled: false,
    loading: false,
    size: 'md',
  },
);

const classes = computed(() => {
  const base =
    'inline-flex shrink-0 select-none items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/30 disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = {
    sm: 'h-7 w-7',
    md: 'h-8 w-8',
  } as const;
  const variants = {
    ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
    outline: 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
    destructive: 'text-red-600 hover:bg-red-50',
    primary: 'bg-teal-600 text-white hover:bg-teal-700',
    secondary: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
  } as const;
  return [base, sizes[props.size], variants[props.variant]].join(' ');
});
</script>

<template>
  <button
    type="button"
    :title="title"
    :aria-label="title"
    :class="classes"
    :disabled="disabled || loading"
  >
    <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
    <component :is="icon" v-else class="h-4 w-4" />
  </button>
</template>
