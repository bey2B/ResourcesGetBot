<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    error?: string;
    rows?: number;
    hint?: string;
  }>(),
  {
    modelValue: '',
    label: '',
    placeholder: '',
    disabled: false,
    error: '',
    rows: 4,
    hint: '',
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const textareaClasses = computed(() => {
  const base =
    'w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';
  const border = props.error
    ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
    : 'border-slate-300 focus:border-teal-600 focus:ring-teal-600/15';
  return `${base} ${border}`;
});
</script>

<template>
  <div class="min-w-0">
    <label v-if="label" class="mb-1.5 block text-sm font-medium text-slate-700">{{ label }}</label>
    <textarea
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="textareaClasses"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <p v-if="error" class="mt-1 text-xs text-red-600">{{ error }}</p>
    <p v-else-if="hint" class="mt-1 text-xs text-slate-400">{{ hint }}</p>
  </div>
</template>
