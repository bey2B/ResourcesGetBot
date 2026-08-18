<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    label?: string;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
    error?: string;
    hint?: string;
  }>(),
  {
    modelValue: '',
    label: '',
    type: 'text',
    placeholder: '',
    disabled: false,
    error: '',
    hint: '',
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const inputClasses = computed(() => {
  const base =
    'h-9 w-full rounded-md border bg-white px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';
  const border = props.error
    ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
    : 'border-slate-300 focus:border-teal-600 focus:ring-teal-600/15';
  return `${base} ${border}`;
});
</script>

<template>
  <div class="min-w-0">
    <label v-if="label" class="mb-1.5 block text-sm font-medium text-slate-700">{{ label }}</label>
    <input
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="inputClasses"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="error" class="mt-1 text-xs text-red-600">{{ error }}</p>
    <p v-else-if="hint" class="mt-1 text-xs text-slate-400">{{ hint }}</p>
  </div>
</template>
