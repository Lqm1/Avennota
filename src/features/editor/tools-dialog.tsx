import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField, CommitTextField } from "../../components/ui/field";
import { getFilePlatform } from "../../platform/files";
import { pickDocument, exportDocument } from "../../platform/files/documents";
import { decodeText } from "../oto/encoding";
import { parseOto, serializeOto } from "../oto/oto-set";
import { commentFileName, readComments, writeComments } from "./comments";
import { reopenBookmark, useFolderHistory } from "./folder-history";
import {
  annotateUst,
  complementAliases,
  mergeRows,
  parseUstNotes,
  ustTargets,
} from "./manual-tools";
import { rowFilterStore } from "./row-filter";
import { closeEditorPanel } from "./settings";
import {
  confirmDiscardChanges,
  ask,
  editorStore,
  notify,
  openVoiceFolder,
  runTool,
  transformOtoSet,
  useEditor,
} from "./store";

const action = (handler: () => Promise<void>) => {
  void runTool(handler);
};
const importExtensions = {
  merge: "ini",
  comments: "txt",
  ust: "ust",
  continuous: "ini",
};
export const ToolsDialog = () => {
  const workspace = useEditor((state) => state.workspace);
  const busy = useEditor((state) => state.busy);
  const [annotate, setAnnotate] = useState(true);
  const [filter, setFilter] = useState(false);
  const [ustLimit, setUstLimit] = useState(0);
  const [ustComment, setUstComment] = useState("");
  const [deleteUnused, setDeleteUnused] = useState(false);
  const history = useFolderHistory();

  const importFile = async (
    kind: "merge" | "comments" | "ust" | "continuous"
  ) => {
    const file = await pickDocument([importExtensions[kind]]);
    if (file === null) {
      return;
    }
    if (kind === "ust") {
      const notes = parseUstNotes(decodeText(file.bytes));
      const current = editorStore.state.workspace;
      if (current.kind === "closed") {
        return;
      }
      const targets = ustTargets(
        current.history.present.otoSet,
        notes,
        ustLimit
      );
      if (
        deleteUnused &&
        (await ask({
          title: "USTの対象外行を削除",
          message: `${targets.size}行を残し、使われない原音設定行を削除します。Undoで戻せます。`,
          actions: [
            { id: "delete", label: "対象外行を削除", tone: "danger" },
            { id: "cancel", label: "キャンセル" },
          ],
        })) !== "delete"
      ) {
        return;
      }
      if (editorStore.state.workspace !== current) {
        throw new Error("編集内容が変わりました。再度読み込んでください。");
      }
      transformOtoSet((set) => {
        const annotated = annotate
          ? annotateUst(set, notes, ustComment, ustLimit)
          : set;
        return deleteUnused
          ? {
              ...annotated,
              lines: annotated.lines.filter(
                (line) => line.parsed.kind !== "oto" || targets.has(line.id)
              ),
            }
          : annotated;
      });
      if (filter) {
        rowFilterStore.setState(() => new Set(targets.keys()));
      }
      notify("info", `${notes.length}件のUSTノートを読み込みました。`);
    } else if (kind === "comments") {
      transformOtoSet((set) => readComments(set, file.bytes));
    } else if (kind === "merge") {
      transformOtoSet((set) => mergeRows(set, file.bytes));
    } else {
      const known = new Set(
        parseOto(file.bytes).lines.flatMap((line) =>
          line.parsed.kind === "oto" ? [line.parsed.oto.alias] : []
        )
      );
      transformOtoSet((set) => complementAliases(set, "continuous", known));
    }
  };
  return (
    <EditorDialog title="ファイル・コメント・UST" onClose={closeEditorPanel}>
      <div className="flex flex-col gap-5">
        <fieldset
          className="flex flex-col gap-2"
          disabled={workspace.kind === "closed" || busy !== ""}
        >
          <legend className="mb-2 text-sm text-slate-300">
            ファイル・コメント・UST
          </legend>
          <div className="flex flex-wrap gap-2">
            <Button
              onPress={() => {
                action(async () => {
                  await importFile("merge");
                });
              }}
            >
              iniをマージ
            </Button>
            <Button
              onPress={() => {
                action(async () => {
                  if (workspace.kind === "open") {
                    const result = serializeOto(
                      workspace.history.present.otoSet
                    );
                    if (!result.ok) {
                      throw new Error("保存できない文字があります。");
                    }
                    await exportDocument(
                      workspace.session.otoName,
                      result.bytes
                    );
                  }
                });
              }}
            >
              別の場所へiniを書き出す
            </Button>
            <Button
              onPress={() => {
                action(async () => {
                  await importFile("comments");
                });
              }}
            >
              コメントを読み込む
            </Button>
            <Button
              onPress={() => {
                action(async () => {
                  if (workspace.kind === "open") {
                    await exportDocument(
                      commentFileName(workspace.session.otoName),
                      writeComments(workspace.history.present.otoSet)
                    );
                  }
                });
              }}
            >
              コメントを書き出す
            </Button>
          </div>
          <Check
            label="USTで使われる音にコメントを付ける"
            value={annotate}
            onChange={setAnnotate}
          />
          <Check
            label="USTで使われる音だけ表示する"
            value={filter}
            onChange={setFilter}
          />
          <Check
            label="USTで使われない行を削除する"
            value={deleteUnused}
            onChange={setDeleteUnused}
          />
          <MsField
            label="同じ歌詞の対象行上限（0＝無制限）"
            value={ustLimit}
            swatch={null}
            onCommit={(value) => {
              setUstLimit(Math.max(0, Math.trunc(value)));
            }}
          />
          <CommitTextField
            label="追記するコメント（空欄＝ノート番号）"
            value={ustComment}
            onCommit={setUstComment}
          />
          <div className="flex gap-2">
            <Button
              onPress={() => {
                action(async () => {
                  await importFile("ust");
                });
              }}
            >
              USTを読み込む
            </Button>
            <Button
              onPress={() => {
                rowFilterStore.setState(() => null);
              }}
            >
              絞り込みを解除
            </Button>
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-slate-300">フォルダ</legend>
          {workspace.kind === "open" && isTauri() ? (
            <div className="flex gap-2">
              <Button
                onPress={() => {
                  action(async () => {
                    await workspace.session.folder.openInManager?.();
                  });
                }}
              >
                ファイルマネージャーで開く
              </Button>
              <Button
                onPress={() => {
                  action(async () => {
                    if (!(await confirmDiscardChanges("親フォルダを開く"))) {
                      return;
                    }
                    const parent = await workspace.session.folder.parent?.();
                    if (parent) {
                      await openVoiceFolder(parent, await getFilePlatform());
                      closeEditorPanel();
                    }
                  });
                }}
              >
                親フォルダを開く
              </Button>
            </div>
          ) : null}
          {history.map((entry) => (
            <Button
              key={entry.id}
              onPress={() => {
                action(async () => {
                  if (
                    !(await confirmDiscardChanges("履歴からフォルダを開く"))
                  ) {
                    return;
                  }
                  const folder = await reopenBookmark(entry);
                  if (folder === null) {
                    throw new Error(
                      "このフォルダへのアクセスを再選択してください。"
                    );
                  }
                  await openVoiceFolder(folder, await getFilePlatform());
                  closeEditorPanel();
                });
              }}
            >
              {entry.name}
            </Button>
          ))}
        </fieldset>
      </div>
    </EditorDialog>
  );
};
