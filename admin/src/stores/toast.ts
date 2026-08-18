import { defineStore } from 'pinia';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let nextId = 1;

export const useToastStore = defineStore('toast', {
  state: () => ({
    items: [] as ToastItem[],
  }),
  actions: {
    push(type: ToastType, message: string) {
      const id = nextId++;
      this.items.push({ id, type, message });
      window.setTimeout(() => this.remove(id), 3600);
    },
    remove(id: number) {
      this.items = this.items.filter((item) => item.id !== id);
    },
  },
});
