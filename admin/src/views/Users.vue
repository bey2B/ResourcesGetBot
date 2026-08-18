<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { Ban, Coins, History, Inbox, Search, UserCheck } from 'lucide-vue-next';
import { api } from '@/api/client';
import type {
  DownloadRecord,
  Paginated,
  PointsLog,
  User,
  UserStats,
} from '@/api/types';
import { formatDateTime, formatNumber, getErrorMessage } from '@/utils/format';
import { useToastStore } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import IconButton from '@/components/ui/IconButton.vue';
import Input from '@/components/ui/Input.vue';
import Modal from '@/components/ui/Modal.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Spinner from '@/components/ui/Spinner.vue';
import Table from '@/components/ui/Table.vue';

const toast = useToastStore();

const state = reactive({
  items: [] as User[],
  total: 0,
  page: 1,
  pageSize: 10,
  q: '',
  loading: true,
  error: '',
});

const pointsModalOpen = ref(false);
const pointsUser = ref<User | null>(null);
const pointsValue = ref(0);
const pointsError = ref('');
const pointsSaving = ref(false);

const banTarget = ref<User | null>(null);
const banSaving = ref(false);

const detailOpen = ref(false);
const detailUser = ref<User | null>(null);
const detailTab = ref<'logs' | 'downloads'>('logs');
const userStats = ref<UserStats | null>(null);
const logsState = reactive({
  items: [] as PointsLog[],
  total: 0,
  page: 1,
  pageSize: 10,
  loading: false,
  error: '',
});
const downloadsState = reactive({
  items: [] as DownloadRecord[],
  total: 0,
  page: 1,
  pageSize: 10,
  loading: false,
  error: '',
});

let searchTimer: number | undefined;

watch(
  () => state.q,
  () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.page = 1;
      void load();
    }, 350);
  },
);

watch(
  () => [state.page, state.pageSize],
  () => {
    void load();
  },
);

watch(
  () => [logsState.page, logsState.pageSize],
  () => {
    if (detailTab.value === 'logs') void loadLogs();
  },
);

watch(
  () => [downloadsState.page, downloadsState.pageSize],
  () => {
    if (detailTab.value === 'downloads') void loadDownloads();
  },
);

async function load() {
  state.loading = true;
  state.error = '';
  try {
    const data = await api.get<Paginated<User>>('/users', {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q,
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

function displayName(user: User): string {
  return user.username || user.first_name || `用户 ${user.user_id}`;
}

function openPoints(user: User) {
  pointsUser.value = user;
  pointsValue.value = user.points;
  pointsError.value = '';
  pointsModalOpen.value = true;
}

async function savePoints() {
  if (!pointsUser.value) return;
  if (!Number.isInteger(pointsValue.value) || pointsValue.value < 0) {
    pointsError.value = '积分必须是非负整数';
    return;
  }
  pointsSaving.value = true;
  pointsError.value = '';
  try {
    await api.patch<User>(`/users/${pointsUser.value.user_id}`, {
      points: pointsValue.value,
    });
    toast.push('success', `用户 ${pointsUser.value.user_id} 积分已调整为 ${pointsValue.value}`);
    pointsModalOpen.value = false;
    await load();
  } catch (err) {
    pointsError.value = getErrorMessage(err);
  } finally {
    pointsSaving.value = false;
  }
}

function openBan(user: User) {
  banTarget.value = user;
}

async function confirmBanToggle() {
  if (!banTarget.value) return;
  const nextBanned = banTarget.value.is_banned !== 1;
  banSaving.value = true;
  try {
    await api.patch<User>(`/users/${banTarget.value.user_id}`, {
      isBanned: nextBanned,
    });
    toast.push('success', nextBanned ? '用户已封禁' : '用户已解封');
    banTarget.value = null;
    await load();
  } catch (err) {
    toast.push('error', getErrorMessage(err));
  } finally {
    banSaving.value = false;
  }
}

async function openDetail(user: User) {
  detailUser.value = user;
  detailTab.value = 'logs';
  userStats.value = null;
  logsState.page = 1;
  logsState.items = [];
  logsState.total = 0;
  downloadsState.page = 1;
  downloadsState.items = [];
  downloadsState.total = 0;
  detailOpen.value = true;
  await Promise.all([loadUserStats(), loadLogs()]);
}

function closeDetail() {
  detailOpen.value = false;
  detailUser.value = null;
}

async function loadUserStats() {
  if (!detailUser.value) return;
  try {
    userStats.value = await api.get<UserStats>(`/users/${detailUser.value.user_id}/stats`);
  } catch {
    userStats.value = null;
  }
}

async function loadLogs() {
  if (!detailUser.value) return;
  logsState.loading = true;
  logsState.error = '';
  try {
    const data = await api.get<Paginated<PointsLog>>(`/users/${detailUser.value.user_id}/logs`, {
      page: logsState.page,
      pageSize: logsState.pageSize,
    });
    logsState.items = data.items ?? [];
    logsState.total = data.total ?? 0;
  } catch (err) {
    logsState.error = getErrorMessage(err);
  } finally {
    logsState.loading = false;
  }
}

async function loadDownloads() {
  if (!detailUser.value) return;
  downloadsState.loading = true;
  downloadsState.error = '';
  try {
    const data = await api.get<Paginated<DownloadRecord>>(
      `/users/${detailUser.value.user_id}/downloads`,
      {
        page: downloadsState.page,
        pageSize: downloadsState.pageSize,
      },
    );
    downloadsState.items = data.items ?? [];
    downloadsState.total = data.total ?? 0;
  } catch (err) {
    downloadsState.error = getErrorMessage(err);
  } finally {
    downloadsState.loading = false;
  }
}

function switchDetailTab(tab: 'logs' | 'downloads') {
  detailTab.value = tab;
  if (tab === 'logs') {
    if (logsState.items.length === 0) void loadLogs();
  } else if (downloadsState.items.length === 0) {
    void loadDownloads();
  }
}

function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    daily_checkin: '每日签到',
    invite_reward: '邀请奖励',
    resource_purchase: '资源购买',
    admin_adjust: '管理员调整',
  };
  return map[reason] ?? reason;
}

function pointsChangeText(change: number): string {
  return change > 0 ? `+${change}` : String(change);
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-base font-semibold text-slate-900">用户列表</h2>
      <p class="mt-0.5 text-sm text-slate-500">共 {{ formatNumber(state.total) }} 个用户</p>
    </div>

    <div class="panel">
      <div class="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div class="relative w-full sm:w-72">
          <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            v-model="state.q"
            type="text"
            placeholder="搜索用户 ID 或用户名"
            class="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
          />
        </div>
      </div>

      <Table>
        <template #head>
          <th class="th-cell">用户 ID</th>
          <th class="th-cell">用户名</th>
          <th class="th-cell">积分</th>
          <th class="th-cell">邀请人</th>
          <th class="th-cell">封禁状态</th>
          <th class="th-cell">最后活跃</th>
          <th class="th-cell text-right">操作</th>
        </template>

        <template v-if="state.loading">
          <tr>
            <td colspan="7">
              <Spinner label="正在加载用户" />
            </td>
          </tr>
        </template>
        <template v-else-if="state.error">
          <tr>
            <td colspan="7">
              <div class="flex flex-col items-center gap-2 py-10 text-center">
                <p class="text-sm text-red-600">{{ state.error }}</p>
                <Button variant="outline" @click="load">重试</Button>
              </div>
            </td>
          </tr>
        </template>
        <template v-else-if="state.items.length === 0">
          <tr>
            <td colspan="7">
              <EmptyState :icon="Inbox" title="暂无用户" />
            </td>
          </tr>
        </template>
        <template v-else>
          <tr
            v-for="user in state.items"
            :key="user.user_id"
            class="transition-colors hover:bg-slate-50"
          >
            <td class="td-cell tabular-nums text-slate-600">{{ user.user_id }}</td>
            <td class="td-cell max-w-[220px]">
              <span class="block truncate font-medium text-slate-800" :title="displayName(user)">
                {{ displayName(user) }}
              </span>
            </td>
            <td class="td-cell tabular-nums text-slate-600">{{ formatNumber(user.points) }}</td>
            <td class="td-cell tabular-nums text-slate-500">
              {{ user.invited_by ?? '—' }}
            </td>
            <td class="td-cell">
              <Badge :variant="user.is_banned === 1 ? 'danger' : 'success'">
                {{ user.is_banned === 1 ? '已封禁' : '正常' }}
              </Badge>
            </td>
            <td class="td-cell whitespace-nowrap text-slate-500">
              {{ formatDateTime(user.last_active) }}
            </td>
            <td class="td-cell">
              <div class="flex items-center justify-end gap-1">
                <IconButton title="查看记录" :icon="History" @click="openDetail(user)" />
                <IconButton title="调整积分" :icon="Coins" @click="openPoints(user)" />
                <IconButton
                  v-if="user.is_banned === 1"
                  title="解封用户"
                  :icon="UserCheck"
                  variant="primary"
                  @click="openBan(user)"
                />
                <IconButton
                  v-else
                  title="封禁用户"
                  :icon="Ban"
                  variant="destructive"
                  @click="openBan(user)"
                />
              </div>
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

    <Modal
      :open="pointsModalOpen"
      title="调整积分"
      :description="pointsUser ? `用户 ${pointsUser.user_id}，当前积分 ${formatNumber(pointsUser.points)}` : ''"
      @close="pointsModalOpen = false"
    >
      <div class="space-y-4">
        <div
          v-if="pointsError"
          class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {{ pointsError }}
        </div>
        <Input
          :model-value="pointsValue"
          type="number"
          label="新积分余额"
          placeholder="0"
          @update:model-value="pointsValue = Number($event)"
        />
      </div>
      <template #footer>
        <Button variant="outline" :disabled="pointsSaving" @click="pointsModalOpen = false">
          取消
        </Button>
        <Button :loading="pointsSaving" @click="savePoints">保存</Button>
      </template>
    </Modal>

    <ConfirmDialog
      :open="Boolean(banTarget)"
      :title="banTarget?.is_banned === 1 ? '解封用户' : '封禁用户'"
      :description="
        banTarget
          ? banTarget.is_banned === 1
            ? `确定解封用户 ${banTarget.user_id}（${displayName(banTarget)}）？`
            : `确定封禁用户 ${banTarget.user_id}（${displayName(banTarget)}）？封禁后该用户无法获取资源。`
          : ''
      "
      :confirm-text="banTarget?.is_banned === 1 ? '解封' : '封禁'"
      :loading="banSaving"
      @close="banTarget = null"
      @confirm="confirmBanToggle"
    />

    <Modal
      :open="detailOpen"
      width="lg"
      title="用户记录"
      :description="detailUser ? `用户 ${detailUser.user_id}（${displayName(detailUser)}）` : ''"
      @close="closeDetail"
    >
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-md border border-slate-200 px-3 py-2.5">
          <p class="text-xs text-slate-500">下载次数</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
            {{ formatNumber(userStats?.download_count) }}
          </p>
        </div>
        <div class="rounded-md border border-slate-200 px-3 py-2.5">
          <p class="text-xs text-slate-500">签到次数</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
            {{ formatNumber(userStats?.checkin_count) }}
          </p>
        </div>
        <div class="rounded-md border border-slate-200 px-3 py-2.5">
          <p class="text-xs text-slate-500">邀请人数</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
            {{ formatNumber(userStats?.invite_count) }}
          </p>
        </div>
      </div>

      <div class="mt-4 flex gap-1 border-b border-slate-200">
        <button
          type="button"
          class="h-9 rounded-t-md px-3 text-sm font-medium transition-colors"
          :class="
            detailTab === 'logs'
              ? 'border-b-2 border-teal-600 text-teal-700'
              : 'text-slate-500 hover:text-slate-800'
          "
          @click="switchDetailTab('logs')"
        >
          积分日志
        </button>
        <button
          type="button"
          class="h-9 rounded-t-md px-3 text-sm font-medium transition-colors"
          :class="
            detailTab === 'downloads'
              ? 'border-b-2 border-teal-600 text-teal-700'
              : 'text-slate-500 hover:text-slate-800'
          "
          @click="switchDetailTab('downloads')"
        >
          下载记录
        </button>
      </div>

      <div v-if="detailTab === 'logs'">
        <Spinner v-if="logsState.loading" class="mt-4" label="正在加载积分日志" />
        <div
          v-else-if="logsState.error"
          class="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          {{ logsState.error }}
        </div>
        <div
          v-else-if="logsState.items.length === 0"
          class="mt-4 py-8 text-center text-sm text-slate-400"
        >
          暂无积分日志
        </div>
        <div v-else class="mt-2 divide-y divide-slate-100">
          <div
            v-for="log in logsState.items"
            :key="log.id"
            class="flex items-center justify-between gap-3 py-2.5"
          >
            <div class="min-w-0">
              <p class="truncate text-sm text-slate-700">{{ reasonLabel(log.reason) }}</p>
              <p class="text-xs text-slate-400">{{ formatDateTime(log.created_at) }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span
                class="text-sm font-semibold tabular-nums"
                :class="log.change > 0 ? 'text-emerald-600' : 'text-red-600'"
              >
                {{ pointsChangeText(log.change) }}
              </span>
              <span class="text-xs tabular-nums text-slate-400">余额 {{ log.balance_after }}</span>
            </div>
          </div>
        </div>
        <Pagination
          v-model:page="logsState.page"
          v-model:page-size="logsState.pageSize"
          :total="logsState.total"
        />
      </div>

      <div v-else>
        <Spinner v-if="downloadsState.loading" class="mt-4" label="正在加载下载记录" />
        <div
          v-else-if="downloadsState.error"
          class="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          {{ downloadsState.error }}
        </div>
        <div
          v-else-if="downloadsState.items.length === 0"
          class="mt-4 py-8 text-center text-sm text-slate-400"
        >
          暂无下载记录
        </div>
        <div v-else class="mt-2 divide-y divide-slate-100">
          <div
            v-for="record in downloadsState.items"
            :key="record.id"
            class="flex items-center justify-between gap-3 py-2.5"
          >
            <div class="min-w-0">
              <p class="truncate text-sm text-slate-700">{{ record.title || record.short_code }}</p>
              <p class="text-xs text-slate-400">短码 {{ record.short_code }}</p>
            </div>
            <span class="shrink-0 text-xs tabular-nums text-slate-400">
              {{ formatDateTime(record.created_at) }}
            </span>
          </div>
        </div>
        <Pagination
          v-model:page="downloadsState.page"
          v-model:page-size="downloadsState.pageSize"
          :total="downloadsState.total"
        />
      </div>
    </Modal>
  </div>
</template>
