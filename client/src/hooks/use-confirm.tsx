import { useState } from "react";
import { ConfirmModal } from "@/components/confirm-modal";

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive" | "warning";
  onConfirm: () => void | Promise<void>;
}

export function useConfirm() {
  const [modalState, setModalState] = useState<{
    open: boolean;
    options: ConfirmOptions | null;
  }>({
    open: false,
    options: null,
  });

  const confirm = (options: ConfirmOptions) => {
    setModalState({
      open: true,
      options,
    });
  };

  const handleOpenChange = (open: boolean) => {
    setModalState((prev) => ({ ...prev, open }));
  };

  const ConfirmDialogComponent = modalState.options ? (
    <ConfirmModal
      open={modalState.open}
      onOpenChange={handleOpenChange}
      title={modalState.options.title}
      description={modalState.options.description}
      confirmText={modalState.options.confirmText || "Đồng ý"}
      cancelText={modalState.options.cancelText || "Hủy bỏ"}
      variant={modalState.options.variant || "default"}
      onConfirm={modalState.options.onConfirm}
    />
  ) : null;

  return { confirm, ConfirmDialogComponent };
}
