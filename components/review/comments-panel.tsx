import type { Anchor } from "@/lib/comments/model";
import { CommentOverview, MobileComposer } from "@/components/review/comments";
import { SidebarResizer, type ResizeBounds } from "@/components/review/sidebar-resizer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function CommentsPanel({
  selected,
  sidebarVisible,
  drawerOpen,
  mobileComposer,
  width,
  resizeBounds,
  onJump,
  onCloseSidebar,
  onDrawerChange,
  onResize,
}: {
  selected: number;
  sidebarVisible: boolean;
  drawerOpen: boolean;
  mobileComposer: boolean;
  width: number;
  resizeBounds: ResizeBounds;
  onJump: (anchor: Anchor) => void;
  onCloseSidebar: () => void;
  onDrawerChange: (open: boolean) => void;
  onResize: (width: number) => void;
}) {
  return (
    <>
      {sidebarVisible && (
        <aside
          id="comments-sidebar"
          className="comments-sidebar"
          style={{ width }}
          aria-label="Comments overview"
        >
          <SidebarResizer
            controls="comments-sidebar"
            label="Resize comments sidebar"
            value={width}
            bounds={resizeBounds}
            growDirection={-1}
            onChange={onResize}
          />
          <CommentOverview selected={selected} onJump={onJump} onClose={onCloseSidebar} />
        </aside>
      )}
      <Sheet open={drawerOpen} onOpenChange={onDrawerChange}>
        <SheetContent side="right" className="comments-sheet" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Comments</SheetTitle>
            <SheetDescription>Browse comments across all changed files.</SheetDescription>
          </SheetHeader>
          <CommentOverview
            selected={selected}
            onJump={onJump}
            onClose={() => onDrawerChange(false)}
          />
        </SheetContent>
      </Sheet>
      <MobileComposer mobile={mobileComposer} />
    </>
  );
}
