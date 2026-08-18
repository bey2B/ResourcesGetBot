import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { title: '登录', public: true },
    },
    { path: '/', redirect: '/dashboard' },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { title: '仪表盘', requiresAuth: true },
    },
    {
      path: '/resources',
      name: 'resources',
      component: () => import('@/views/Resources.vue'),
      meta: { title: '资源管理', requiresAuth: true },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('@/views/Users.vue'),
      meta: { title: '用户管理', requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/Settings.vue'),
      meta: { title: '系统设置', requiresAuth: true },
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('@/views/Logs.vue'),
      meta: { title: '操作日志', requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return '/';
  }
  return true;
});

export default router;
