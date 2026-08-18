<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue';
import { Inbox, RefreshCw } from 'lucide-vue-next';
import { api } from '@/api/client';
import type { AdminLog, Paginated } from '@/api/types';
import { formatDateTime, formatNumber, getErrorMessage, truncate } from '@/utils/format';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import IconButton from '@/components/ui/IconButton.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Spinner from '@/components/ui/Spinner.vue';
import Table from '@/components/ui/Table.vue';

const state = reactive({
  items: [] as AdminLog[],
  total: 0,
  page: 1,
  pageSize: 20,
  loading: true,
  error: '',
});

watch(
  () => [state.page, state.pageSize],
  () => {
    void load();
  },
);

async function load() {
  state.loading = true;
  state.error = '';
  try {
    const data = await api.get<Paginated<AdminLog>>('/logs', {
      page: state.page,
      pageSize: state.pageSize,
    });
    state.items = data.items ?? [];
    state.total = data.total ?? 0;
  } catch (err) {
    state.error = getErrorMessage(err);
  } finally {
    state.loading = false;
  }
}

onMounted(load);

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    login: '登录',
    login_fail: '登录失败',
    settings_update: '修改设置',
    resource_create: '新增资源',
    resource_update: '编辑资源',
    resource_delete: '删除资源',
    user_ban: '封禁用户',
    user_unban: '解封用户',
    user_points: '调整积分',
    user_update: '更新用户',
    ad_create: '新增广告',
    ad_update: '编辑广告',
    ad_delete: '删除广告',
    ad_weight: '调整广告权重',
    ad_toggle: '切换广告',
    broadcast_schedule: '定时广播',
    broadcast_create: '创建广播',
    broadcast_finished: '广播完成',
    broadcast_cancel: '取消广播',
  };
  return map[action] ?? action;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-slate-900">操作日志</h2>
        <p class="mt-0.5 text-sm text-slate-500">共 {{ formatNumber(state.total) }} 条记录</p>
      </div>
      <IconButton title="刷新日志" :icon="RefreshCw" variant="outline" @click="load" />
    </div>

    <div class="panel">
      <Table>
        <template #head>
          <th class="th-cell">时间</th>
          <th class="th-cell">管理员 ID</th>
          <th class="th-cell">操作</th>
          <th class="th-cell">详情</th>
        </template>

        <template v-if="state.loading">
          <tr>
            <td colspan="4">
              <Spinner label="正在加载日志" />
            </td>
          </tr>
        </template>
        <template v-else-if="state.error">
          <tr>
            <td colspan="4">
              <div class="flex flex-col items-center gap-2 py-10 text-center">
                <p class="text-sm text-red-600">{{ state.error }}</p>
                <Button variant="outline" @click="load">重试</Button>
              </div>
            </td>
          </tr>
        </template>
        <template v-else-if="state.items.length === 0">
          <tr>
            <td colspan="4">
              <EmptyState :icon="Inbox" title="暂无操作日志" />
            </td>
          </tr>
        </template>
        <template v-else>
          <tr
            v-for="log in state.items"
            :key="log.id"
            class="transition-colors hover:bg-slate-50"
          >
            <td class="td-cell whitespace-nowrap tabular-nums text-slate-500">
              {{ formatDateTime(log.created_at) }}
            </td>
            <td class="td-cell tabular-nums text-slate-600">{{ log.admin_id }}</td>
            <td class="td-cell">
              <Badge variant="info">{{ actionLabel(log.action) }}</Badge>
            </td>
            <td class="td-cell max-w-[420px]" :title="log.detail">
              <span class="block truncate font-mono text-xs text-slate-600">
                {{ truncate(log.detail, 120) || '—' }}
              </span>
            </td>
          </tr>
        </template>
      </Table>

      <Pagination
        v-model:page="state.page"
        v-model:page-size="state.pageSize"
        :total="state.total"
      />
    </div>
  </div>
</template>
