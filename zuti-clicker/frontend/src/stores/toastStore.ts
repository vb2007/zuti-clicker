import { defineStore } from "pinia";
import { ref } from "vue";

export type ToastKind = "success" | "error" | "booster" | "info";

/** A button on the toast; pressing it runs `run` and dismisses the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

const TOAST_LIFETIME_MS = 4000;
// A toast with a button stays long enough to read it and reach for it.
const ACTION_TOAST_LIFETIME_MS = 10000;

export const useToastStore = defineStore("toast", () => {
  const toasts = ref<ToastEntry[]>([]);
  let uid = 0;

  function push(kind: ToastKind, message: string, action?: ToastAction): number {
    const id = uid++;
    toasts.value.push(action ? { id, kind, message, action } : { id, kind, message });
    setTimeout(() => dismiss(id), action ? ACTION_TOAST_LIFETIME_MS : TOAST_LIFETIME_MS);
    return id;
  }

  function dismiss(id: number) {
    const i = toasts.value.findIndex((toast) => toast.id === id);
    if (i !== -1) toasts.value.splice(i, 1);
  }

  return { toasts, push, dismiss };
});
