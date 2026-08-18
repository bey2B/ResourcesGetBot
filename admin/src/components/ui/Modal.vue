<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { X } from 'lucide-vue-next';
import IconButton from './IconButton.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    width?: 'sm' | 'md' | 'lg';
    closeOnOverlay?: boolean;
  }>(),
  {
    description: '',
    width: 'md',
    closeOnOverlay: true,
  },
);

const emit = defineEmits<{ close: [] }>();

const widthClasses = computed(() => {
  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  } as const;
  return widths[props.width];
});

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) emit('close');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade" appear>
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      >
        <div
          class="absolute inset-0 bg-slate-950/40"
          @click="closeOnOverlay && emit('close')"
        ></div>
        <div
          :class="widthClasses"
          class="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        >
          <div class="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold text-slate-900">{{ title }}</h2>
              <p v-if="description" class="mt-1 text-sm text-slate-500">{{ description }}</p>
            </div>
            <IconButton title="关闭" :icon="X" @click="emit('close')" />
          </div>
          <div class="overflow-y-auto px-5 py-4">
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
