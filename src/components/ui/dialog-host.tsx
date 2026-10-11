import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

import type { DialogRequest } from "../../features/editor/store";
import { Button } from "./button";

interface DialogHostProps {
  request: DialogRequest;
}

/** Escapeや外側のクリックは最後の操作（キャンセル）として扱う。 */
export const DialogHost = ({ request }: DialogHostProps) => {
  const cancelId = request.actions.at(-1)?.id ?? "cancel";
  return (
    <ModalOverlay
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      isDismissable
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          request.resolve(cancelId);
        }
      }}
    >
      <Modal className="border-line bg-panel w-[min(32rem,calc(100vw-2rem))] rounded-lg border p-5 shadow-2xl">
        <Dialog className="flex flex-col gap-4 outline-none" role="alertdialog">
          <Heading
            className="text-base font-semibold text-slate-100"
            slot="title"
          >
            {request.title}
          </Heading>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
            {request.message}
          </p>
          <div className="flex justify-end gap-2">
            {request.actions.map((action, index) => (
              <Button
                autoFocus={index === 0}
                key={action.id}
                onPress={() => {
                  request.resolve(action.id);
                }}
                tone={action.tone ?? "default"}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
};
