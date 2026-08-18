<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    label?: string;
    description?: string;
    disabled?: boolean;
  }>(),
  {
    label: '',
    description: '',
    disabled: false,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

function toggle() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0">
      <p class="text-sm font-medium text-slate-800">{{ label }}</p>
      <p v-if="description" class="mt-0.5 text-xs text-slate-500">{{ description }}</p>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      :disabled="disabled"
      :title="label"
      class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/30 disabled:cursor-not-allowed disabled:opacity-50"
      :class="modelValue ? 'bg-teal-600' : 'bg-slate-300'"
      @click="toggle"
    >
      <span
        class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        :class="modelValue ? 'translate-x-[18px]' : 'translate-x-0.5'"
      />
    </button>
  </div>
</template>
