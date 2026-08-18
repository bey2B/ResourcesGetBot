<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next';

interface SelectOption {
  label: string;
  value: string | number;
}

withDefaults(
  defineProps<{
    modelValue: string | number;
    label?: string;
    options: SelectOption[];
    disabled?: boolean;
  }>(),
  {
    label: '',
    disabled: false,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <div class="min-w-0">
    <label v-if="label" class="mb-1.5 block text-sm font-medium text-slate-700">{{ label }}</label>
    <div class="relative">
      <select
        :value="modelValue"
        :disabled="disabled"
        class="h-9 w-full appearance-none rounded-md border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-900 outline-none transition-colors focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in options" :key="String(option.value)" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <ChevronDown
        class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      />
    </div>
  </div>
</template>
