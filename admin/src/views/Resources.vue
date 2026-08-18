<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Copy,
  FilePlus2,
  Inbox,
  Pencil,
  Search,
  Trash2,
} from 'lucide-vue-next';
import { api } from '@/api/client';
import type { Paginated, Resource, ResourcePayload } from '@/api/types';
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
import Switch from '@/components/ui/Switch.vue';
import Table from '@/components/ui/Table.vue';
import Textarea from '@/components/ui/Textarea.vue';

interface SortColumn {
  key: string;
  label: string;
}

const toast = useToastStore();

const sortableColumns: SortColumn[] = [
  { key: 'sequence', label: '序号' },
  { key: 'short_code', label: '短码' },
  { key: 'title', label: '标题' },
  { key: 'price', label: '价格' },
  { key: 'download_count', label: '下载数' },
  { key: 'created_at', label: '创建时间' },
];

const state = reactive({
  items: [] as Resource[],
  total: 0,
  page: 1,
  pageSize: 10,
  q: '',
  sort: 'created_at',
  order: 'desc',
  loading: true,
  error: '',
});

const modalOpen = ref(false);
const modalMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({
  fileId: '',
  fileIdsText: '',
  title: '',
  tags: '',
  isPaid: false,
  price: 0,
});

const deleteTarget = ref<Resource | null>(null);
const deleting = ref(false);

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

async function load() {
  state.loading = true;
  state.error = '';
  try {
    const data = await api.get<Paginated<Resource>>('/resources', {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q,
      sort: state.sort,
      order: state.order,
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

function toggleSort(key: string) {
  if (state.sort === key) {
    state.order = state.order === 'desc' ? 'asc' : 'desc';
  } else {
    state.sort = key;
    state.order = 'desc';
  }
  void load();
}

function tagList(tags: string): string[] {
  return tags
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function openCreate() {
  modalMode.value = 'create';
  editingId.value = null;
  form.fileId = '';
  form.fileIdsText = '';
  form.title = '';
  form.tags = '';
  form.isPaid = false;
  form.price = 0;
  formError.value = '';
  modalOpen.value = true;
}

function openEdit(item: Resource) {
  modalMode.value = 'edit';
  editingId.value = item.id;
  form.fileId = item.file_id;
  form.fileIdsText = parseFileIdsText(item.file_ids);
  form.title = item.title;
  form.tags = item.tags;
  form.isPaid = item.is_paid === 1;
  form.price = item.price;
  formError.value = '';
  modalOpen.value = true;
}

function closeModal() {
  if (!saving.value) modalOpen.value = false;
}

async function submitResource() {
  formError.value = '';
  const fileIds = form.fileIdsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const fileId = fileIds[0] ?? form.fileId.trim();
  if (!fileId) {
    formError.value = 'fileId 不能为空';
    return;
  }
  if (form.isPaid && (!Number.isInteger(form.price) || form.price < 0)) {
    formError.value = '付费价格必须是非负整数';
    return;
  }
  const payload: ResourcePayload = {
    fileId,
    fileIds: fileIds.length > 0 ? fileIds : undefined,
    title: form.title.trim(),
    tags: form.tags.trim(),
    isPaid: form.isPaid,
    price: form.isPaid ? form.price : 0,
  };
  saving.value = true;
  try {
    if (modalMode.value === 'create') {
      await api.post<Resource>('/resources', payload);
      toast.push('success', '资源已创建');
    } else {
      await api.patch<Resource>(`/resources/${editingId.value}`, payload);
      toast.push('success', '资源已更新');
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    formError.value = getErrorMessage(err);
  } finally {
    saving.value = false;
  }
}

function openDelete(item: Resource) {
  deleteTarget.value = item;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await api.delete<{ ok: boolean }>(`/resources/${deleteTarget.value.id}`);
    toast.push('success', '资源已删除');
    deleteTarget.value = null;
    if (state.items.length === 1 && state.page > 1) state.page -= 1;
    await load();
  } catch (err) {
    toast.push('error', getErrorMessage(err));
  } finally {
    deleting.value = false;
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast.push('success', `短码 ${code} 已复制`);
  } catch {
    toast.push('error', '复制失败，请手动复制短码');
  }
}

function parseFileIdsText(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).join('\n');
  } catch {
    // 兼容单文件旧数据
  }
  return raw;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-slate-900">资源列表</h2>
        <p class="mt-0.5 text-sm text-slate-500">共 {{ formatNumber(state.total) }} 个资源</p>
      </div>
      <Button @click="openCreate">
        <FilePlus2 class="h-4 w-4" />
        新增资源
      </Button>
    </div>

    <div class="panel">
      <div class="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div class="relative w-full sm:w-72">
          <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            v-model="state.q"
            type="text"
            placeholder="搜索标题或短码"
            class="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
          />
        </div>
        <span class="text-xs text-slate-400">当前排序：{{ state.sort }} {{ state.order }}</span>
      </div>

      <Table>
        <template #head>
          <th v-for="column in sortableColumns" :key="column.key" class="th-cell">
            <button
              type="button"
              :title="`按${column.label}排序`"
              class="inline-flex h-8 items-center gap-1 rounded px-1 transition-colors hover:text-slate-800"
              @click="toggleSort(column.key)"
            >
              {{ column.label }}
              <component
                :is="
                  state.sort === column.key
                    ? state.order === 'desc'
                      ? ArrowDown
                      : ArrowUp
                    : ChevronsUpDown
                "
                class="h-3.5 w-3.5"
                :class="state.sort === column.key ? 'text-teal-600' : 'text-slate-300'"
              />
            </button>
          </th>
          <th class="th-cell">标签</th>
          <th class="th-cell text-right">操作</th>
        </template>

        <template v-if="state.loading">
          <tr>
            <td colspan="8">
              <Spinner label="正在加载资源" />
            </td>
          </tr>
        </template>
        <template v-else-if="state.error">
          <tr>
            <td colspan="8">
              <div class="flex flex-col items-center gap-2 py-10 text-center">
                <p class="text-sm text-red-600">{{ state.error }}</p>
                <Button variant="outline" @click="load">重试</Button>
              </div>
            </td>
          </tr>
        </template>
        <template v-else-if="state.items.length === 0">
          <tr>
            <td colspan="8">
              <EmptyState :icon="Inbox" title="暂无资源" description="点击右上角「新增资源」创建第一个资源" />
            </td>
          </tr>
        </template>
        <template v-else>
          <tr
            v-for="item in state.items"
            :key="item.id"
            class="transition-colors hover:bg-slate-50"
          >
            <td class="td-cell tabular-nums text-slate-500">#{{ item.sequence }}</td>
            <td class="td-cell">
              <div class="flex items-center gap-1.5">
                <code class="font-mono text-xs text-slate-700">{{ item.short_code }}</code>
                <IconButton title="复制短码" :icon="Copy" size="sm" @click="copyCode(item.short_code)" />
              </div>
            </td>
            <td class="td-cell max-w-[280px]" :title="item.title">
              <span class="block truncate">{{ item.title || '未命名资源' }}</span>
            </td>
            <td class="td-cell">
              <div class="flex max-w-[220px] flex-wrap gap-1">
                <Badge v-for="tag in tagList(item.tags)" :key="tag" variant="neutral">
                  {{ tag }}
                </Badge>
                <span v-if="!tagList(item.tags).length" class="text-xs text-slate-300">—</span>
              </div>
            </td>
            <td class="td-cell">
              <Badge :variant="item.is_paid === 1 ? 'warning' : 'success'">
                {{ item.is_paid === 1 ? `${formatNumber(item.price)} 积分` : '免费' }}
              </Badge>
            </td>
            <td class="td-cell tabular-nums text-slate-600">
              {{ formatNumber(item.download_count) }}
            </td>
            <td class="td-cell whitespace-nowrap text-slate-500">
              {{ formatDateTime(item.created_at) }}
            </td>
            <td class="td-cell">
              <div class="flex items-center justify-end gap-1">
                <IconButton title="编辑资源" :icon="Pencil" @click="openEdit(item)" />
                <IconButton title="删除资源" :icon="Trash2" variant="destructive" @click="openDelete(item)" />
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
      :open="modalOpen"
      :title="modalMode === 'create' ? '新增资源' : '编辑资源'"
      @close="closeModal"
    >
      <div class="space-y-4">
        <div
          v-if="formError"
          class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {{ formError }}
        </div>
        <Input
          :model-value="form.fileId"
          label="fileId"
          placeholder="Telegram 文件 ID"
          @update:model-value="form.fileId = $event"
        />
        <Textarea
          :model-value="form.fileIdsText"
          label="其他文件 ID"
          placeholder="每行一个，可选；多文件资源按行拆分为独立消息块"
          hint="首个文件 ID 同时填入上方 fileId"
          :rows="3"
          @update:model-value="form.fileIdsText = $event"
        />
        <Input
          :model-value="form.title"
          label="标题"
          placeholder="资源标题"
          @update:model-value="form.title = $event"
        />
        <Input
          :model-value="form.tags"
          label="标签"
          placeholder="用逗号分隔多个标签"
          @update:model-value="form.tags = $event"
        />
        <Switch v-model="form.isPaid" label="付费资源" description="开启后用户需消耗积分获取" />
        <Input
          :model-value="form.price"
          type="number"
          label="积分价格"
          placeholder="0"
          :disabled="!form.isPaid"
          @update:model-value="form.price = Number($event)"
        />
      </div>
      <template #footer>
        <Button variant="outline" :disabled="saving" @click="closeModal">取消</Button>
        <Button :loading="saving" @click="submitResource">保存</Button>
      </template>
    </Modal>

    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      title="删除资源"
      :description="`确定删除资源「${deleteTarget?.title || deleteTarget?.short_code || ''}」？删除后不可恢复。`"
      confirm-text="删除"
      :loading="deleting"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
