<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { AlertTriangle, Pencil, Plus, Power, Save, Trash2 } from 'lucide-vue-next';
import { api } from '@/api/client';
import type { Ad, AdPayload, Paginated } from '@/api/types';
import { getErrorMessage } from '@/utils/format';
import { useToastStore } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import IconButton from '@/components/ui/IconButton.vue';
import Input from '@/components/ui/Input.vue';
import Modal from '@/components/ui/Modal.vue';
import Select from '@/components/ui/Select.vue';
import Spinner from '@/components/ui/Spinner.vue';
import Switch from '@/components/ui/Switch.vue';
import Textarea from '@/components/ui/Textarea.vue';

interface SettingField {
  key: string;
  label: string;
  type: 'switch' | 'number' | 'textarea';
  placeholder?: string;
  description?: string;
  hint?: string;
  defaultValue: string;
}

const coreFields: SettingField[] = [
  {
    key: 'force_subscribe_enabled',
    label: '强制关注',
    type: 'switch',
    description: '开启后用户获取资源前必须关注绑定频道',
    defaultValue: '0',
  },
  {
    key: 'sub_channels',
    label: '绑定频道',
    type: 'textarea',
    placeholder: '@频道1, @频道2 或数字频道 ID',
    defaultValue: '',
  },
  {
    key: 'group_reply_enabled',
    label: '群组回复',
    type: 'switch',
    description: '群内发送短码自动回复资源',
    defaultValue: '1',
  },
  {
    key: 'group_auto_delete_seconds',
    label: '自动删除秒数',
    type: 'number',
    hint: '0 表示不自动删除',
    defaultValue: '0',
  },
  {
    key: 'rate_limit_seconds',
    label: '风控限流秒数',
    type: 'number',
    hint: '同一用户重复请求同一资源的间隔',
    defaultValue: '30',
  },
  {
    key: 'message_block_enabled',
    label: '一个文件一个消息块',
    type: 'switch',
    description: '开启后每个文件单独一个消息块展示',
    defaultValue: '0',
  },
  {
    key: 'invite_reward_window_seconds',
    label: '邀请奖励窗口秒数',
    type: 'number',
    hint: '被邀请用户注册后的奖励有效窗口',
    defaultValue: '300',
  },
];

const toast = useToastStore();

const form = reactive<Record<string, string>>({});
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const saveError = ref('');

const ads = ref<Ad[]>([]);
const adsLoading = ref(true);
const adsError = ref('');
const adModalOpen = ref(false);
const editingAdId = ref<number | null>(null);
const adSaving = ref(false);
const adFormError = ref('');
const adForm = reactive({
  position: 'top' as 'top' | 'bottom',
  content: '',
  weight: 1,
  enabled: true,
});
const deleteAdTarget = ref<Ad | null>(null);
const adDeleting = ref(false);

function isOn(key: string): boolean {
  return ['1', 'true', 'on'].includes(String(form[key] ?? '').toLowerCase());
}

function setOn(key: string, value: boolean) {
  form[key] = value ? '1' : '0';
}

function parseChannels(raw?: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch {
    // 逗号分隔格式直接返回
  }
  return value;
}

async function loadSettings() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await api.get<{ settings: Record<string, string> }>('/settings');
    const settings = data?.settings ?? {};
    for (const field of coreFields) {
      form[field.key] =
        field.key === 'sub_channels'
          ? parseChannels(settings[field.key])
          : String(settings[field.key] ?? field.defaultValue);
    }
  } catch (err) {
    loadError.value = getErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function loadAds() {
  adsLoading.value = true;
  adsError.value = '';
  try {
    const data = await api.get<Paginated<Ad>>('/ads', { page: 1, pageSize: 100 });
    ads.value = data.items ?? [];
  } catch (err) {
    adsError.value = getErrorMessage(err);
  } finally {
    adsLoading.value = false;
  }
}

function buildPayload(): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const field of coreFields) {
    const raw = String(form[field.key] ?? field.defaultValue).trim();
    payload[field.key] = field.type === 'switch' ? (isOn(field.key) ? '1' : '0') : raw;
  }
  return payload;
}

async function saveSettings() {
  saving.value = true;
  saveError.value = '';
  try {
    await api.patch<{ ok: boolean }>('/settings', { settings: buildPayload() });
    toast.push('success', '系统设置已保存');
  } catch (err) {
    saveError.value = getErrorMessage(err);
  } finally {
    saving.value = false;
  }
}

function positionLabel(position: 'top' | 'bottom'): string {
  return position === 'top' ? '上方' : '下方';
}

function setAdPosition(value: string) {
  adForm.position = value === 'bottom' ? 'bottom' : 'top';
}

function openCreateAd() {
  editingAdId.value = null;
  adForm.position = 'top';
  adForm.content = '';
  adForm.weight = 1;
  adForm.enabled = true;
  adFormError.value = '';
  adModalOpen.value = true;
}

function openEditAd(ad: Ad) {
  editingAdId.value = ad.id;
  adForm.position = ad.position;
  adForm.content = ad.content;
  adForm.weight = ad.weight;
  adForm.enabled = ad.enabled === 1;
  adFormError.value = '';
  adModalOpen.value = true;
}

function closeAdModal() {
  if (!adSaving.value) adModalOpen.value = false;
}

async function saveAd() {
  adFormError.value = '';
  const content = adForm.content.trim();
  if (!content) {
    adFormError.value = '广告内容不能为空';
    return;
  }
  const weight = Number(adForm.weight);
  if (!Number.isInteger(weight) || weight < 0) {
    adFormError.value = '权重必须是非负整数';
    return;
  }
  const payload: AdPayload = {
    position: adForm.position,
    content,
    weight,
    enabled: adForm.enabled,
  };
  adSaving.value = true;
  try {
    if (editingAdId.value === null) {
      await api.post<Ad>('/ads', payload);
      toast.push('success', '广告已添加');
    } else {
      await api.patch<Ad>(`/ads/${editingAdId.value}`, payload);
      toast.push('success', '广告已更新');
    }
    adModalOpen.value = false;
    await loadAds();
  } catch (err) {
    adFormError.value = getErrorMessage(err);
  } finally {
    adSaving.value = false;
  }
}

async function toggleAd(ad: Ad) {
  try {
    await api.patch<Ad>(`/ads/${ad.id}`, { enabled: ad.enabled !== 1 });
    await loadAds();
  } catch (err) {
    toast.push('error', getErrorMessage(err));
  }
}

async function confirmDeleteAd() {
  if (!deleteAdTarget.value) return;
  adDeleting.value = true;
  try {
    await api.delete<{ ok: boolean }>(`/ads/${deleteAdTarget.value.id}`);
    toast.push('success', '广告已删除');
    deleteAdTarget.value = null;
    await loadAds();
  } catch (err) {
    toast.push('error', getErrorMessage(err));
  } finally {
    adDeleting.value = false;
  }
}

onMounted(() => {
  void loadSettings();
  void loadAds();
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-slate-900">系统设置</h2>
        <p class="mt-0.5 text-sm text-slate-500">强制关注、群组回复、风控与广告参数</p>
      </div>
      <Button :loading="saving" :disabled="loading" @click="saveSettings">
        <Save class="h-4 w-4" />
        保存设置
      </Button>
    </div>

    <Spinner v-if="loading" label="正在加载设置" />
    <div
      v-else-if="loadError"
      class="panel flex flex-col items-center justify-center gap-3 px-4 py-12 text-center"
    >
      <AlertTriangle class="h-6 w-6 text-amber-500" />
      <p class="text-sm text-slate-600">{{ loadError }}</p>
      <Button variant="outline" @click="loadSettings">重试</Button>
    </div>
    <template v-else>
      <div
        v-if="saveError"
        class="rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700"
      >
        {{ saveError }}
      </div>

      <div class="panel">
        <div class="px-5 py-5">
          <h3 class="text-sm font-semibold text-slate-900">关注与回复</h3>
          <div class="mt-4 grid gap-5 sm:grid-cols-2">
            <Switch
              :model-value="isOn('force_subscribe_enabled')"
              label="强制关注"
              description="开启后获取资源前需关注绑定频道"
              @update:model-value="setOn('force_subscribe_enabled', $event)"
            />
            <Switch
              :model-value="isOn('group_reply_enabled')"
              label="群组回复"
              description="群内发送短码自动回复资源"
              @update:model-value="setOn('group_reply_enabled', $event)"
            />
            <div class="sm:col-span-2">
              <Textarea
                :model-value="String(form.sub_channels ?? '')"
                label="绑定频道"
                placeholder="@频道1, @频道2 或数字频道 ID"
                :rows="3"
                @update:model-value="form.sub_channels = $event"
              />
            </div>
            <Input
              :model-value="String(form.group_auto_delete_seconds ?? '0')"
              type="number"
              label="自动删除秒数"
              hint="0 表示不自动删除"
              @update:model-value="form.group_auto_delete_seconds = $event"
            />
            <Input
              :model-value="String(form.rate_limit_seconds ?? '30')"
              type="number"
              label="风控限流秒数"
              hint="同一用户重复请求同一资源的间隔"
              @update:model-value="form.rate_limit_seconds = $event"
            />
          </div>
        </div>

        <div class="border-t border-slate-200 px-5 py-5">
          <h3 class="text-sm font-semibold text-slate-900">风控与消息</h3>
          <div class="mt-4 grid gap-5 sm:grid-cols-2">
            <Switch
              :model-value="isOn('message_block_enabled')"
              label="一个文件一个消息块"
              description="开启后每个文件单独一个消息块展示"
              @update:model-value="setOn('message_block_enabled', $event)"
            />
            <Input
              :model-value="String(form.invite_reward_window_seconds ?? '300')"
              type="number"
              label="邀请奖励窗口秒数"
              hint="被邀请用户注册后的奖励有效窗口"
              @update:model-value="form.invite_reward_window_seconds = $event"
            />
          </div>
        </div>

        <div class="border-t border-slate-200 px-5 py-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold text-slate-900">广告配置</h3>
              <p class="mt-0.5 text-xs text-slate-500">上方/下方广告位，权重越大出现概率越高</p>
            </div>
            <Button size="sm" @click="openCreateAd">
              <Plus class="h-4 w-4" />
              新增广告
            </Button>
          </div>

          <Spinner v-if="adsLoading" class="mt-4" label="正在加载广告" />
          <div
            v-else-if="adsError"
            class="mt-4 flex flex-col items-center gap-2 rounded-md border border-slate-200 px-3 py-6 text-center"
          >
            <p class="text-sm text-red-600">{{ adsError }}</p>
            <Button variant="outline" size="sm" @click="loadAds">重试</Button>
          </div>
          <div
            v-else-if="ads.length === 0"
            class="mt-4 rounded-md border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-400"
          >
            暂无广告，点击「新增广告」创建第一条
          </div>
          <div v-else class="mt-4 space-y-2">
            <div
              v-for="ad in ads"
              :key="ad.id"
              class="flex items-start justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge :variant="ad.position === 'top' ? 'info' : 'warning'">
                    {{ positionLabel(ad.position) }}
                  </Badge>
                  <Badge :variant="ad.enabled === 1 ? 'success' : 'neutral'">
                    {{ ad.enabled === 1 ? '启用' : '停用' }}
                  </Badge>
                  <span class="text-xs text-slate-400">权重 {{ ad.weight }}</span>
                </div>
                <p class="mt-1.5 break-words text-sm text-slate-700">{{ ad.content }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <IconButton
                  :title="ad.enabled === 1 ? '停用广告' : '启用广告'"
                  :icon="Power"
                  :variant="ad.enabled === 1 ? 'secondary' : 'primary'"
                  @click="toggleAd(ad)"
                />
                <IconButton title="编辑广告" :icon="Pencil" @click="openEditAd(ad)" />
                <IconButton
                  title="删除广告"
                  :icon="Trash2"
                  variant="destructive"
                  @click="deleteAdTarget = ad"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Modal
      :open="adModalOpen"
      :title="editingAdId === null ? '新增广告' : '编辑广告'"
      @close="closeAdModal"
    >
      <div class="space-y-4">
        <div
          v-if="adFormError"
          class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {{ adFormError }}
        </div>
        <Select
          :model-value="adForm.position"
          label="广告位"
          :options="[
            { label: '上方', value: 'top' },
            { label: '下方', value: 'bottom' },
          ]"
          @update:model-value="setAdPosition"
        />
        <Textarea
          :model-value="adForm.content"
          label="广告内容"
          placeholder="请输入广告文案"
          :rows="3"
          @update:model-value="adForm.content = $event"
        />
        <Input
          :model-value="adForm.weight"
          type="number"
          label="权重"
          hint="越大出现概率越高"
          @update:model-value="adForm.weight = Number($event)"
        />
        <Switch
          :model-value="adForm.enabled"
          label="启用广告"
          @update:model-value="adForm.enabled = $event"
        />
      </div>
      <template #footer>
        <Button variant="outline" :disabled="adSaving" @click="closeAdModal">取消</Button>
        <Button :loading="adSaving" @click="saveAd">保存</Button>
      </template>
    </Modal>

    <ConfirmDialog
      :open="Boolean(deleteAdTarget)"
      title="删除广告"
      :description="`确定删除该${deleteAdTarget ? positionLabel(deleteAdTarget.position) : ''}广告？删除后不再轮换展示。`"
      confirm-text="删除"
      :loading="adDeleting"
      @close="deleteAdTarget = null"
      @confirm="confirmDeleteAd"
    />
  </div>
</template>
