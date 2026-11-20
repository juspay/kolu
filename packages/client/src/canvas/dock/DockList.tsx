import { DockRow as DockRowView, DockSection } from "@kolu/solid-dockrow";
import type { DockRowBucket } from "@kolu/solid-dockrow/rowValues";
import { AttentionTriplet } from "@kolu/solid-statepip";
import type { TerminalId } from "kolu-common/surface";
import { Show } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import RepoMonogram from "../../ui/RepoMonogram";
import { useDockRowBag } from "./useDockRowBag";
import { createDockRowData } from "./dockRowData";
import type { DockGroup } from "./dockTree";
import { HiddenFooter } from "./HiddenFooter";
import { NeedsYouStrip } from "./NeedsYouStrip";
import { SubTerminalRow } from "./SubTerminalRow";
import { useDockOrder } from "./useDockOrder";
import { useSectionAttention } from "./useSectionAttention";

export function DockList(props: { onSelect: (id: TerminalId) => void }) {
  const tree = useDockOrder();
  return (
    <>
      <div class="px-3 py-2 border-b border-edge/50 shrink-0">
        <span class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-3">
          Terminals
        </span>
      </div>
      <NeedsYouStrip
        entries={tree().needsYou}
        density="full"
        onSelect={props.onSelect}
      />
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2.5 p-2">
          <Key each={tree().groups} by="name">
            {(group) => (
              <DockListSection group={group()} onSelect={props.onSelect} />
            )}
          </Key>
        </div>
      </div>
      <HiddenFooter
        hiddenCount={tree().hiddenCount}
        sleepingCount={tree().sleepingCount}
        surface="touch"
      />
    </>
  );
}

function DockListSection(props: {
  group: DockGroup;
  onSelect: (id: TerminalId) => void;
}) {
  const attn = useSectionAttention(() => props.group);
  return (
    <DockSection
      surface="touch"
      testId="mobile-dock-section"
      repo={props.group.name}
      repoColor={props.group.color}
      headerTestId="mobile-dock-section-header"
      header={
        <>
          <RepoMonogram
            group={props.group.name}
            color={props.group.color}
            data-testid="mobile-dock-section-monogram"
          />
          <span
            data-testid="mobile-dock-section-name"
            class="dock-cards-section-name font-mono text-[0.7rem] font-extrabold uppercase tracking-[0.1em] truncate min-w-0"
          >
            {props.group.name}
          </span>
          <span
            class="dock-cards-section-count font-mono text-[0.6rem]"
            title={`${props.group.railEntries.length} terminals`}
          >
            {props.group.railEntries.length}
          </span>
          <AttentionTriplet
            active={attn().activeIds.length}
            asking={attn().askingIds.length}
            unseen={attn().unseenIds.length}
            sizeClass="min-w-4 px-1 h-4"
            scopeLabel={props.group.name}
            class="ml-auto"
          />
        </>
      }
    >
      <Key each={props.group.topRows} by="id">
        {(row) => (
          <>
            <DockListRow
              id={row().id}
              bucket={row().bucket}
              pip={row().pip}
              recencyAt={row().ts}
              onSelect={props.onSelect}
            />
            <Key each={row().subRows} by="id">
              {(sub) => (
                <SubTerminalRow
                  row={sub()}
                  tileId={row().id}
                  surface="touch"
                  onSelect={props.onSelect}
                />
              )}
            </Key>
          </>
        )}
      </Key>
    </DockSection>
  );
}

function DockListRow(props: {
  id: TerminalId;
  bucket: DockRowBucket;
  pip: DockRowBucket;
  recencyAt: number | null;
  onSelect: (id: TerminalId) => void;
}) {
  const combined = createDockRowData(props.id);
  const rowBag = useDockRowBag();
  return (
    <Show when={combined()}>
      {(c) => {
        const bag = rowBag({
          id: props.id,
          combined: c,
          bucket: () => props.bucket,
          pipBucket: () => props.pip,
          recencyAt: () => props.recencyAt,
        });
        return (
          <DockRowView
            {...bag}
            surface="touch"
            onSelect={() => props.onSelect(props.id)}
            onPointerDown={(event) => event.stopPropagation()}
            testIds={{
              row: "mobile-dock-row",
              agentSubline: "mobile-dock-agent-subline",
              quietSubline: "mobile-dock-foreground",
            }}
          />
        );
      }}
    </Show>
  );
}
