import { cn } from "cn";
import { X } from "lucide-react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

import { Button } from "./button";

export const EditorDialog = ({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  /** 本文の幅を変える場合に指定する。 */
  className?: string;
}) => (
  <ModalOverlay
    isOpen
    isDismissable
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
  >
    <Modal
      className={cn(
        "border-line bg-panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border shadow-2xl",
        className
      )}
    >
      <Dialog className="flex min-h-0 flex-col outline-none">
        <div className="border-line flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3">
          <Heading
            slot="title"
            className="text-sm font-semibold text-slate-100"
          >
            {title}
          </Heading>
          <Button aria-label="閉じる" onPress={onClose} tone="ghost">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 overflow-auto px-5 pt-4 pb-5">{children}</div>
      </Dialog>
    </Modal>
  </ModalOverlay>
);
