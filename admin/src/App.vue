<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Bot,
  Files,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings as SettingsIcon,
  Users,
} from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import Toaster from '@/components/ui/Toaster.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sidebarOpen = ref(false);

const isPublic = computed(() => route.meta.public === true);
const pageTitle = computed(() => String(route.meta.title ?? ''));

const navItems = [
  { to: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { to: '/resources', label: '资源管理', icon: Files },
  { to: '/users', label: '用户管理', icon: Users },
  { to: '/settings', label: '系统设置', icon: SettingsIcon },
  { to: '/logs', label: '操作日志', icon: ScrollText },
];

function handleLogout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <Toaster />
  <RouterView v-if="isPublic" />
  <div v-else class="min-h-screen bg-slate-100">
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
      @click="sidebarOpen = false"
    ></div>
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/10 bg-slate-950 text-slate-300 transition-transform lg:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-600 text-white">
          <Bot class="h-4 w-4" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-white">Cua 超级助手</p>
          <p class="text-xs text-slate-400">管理后台</p>
        </div>
      </div>
      <nav class="flex-1 space-y-1 overflow-y-auto p-3">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors"
          :class="
            route.path === item.to
              ? 'bg-teal-600/20 text-teal-300'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
          "
          @click="sidebarOpen = false"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="border-t border-white/10 p-3">
        <div class="flex items-center gap-2.5 rounded-md px-2 py-2">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600/20 text-xs font-semibold text-teal-300"
          >
            管
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-slate-200">管理员</p>
            <p class="truncate text-xs text-slate-500">JWT 已认证</p>
          </div>
          <button
            type="button"
            title="退出登录"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
            @click="handleLogout"
          >
            <LogOut class="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
    <div class="lg:pl-60">
      <header
        class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6"
      >
        <button
          type="button"
          title="打开导航"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 lg:hidden"
          @click="sidebarOpen = true"
        >
          <Menu class="h-4 w-4" />
        </button>
        <h1 class="truncate text-base font-semibold text-slate-900">{{ pageTitle }}</h1>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <span
            class="hidden h-8 items-center rounded-md bg-teal-50 px-2.5 text-xs font-medium text-teal-700 sm:inline-flex"
          >
            管理员
          </span>
          <button
            type="button"
            title="退出登录"
            class="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 lg:hidden"
            @click="handleLogout"
          >
            <LogOut class="h-4 w-4" />
          </button>
        </div>
      </header>
      <main class="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
