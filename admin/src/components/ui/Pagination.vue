<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import IconButton from './IconButton.vue';
import { formatNumber } from '@/utils/format';

const props = withDefaults(
  defineProps<{
    page: number;
    pageSize: number;
    total: number;
  }>(),
  {},
);

const emit = defineEmits<{
  'update:page': [value: number];
  'update:pageSize': [value: number];
}>();

const pageSizes = [10, 20, 50];

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

const pages = computed<number[]>(() => {
  const total = totalPages.value;
  const current = props.page;
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const candidates = new Set<number>([1, total, current - 1, current, current + 1]);
  return [...candidates]
    .filter((item) => item >= 1 && item <= total)
    .sort((a, b) => a - b);
});

function go(page: number) {
  const next = Math.min(Math.max(1, page), totalPages.value);
  if (next !== props.page) emit('update:page', next);
}
</script>

<template>
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3"
  >
    <div class="flex items-center gap-2 text-sm text-slate-500">
      <span>共 {{ formatNumber(total) }} 条</span>
      <select
        :value="pageSize"
        class="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-teal-600"
        title="每页条数"
        @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="size in pageSizes" :key="size" :value="size">{{ size }} 条/页</option>
      </select>
    </div>
    <div class="flex items-center gap-1">
      <IconButton
        title="上一页"
        :icon="ChevronLeft"
        size="sm"
        :disabled="page <= 1"
        @click="go(page - 1)"
      />
      <template v-for="(item, index) in pages" :key="item">
        <span v-if="index > 0 && item - (pages[index - 1] ?? 0) > 1" class="px-1 text-sm text-slate-400">
          …
        </span>
        <button
          type="button"
          :title="`第 ${item} 页`"
          class="h-7 min-w-[28px] rounded-md px-1.5 text-xs font-medium transition-colors"
          :class="
            item === page
              ? 'bg-teal-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          "
          @click="go(item)"
        >
          {{ item }}
        </button>
      </template>
      <IconButton
        title="下一页"
        :icon="ChevronRight"
        size="sm"
        :disabled="page >= totalPages"
        @click="go(page + 1)"
      />
    </div>
  </div>
</template>
