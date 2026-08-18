<template>
  <div class="overflow-x-auto">
    <table class="w-full min-w-[760px] border-collapse text-left text-sm">
      <thead>
        <tr class="border-b border-slate-200 bg-slate-50">
          <slot name="head" />
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        <slot />
      </tbody>
    </table>
  </div>
</template>
