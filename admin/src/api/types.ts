export interface LoginResponse {
  token: string;
  expiresAt?: string;
}

export interface User {
  user_id: number;
  username: string | null;
  first_name: string | null;
  points: number;
  invited_by: number | null;
  is_banned: number;
  created_at: string;
  last_active: string | null;
}

export interface Resource {
  id: number;
  short_code: string;
  file_id: string;
  file_unique_id: string | null;
  file_ids: string;
  title: string;
  tags: string;
  is_paid: number;
  price: number;
  sequence: number;
  download_count: number;
  creator_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface AdminLog {
  id: number;
  admin_id: number;
  action: string;
  detail: string;
  created_at: string;
}

export interface Ad {
  id: number;
  position: 'top' | 'bottom';
  content: string;
  weight: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface PointsLog {
  id: number;
  user_id: number;
  change: number;
  balance_after: number;
  reason: string;
  related_id: number | null;
  created_at: string;
}

export interface DownloadRecord {
  id: number;
  user_id: number;
  resource_id: number;
  created_at: string;
  title: string;
  short_code: string;
  username: string | null;
}

export interface UserStats {
  download_count: number;
  checkin_count: number;
  invite_count: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface DashboardTotals {
  users: number;
  downloadsToday: number;
  resources: number;
  broadcasts: number;
}

export interface Trends7d {
  dates: string[];
  newUsers: number[];
  activeUsers: number[];
  downloads: number[];
}

export interface Trends30d {
  dates: string[];
  newUsers: number[];
  activeUsers: number[];
  downloads: number[];
}

export interface HeatmapEntry {
  hour: number;
  downloads: number;
}

export interface PointsCycle {
  totalEarned: number;
  totalSpent: number;
  todayCheckins: number;
  invites: number;
}

export interface DashboardData {
  totals: DashboardTotals;
  trends7d: Trends7d;
  trends30d: Trends30d;
  heatmap24: HeatmapEntry[];
  pointsCycle: PointsCycle;
}

export interface ResourcePayload {
  fileId?: string;
  fileIds?: string[];
  title?: string;
  tags?: string;
  isPaid?: boolean;
  price?: number;
}

export interface AdPayload {
  position: 'top' | 'bottom';
  content: string;
  weight: number;
  enabled: boolean;
}
