<script setup lang="ts">
import Modal from './Modal.vue';
import Button from './Button.vue';

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description: string;
    confirmText?: string;
    loading?: boolean;
  }>(),
  {
    confirmText: '确认删除',
    loading: false,
  },
);

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
  <Modal :open="open" :title="title" width="sm" @close="emit('close')">
    <p class="text-sm leading-6 text-slate-600">{{ description }}</p>
    <template #footer>
      <Button variant="outline" @click="emit('close')">取消</Button>
      <Button variant="destructive" :loading="loading" @click="emit('confirm')">
        {{ confirmText }}
      </Button>
    </template>
  </Modal>
</template>
