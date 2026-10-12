import { useSelector } from "@tanstack/react-store";
import { cn } from "cn";
import { PanelRightClose, PanelRightOpen, TriangleAlert } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";

import { DialogHost } from "../../components/ui/dialog-host";
import { SelectField } from "../../components/ui/field";
import { ToolButton } from "../../components/ui/tool-button";
import { durationStore, EMPTY_DURATIONS } from "../audio/wav-cache";
import { WavePlaceholder, WaveView } from "../audio/wave-view";
import type { OtoEncoding } from "../oto/encoding";
import { ENCODING_LABELS } from "../oto/encoding";
import { AlignmentDialog } from "./alignment-dialog";
import { BulkDialog, AliasDialog } from "./bulk-dialog";
import { FileDialog } from "./file-dialog";
import { AddLine, Inspector } from "./inspector";
import { OtoTable } from "./oto-table";
import { RecentFoldersDialog } from "./recent-folders-dialog";
import { buildRows, rowMatches } from "./rows";
import type { ParsedOtoRow } from "./rows";
import { editorPanelStore, showEditorPanel, useSettings } from "./settings";
import { SettingsDialog } from "./settings-dialog";
import { StartScreen } from "./start-screen";
import {
  addLinesForUnlistedWavs,
  notify,
  select,
  selectIsDirty,
  setEncoding,
  useEditor,
} from "./store";
import type { OpenWorkspace, EditorState } from "./store";
import { Toolbar } from "./toolbar";
import { ToolsDialog } from "./tools-dialog";
import { useDesktopFeatures } from "./use-desktop-features";
import { useEditorShortcuts, useGlobalShortcuts } from "./use-editor-shortcuts";
import { useMediaQuery } from "./use-media-query";
import { useSessionGuards } from "./use-session-guards";
import { ustFilterStore } from "./ust-filter";
import { ViewDialog } from "./view-dialog";
import { WavCutDialog } from "./wav-cut-dialog";
import { WaveToolbar } from "./wave-toolbar";

const encodings: OtoEncoding[] = ["shift_jis", "utf-8"];
const encodingOptions = encodings.map((id) => ({
  id,
  label: ENCODING_LABELS[id],
}));

const NARROW_QUERY = "(max-width: 899px)";
const INSPECTOR_RAIL = 36;

const separatorClass =
  "relative bg-line outline-none transition-colors data-[separator=hover]:bg-accent/60 data-[separator=active]:bg-accent focus-visible:bg-accent";

const EmptyList = ({
  wavCount,
  onCreate,
}: {
  wavCount: number;
  onCreate: () => void;
}) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-400">
    <p>原音設定行がありません。</p>
    {wavCount > 0 ? (
      <button
        className="bg-accent rounded px-4 py-2 text-xs font-medium text-slate-950 hover:brightness-110"
        onClick={onCreate}
        type="button"
      >
        フォルダ内の{wavCount}件のWAVから初期行を作成
      </button>
    ) : (
      <p className="text-xs">このフォルダにはWAVがありません。</p>
    )}
    <p className="text-[11px] text-slate-500">
      初期行の値は0です。自動推定の結果ではありません。
    </p>
  </div>
);

const EncodingStatus = ({ workspace }: { workspace: OpenWorkspace }) => {
  const { encoding, encodingCertainty: certainty } =
    workspace.history.present.otoSet;
  const uncertain = certainty === "ambiguous" || certainty === "invalid";
  return (
    <div className="flex shrink-0 items-center gap-1">
      {uncertain ? (
        <span
          className="flex items-center gap-1 text-amber-300"
          title="ASCIIのみ、または判定できない内容です。必要なら切り替えてください。"
        >
          <TriangleAlert className="size-3.5" />
          <span className="sr-only @3xl:not-sr-only">
            {certainty === "ambiguous" ? "文字コード推定" : "文字コード不明"}
          </span>
        </span>
      ) : null}
      <SelectField
        className="w-24"
        hideLabel
        label="文字コード"
        onChange={setEncoding}
        options={encodingOptions}
        triggerClassName={cn(
          "h-5 border-transparent bg-transparent px-1.5 text-[11px] text-slate-300 hover:bg-white/10",
          uncertain && "text-amber-300"
        )}
        value={encoding}
      />
    </div>
  );
};

const StatusBar = () => {
  const busy = useEditor((state) => state.busy);
  const workspace = useEditor((state) => state.workspace);
  const dirty = useEditor(selectIsDirty);
  const notice = useEditor((state) => state.notice);
  const recoveryError = useEditor((state) => state.recoveryError);
  const location =
    workspace.kind === "open"
      ? `${workspace.session.folder.name} / ${workspace.session.otoName}${
          workspace.session.baseline === null ? "（新規）" : ""
        }`
      : "";

  return (
    <footer className="border-line bg-panel @container flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-slate-400">
      {workspace.kind === "open" ? (
        <span
          className="min-w-12 shrink-[3] truncate text-slate-300"
          title={location}
        >
          {location}
        </span>
      ) : null}
      {workspace.kind === "open" ? (
        <span
          className={cn(
            "shrink-0",
            dirty ? "font-semibold text-amber-300" : "text-slate-500"
          )}
        >
          {dirty ? "● 未保存" : "保存済み"}
        </span>
      ) : null}
      {workspace.kind === "open" ? (
        <span className="hidden shrink-0 text-slate-500 tabular-nums @2xl:inline">
          {workspace.history.present.otoSet.lines.length}行
        </span>
      ) : null}
      {busy === "" ? null : (
        <span className="text-accent shrink-0">{busy}…</span>
      )}
      {recoveryError === "" ? null : (
        <span className="min-w-0 truncate text-red-300" title={recoveryError}>
          {recoveryError}
        </span>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-3">
        {notice ? (
          <span
            className={cn(
              "min-w-0 truncate",
              notice.tone === "error" && "text-red-300",
              notice.tone === "warning" && "text-amber-300",
              notice.tone === "info" && "text-slate-300"
            )}
            role={notice.tone === "error" ? "alert" : "status"}
            title={notice.text}
          >
            {notice.text}
          </span>
        ) : null}
        {workspace.kind === "open" ? (
          <EncodingStatus workspace={workspace} />
        ) : null}
      </div>
    </footer>
  );
};

const SelectedWave = ({
  row,
  session,
  linked,
}: {
  row: ParsedOtoRow;
  session: OpenWorkspace["session"];
  linked: EditorState["linked"];
}) => {
  const { oto } = row.line.parsed;
  const wav = session.wavs.get(oto.wav.toLowerCase());
  return wav === undefined ? (
    <WavePlaceholder
      message={`${oto.wav}がこのフォルダにありません。行は削除せずに保持します。`}
    />
  ) : (
    <WaveView
      key={wav}
      folder={session.folder}
      wav={wav}
      line={row.line}
      linked={linked}
    />
  );
};

const OpenedEditor = ({ workspace }: { workspace: OpenWorkspace }) => {
  const { session } = workspace;
  const { otoSet, selectedId } = workspace.history.present;
  const linked = useEditor((state) => state.linked);
  const durations = useSelector(
    durationStore,
    (state) => state.get(session.folder) ?? EMPTY_DURATIONS
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => buildRows(otoSet, session.wavs, durations),
    [otoSet, session.wavs, durations]
  );
  const filter = useSelector(ustFilterStore, (state) => state);
  const tableRows = useDeferredValue(
    filter === null
      ? rows
      : rows.filter((row) => row.kind === "oto" && filter.has(row.id))
  );
  const selectedRow = rows.find((row) => row.id === selectedId);
  const selectedWav =
    selectedRow?.kind === "oto" ? selectedRow.line.parsed.oto.wav : "";
  const wavNames = useMemo(
    () =>
      [...session.wavs.values()].toSorted((a, b) => a.localeCompare(b, "ja")),
    [session.wavs]
  );
  const unlistedCount = useMemo(() => {
    const listed = new Set(
      rows.flatMap((row) =>
        row.kind === "oto" ? [row.line.parsed.oto.wav.toLowerCase()] : []
      )
    );
    return wavNames.filter((name) => !listed.has(name.toLowerCase())).length;
  }, [rows, wavNames]);
  const findNext = (direction: 1 | -1) => {
    if (query.trim() === "" || rows.length === 0) {
      return;
    }
    const start = rows.findIndex((row) => row.id === selectedId);
    for (let step = 1; step <= rows.length; step += 1) {
      const row =
        rows[(start + direction * step + rows.length * 2) % rows.length];
      if (row && rowMatches(row, query)) {
        select(row.id);
        return;
      }
    }
    notify("info", `「${query}」に一致する行はありません。`);
  };
  useEditorShortcuts({
    findNext,
    focusSearch: () => searchRef.current?.focus(),
  });
  const inspectorRef = usePanelRef();
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const narrow = useMediaQuery(NARROW_QUERY);
  const autoCollapsed = useRef(false);
  // 狭くなったら畳み、広くなったら自動で畳んだときだけ戻す。利用者が開閉した状態は上書きしない。
  useEffect(() => {
    const panel = inspectorRef.current;
    if (panel === null) {
      return;
    }
    if (narrow && !panel.isCollapsed()) {
      autoCollapsed.current = true;
      panel.collapse();
    } else if (!narrow && autoCollapsed.current) {
      autoCollapsed.current = false;
      panel.expand();
    }
  }, [narrow, inspectorRef]);
  let wave: React.ReactNode;
  if (selectedRow === undefined) {
    wave = (
      <WavePlaceholder
        message={
          rows.length === 0
            ? "原音設定行がありません。"
            : "行を選んでください。"
        }
      />
    );
  } else if (selectedRow.kind === "unparsed") {
    wave = (
      <WavePlaceholder message="この行は原音設定行として解釈できません。" />
    );
  } else {
    wave = <SelectedWave row={selectedRow} session={session} linked={linked} />;
  }
  return (
    <>
      <Toolbar
        workspace={workspace}
        query={query}
        onQueryChange={setQuery}
        onSearch={() => {
          findNext(1);
        }}
        searchRef={searchRef}
        unlistedCount={unlistedCount}
        onAddUnlisted={() => {
          const added = addLinesForUnlistedWavs();
          notify(
            "info",
            `${added}件の初期行を追加しました（値は0。自動推定ではありません）。`
          );
        }}
      />
      <Group className="min-h-0 flex-1" orientation="vertical">
        <Panel defaultSize="55%" minSize={190}>
          <div className="flex h-full min-h-0 flex-col">
            <WaveToolbar />
            <div className="min-h-0 flex-1">{wave}</div>
          </div>
        </Panel>
        <Separator className={cn(separatorClass, "h-1")} />
        <Panel defaultSize="45%" minSize={120}>
          <Group orientation="horizontal">
            <Panel defaultSize="70%" minSize={240}>
              {rows.length === 0 ? (
                <EmptyList
                  wavCount={wavNames.length}
                  onCreate={() => {
                    addLinesForUnlistedWavs();
                  }}
                />
              ) : (
                <OtoTable rows={tableRows} selectedId={selectedId} />
              )}
            </Panel>
            <Separator className={cn(separatorClass, "w-1")} />
            <Panel
              collapsedSize={INSPECTOR_RAIL}
              collapsible
              defaultSize="30%"
              minSize={260}
              onResize={() => {
                setInspectorCollapsed(
                  inspectorRef.current?.isCollapsed() ?? false
                );
              }}
              panelRef={inspectorRef}
            >
              {inspectorCollapsed ? (
                <div className="flex h-full flex-col items-center py-1">
                  <ToolButton
                    icon={PanelRightOpen}
                    iconOnly
                    label="詳細欄を開く"
                    onPress={() => {
                      autoCollapsed.current = false;
                      inspectorRef.current?.expand();
                    }}
                  />
                  <span className="mt-2 text-[11px] text-slate-500 [writing-mode:vertical-rl]">
                    詳細
                  </span>
                </div>
              ) : (
                <div className="@container flex h-full min-h-0 flex-col">
                  <div className="border-line flex h-8 shrink-0 items-center gap-2 border-b pr-1 pl-3">
                    <h2
                      className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200"
                      title={selectedWav}
                    >
                      {selectedWav === "" ? "詳細" : selectedWav}
                    </h2>
                    {selectedRow === undefined ? null : (
                      <span className="shrink-0 text-[11px] text-slate-500">
                        {selectedRow.lineNumber}行目
                      </span>
                    )}
                    <ToolButton
                      icon={PanelRightClose}
                      iconOnly
                      label="詳細欄を畳む"
                      onPress={() => {
                        autoCollapsed.current = false;
                        inspectorRef.current?.collapse();
                      }}
                    />
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
                    {selectedRow === undefined ? (
                      <p className="text-xs text-slate-500">
                        一覧から原音設定行を選んでください。
                      </p>
                    ) : (
                      <Inspector row={selectedRow} folder={session.folder} />
                    )}
                  </div>
                  <AddLine wavNames={wavNames} />
                </div>
              )}
            </Panel>
          </Group>
        </Panel>
      </Group>
    </>
  );
};

export const EditorScreen = () => {
  const settings = useSettings();
  useDesktopFeatures();
  const workspace = useEditor((state) => state.workspace);
  const dialog = useEditor((state) => state.dialog);
  const panel = useSelector(editorPanelStore, (state) => state);
  useSessionGuards();
  useGlobalShortcuts();
  return (
    <div
      className="flex h-full flex-col"
      style={{
        fontFamily: settings.advanced.fontFamily,
        fontSize: settings.advanced.fontSize,
      }}
    >
      {workspace.kind === "closed" ? (
        <div className="min-h-0 flex-1">
          <StartScreen />
        </div>
      ) : (
        <OpenedEditor
          workspace={workspace}
          key={workspace.session.folder.name}
        />
      )}
      <StatusBar />
      {dialog === null ? null : <DialogHost request={dialog} />}
      {panel === "settings" ||
      panel === "timingSettings" ||
      panel === "playRangeSettings" ||
      panel === "focusSettings" ||
      panel === "nextSettings" ? (
        <SettingsDialog key={panel} mode={panel} />
      ) : null}
      {panel === "bulk" ? <BulkDialog /> : null}
      {panel === "alias" ? <AliasDialog /> : null}
      {panel === "fileOpen" ? <FileDialog mode="open" /> : null}
      {panel === "fileSave" ? <FileDialog mode="save" /> : null}
      {panel === "tools" ? <ToolsDialog /> : null}
      {panel === "alignment" ? <AlignmentDialog /> : null}
      {panel === "recentFolders" ? (
        <RecentFoldersDialog
          onClose={() => {
            showEditorPanel(null);
          }}
        />
      ) : null}
      {panel === "bpm" || panel === "opacity" ? (
        <ViewDialog mode={panel} />
      ) : null}
      {panel === "wavCut" ? <WavCutDialog /> : null}
    </div>
  );
};
