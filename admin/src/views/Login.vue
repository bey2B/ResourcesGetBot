<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlertCircle, Bot, Eye, EyeOff, KeyRound, LockKeyhole } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/utils/format';
import Button from '@/components/ui/Button.vue';
import IconButton from '@/components/ui/IconButton.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');
const locked = ref(false);

async function submit() {
  if (loading.value) return;
  error.value = '';
  locked.value = false;
  if (!password.value) {
    error.value = '请输入管理员密码';
    return;
  }
  loading.value = true;
  try {
    await auth.login(password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (err) {
    const message = getErrorMessage(err);
    error.value = message;
    locked.value = /锁定|lock|频繁|too many/i.test(message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
    <div class="w-full max-w-md">
      <div class="mb-6 flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
          <Bot class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <h1 class="truncate text-lg font-semibold text-white">Cua 超级助手</h1>
          <p class="text-sm text-slate-400">管理后台</p>
        </div>
      </div>
      <form
        class="rounded-lg border border-slate-800 bg-white p-6 shadow-xl"
        @submit.prevent="submit"
      >
        <h2 class="text-base font-semibold text-slate-900">管理员登录</h2>
        <p class="mt-1 text-sm text-slate-500">连续输错 10 次将临时锁定登录</p>

        <div v-if="error" class="mt-4">
          <div
            class="flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
            :class="locked ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-300 bg-red-50 text-red-700'"
          >
            <LockKeyhole v-if="locked" class="mt-0.5 h-4 w-4 shrink-0" />
            <AlertCircle v-else class="mt-0.5 h-4 w-4 shrink-0" />
            <span class="min-w-0">{{ error }}</span>
          </div>
        </div>

        <div class="mt-5">
          <label for="admin-password" class="mb-1.5 block text-sm font-medium text-slate-700">
            密码
          </label>
          <div class="relative">
            <KeyRound class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="admin-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="请输入管理员密码"
              class="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-10 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
              @keyup.enter="submit"
            />
            <div class="absolute right-1.5 top-1/2 -translate-y-1/2">
              <IconButton
                :title="showPassword ? '隐藏密码' : '显示密码'"
                :icon="showPassword ? EyeOff : Eye"
                size="sm"
                @click="showPassword = !showPassword"
              />
            </div>
          </div>
        </div>

        <Button type="submit" block class="mt-5" :loading="loading">登录</Button>
      </form>
    </div>
  </div>
</template>
