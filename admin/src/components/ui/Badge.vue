<script setup lang="ts">
import { computed } from 'vue';

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'teal';

const props = withDefaults(
  defineProps<{
    variant?: BadgeVariant;
  }>(),
  {
    variant: 'neutral',
  },
);

const classes = computed(() => {
  const base =
    'inline-flex h-5 max-w-full items-center whitespace-nowrap rounded px-1.5 text-xs font-medium';
  const variants: Record<BadgeVariant, string> = {
    neutral: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
    info: 'bg-sky-50 text-sky-700',
    teal: 'bg-teal-50 text-teal-700',
  };
  return `${base} ${variants[props.variant]}`;
});
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
