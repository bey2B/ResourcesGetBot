# admin/ Vue 3 管理后台

Cua 超级助手 Telegram Bot 的 Web 管理后台，技术栈为 Vue 3 + TypeScript + Vite + Vue Router + Pinia + Tailwind CSS + lucide-vue-next。

## 功能

- 管理员密码登录（JWT，token 持久化到 localStorage，401 自动跳转登录）
- 仪表盘：总用户 / 今日下载 / 资源数 / 广播数、近 7 日趋势、24 小时下载热力图、积分循环
- 资源管理：搜索、排序、分页、新增 / 编辑 / 删除
- 用户管理：搜索、分页、调整积分、封禁 / 解封
- 系统设置：强制关注、绑定频道、群组回复、自动删除、风控限流、消息块显示、广告配置
- 操作日志：分页查看

## 本地开发

```bash
npm install
npm run dev
```

开发服务器默认 `http://127.0.0.1:5173`，`/api` 请求代理到 `http://127.0.0.1:8787`（`wrangler dev`）。

如需覆盖 API 地址，创建 `admin/.env.local`：

```text
VITE_API_BASE=http://127.0.0.1:8787/api/admin
```

## 构建

```bash
npm run build
npm run preview
```

`build` 会先执行 `vue-tsc --noEmit` 类型检查，再执行 Vite 构建，产物输出到 `admin/dist/`。

## API 约定

- Base：`/api/admin`，JSON
- 除 `POST /api/admin/login` 外，均需请求头 `Authorization: Bearer <token>`
- 列表接口返回 `{ items, total }`，支持 `page`、`pageSize`、`q`
- 资源列表额外支持 `sort`、`order`（`asc` / `desc`）

## 目录结构

```text
admin/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── src/
    ├── api/          # fetch 封装与前端 TS 类型
    ├── components/   # shadcn/ui 风格基础组件
    ├── router/       # 登录页与受保护路由
    ├── stores/       # auth / toast
    ├── utils/        # 格式化工具
    └── views/        # Login / Dashboard / Resources / Users / Settings / Logs
```
