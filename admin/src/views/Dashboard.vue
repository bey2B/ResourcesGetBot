<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  AlertTriangle,
  CalendarCheck,
  Coins,
  Download,
  Files,
  Megaphone,
  RefreshCw,
  TrendingDown,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-vue-next';
import { api } from '@/api/client';
import type { DashboardData, HeatmapEntry, Trends7d } from '@/api/types';
import { formatNumber, getErrorMessage } from '@/utils/format';
import Button from '@/components/ui/Button.vue';
import Spinner from '@/components/ui/Spinner.vue';

const loading = ref(true);
const error = ref('');
const data = ref<DashboardData | null>(null);
const trendRange = ref<'7d' | '30d'>('7d');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.get<DashboardData>('/dashboard');
  } catch (err) {
    error.value = getErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const stats = computed(() => [
  {
    label: '总用户',
    value: data.value?.totals.users ?? 0,
    icon: UsersIcon,
    tint: 'bg-teal-50 text-teal-700',
  },
  {
    label: '今日下载',
    value: data.value?.totals.downloadsToday ?? 0,
    icon: Download,
    tint: 'bg-sky-50 text-sky-700',
  },
  {
    label: '资源数',
    value: data.value?.totals.resources ?? 0,
    icon: Files,
    tint: 'bg-amber-50 text-amber-700',
  },
  {
    label: '广播数',
    value: data.value?.totals.broadcasts ?? 0,
    icon: Megaphone,
    tint: 'bg-rose-50 text-rose-700',
  },
]);

const trendTitle = computed(() =>
  trendRange.value === '7d' ? '近 7 日趋势' : '近 30 日趋势',
);
const trends = computed<Trends7d>(() => {
  const source = trendRange.value === '7d' ? data.value?.trends7d : data.value?.trends30d;
  return source ?? { dates: [], newUsers: [], activeUsers: [], downloads: [] };
});
const heatmap = computed<HeatmapEntry[]>(() => data.value?.heatmap24 ?? []);
const points = computed(() => data.value?.pointsCycle ?? { totalEarned: 0, totalSpent: 0, todayCheckins: 0, invites: 0 });

const chartMax = computed(() =>
  Math.max(1, ...trends.value.newUsers, ...trends.value.activeUsers, ...trends.value.downloads),
);
const heatmapMax = computed(() => Math.max(1, ...heatmap.value.map((item) => item.downloads)));

const heatCells = computed<HeatmapEntry[]>(() =>
  heatmap.value.length
    ? heatmap.value
    : Array.from({ length: 24 }, (_, hour) => ({ hour, downloads: 0 })),
);

const pointStats = computed(() => [
  {
    label: '累计发放',
    value: points.value.totalEarned,
    icon: Coins,
    tint: 'bg-teal-50 text-teal-700',
  },
  {
    label: '累计消耗',
    value: points.value.totalSpent,
    icon: TrendingDown,
    tint: 'bg-rose-50 text-rose-700',
  },
  {
    label: '今日签到',
    value: points.value.todayCheckins,
    icon: CalendarCheck,
    tint: 'bg-sky-50 text-sky-700',
  },
  {
    label: '邀请奖励',
    value: points.value.invites,
    icon: UserPlus,
    tint: 'bg-amber-50 text-amber-700',
  },
]);

function barHeight(value: number): string {
  if (!value) return '0%';
  return `${Math.max((value / chartMax.value) * 100, 4).toFixed(1)}%`;
}

function heatColor(item: HeatmapEntry): string {
  const ratio = heatmapMax.value === 0 ? 0 : item.downloads / heatmapMax.value;
  const alpha = 0.08 + ratio * 0.85;
  return `rgba(13, 148, 136, ${alpha.toFixed(3)})`;
}

function heatTitle(item: HeatmapEntry): string {
  return `${String(item.hour).padStart(2, '0')}:00 · ${item.downloads} 次下载`;
}

function dayLabel(date: string): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date.slice(5);
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}
</script>

<template>
  <div class="space-y-4">
    <Spinner v-if="loading" label="正在加载统计数据" />
    <div
      v-else-if="error"
      class="panel flex flex-col items-center justify-center gap-3 px-4 py-12 text-center"
    >
      <AlertTriangle class="h-6 w-6 text-amber-500" />
      <p class="text-sm text-slate-600">{{ error }}</p>
      <Button variant="outline" @click="load">
        <RefreshCw class="h-4 w-4" />
        重试
      </Button>
    </div>
    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="item in stats" :key="item.label" class="panel flex items-center gap-3 p-4">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            :class="item.tint"
          >
            <component :is="item.icon" class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-xs text-slate-500">{{ item.label }}</p>
            <p class="text-2xl font-semibold tabular-nums text-slate-900">
              {{ formatNumber(item.value) }}
            </p>
          </div>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-5">
        <div class="panel xl:col-span-3">
          <div class="panel-header">
            <div class="flex flex-wrap items-center gap-3">
              <h3 class="panel-title">{{ trendTitle }}</h3>
              <div class="flex h-8 items-center overflow-hidden rounded-md border border-slate-200">
                <button
                  type="button"
                  class="h-full px-2.5 text-xs font-medium transition-colors"
                  :class="trendRange === '7d' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'"
                  @click="trendRange = '7d'"
                >
                  7 天
                </button>
                <button
                  type="button"
                  class="h-full border-l border-slate-200 px-2.5 text-xs font-medium transition-colors"
                  :class="trendRange === '30d' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'"
                  @click="trendRange = '30d'"
                >
                  30 天
                </button>
              </div>
            </div>
            <div class="flex items-center gap-4 text-xs text-slate-500">
              <span class="flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-sm bg-teal-600"></span>新用户
              </span>
              <span class="flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-sm bg-amber-500"></span>活跃
              </span>
              <span class="flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-sm bg-sky-500"></span>下载
              </span>
            </div>
          </div>
          <div v-if="trends.dates.length" class="overflow-x-auto pb-3">
            <div class="flex min-w-[620px] items-end gap-2 px-4 pt-4">
              <div
                v-for="(date, index) in trends.dates"
                :key="date || index"
                class="flex flex-1 flex-col items-center gap-1.5"
              >
                <div class="flex h-40 w-full items-end justify-center gap-1">
                  <div
                    class="w-2.5 rounded-sm bg-teal-600"
                    :style="{ height: barHeight(trends.newUsers[index] ?? 0) }"
                    :title="`${dayLabel(date)} 新用户 ${trends.newUsers[index] ?? 0}`"
                  ></div>
                  <div
                    class="w-2.5 rounded-sm bg-amber-500"
                    :style="{ height: barHeight(trends.activeUsers[index] ?? 0) }"
                    :title="`${dayLabel(date)} 活跃 ${trends.activeUsers[index] ?? 0}`"
                  ></div>
                  <div
                    class="w-2.5 rounded-sm bg-sky-500"
                    :style="{ height: barHeight(trends.downloads[index] ?? 0) }"
                    :title="`${dayLabel(date)} 下载 ${trends.downloads[index] ?? 0}`"
                  ></div>
                </div>
                <span class="text-xs text-slate-500">{{ dayLabel(date) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="px-4 py-8 text-center text-sm text-slate-400">暂无趋势数据</div>
        </div>

        <div class="panel xl:col-span-2">
          <div class="panel-header">
            <h3 class="panel-title">24 小时下载分布</h3>
            <div class="flex items-center gap-2 text-xs text-slate-400">
              <span>低</span>
              <span class="h-2 w-16 rounded-sm bg-gradient-to-r from-teal-100 to-teal-700"></span>
              <span>高</span>
            </div>
          </div>
          <div class="overflow-x-auto px-4 py-4">
            <div
              class="grid min-w-[560px] gap-1"
              :style="{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }"
            >
              <div
                v-for="item in heatCells"
                :key="item.hour"
                class="h-7 rounded-[3px] border border-slate-200"
                :style="{ backgroundColor: heatColor(item) }"
                :title="heatTitle(item)"
              ></div>
            </div>
            <div class="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>23:00</span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h3 class="panel-title">积分循环</h3>
        </div>
        <div class="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
          <div
            v-for="item in pointStats"
            :key="item.label"
            class="flex items-center gap-3 p-4"
          >
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
              :class="item.tint"
            >
              <component :is="item.icon" class="h-4 w-4" />
            </div>
            <div class="min-w-0">
              <p class="truncate text-xs text-slate-500">{{ item.label }}</p>
              <p class="text-xl font-semibold tabular-nums text-slate-900">
                {{ formatNumber(item.value) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
