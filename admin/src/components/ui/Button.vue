<script setup lang="ts">
import { computed } from 'vue';
import { Loader2 } from 'lucide-vue-next';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'default' | 'icon';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    title?: string;
    block?: boolean;
  }>(),
  {
    variant: 'primary',
    size: 'default',
    loading: false,
    disabled: false,
    type: 'button',
    title: '',
    block: false,
  },
);

const classes = computed(() => {
  const base =
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/30 disabled:cursor-not-allowed disabled:opacity-60';
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-8 px-2.5 text-xs',
    default: 'h-9 px-3.5',
    icon: 'h-8 w-8',
  };
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-teal-600 text-white hover:bg-teal-700 active:bg-teal-800',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300',
    outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100',
    ghost: 'text-slate-600 hover:bg-slate-100 active:bg-slate-200',
    destructive: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  };
  return [base, sizes[props.size], variants[props.variant], props.block ? 'w-full' : ''].join(' ');
});
</script>

<template>
  <button
    :type="type"
    :title="title || undefined"
    :class="classes"
    :disabled="disabled || loading"
  >
    <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
    <slot v-else />
  </button>
</template>
