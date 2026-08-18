<script setup lang="ts">
import { CheckCircle2, Info, X, XCircle } from 'lucide-vue-next';
import { useToastStore } from '@/stores/toast';
import type { ToastType } from '@/stores/toast';

const toastStore = useToastStore();

const icons: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const colors: Record<ToastType, string> = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  info: 'text-sky-600',
};
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <TransitionGroup name="toast">
        <div
          v-for="item in toastStore.items"
          :key="item.id"
          class="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <component :is="icons[item.type]" class="mt-0.5 h-4 w-4 shrink-0" :class="colors[item.type]" />
          <p class="min-w-0 flex-1 text-sm leading-5 text-slate-700">{{ item.message }}</p>
          <button
            type="button"
            title="关闭提示"
            class="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            @click="toastStore.remove(item.id)"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
