import { useState } from "react";

import { clampSidebarWidth, type ResizeBounds } from "@/components/review/sidebar-resizer";

const FILE_SIDEBAR_INITIAL_WIDTH_PX = 246;
const FILE_SIDEBAR_MIN_WIDTH_PX = 200;
const FILE_SIDEBAR_MAX_WIDTH_PX = 400;
const COMMENT_SIDEBAR_INITIAL_WIDTH_PX = 300;
const COMMENT_SIDEBAR_MIN_WIDTH_PX = 260;
const COMMENT_SIDEBAR_MAX_WIDTH_PX = 440;
const REVIEW_AREA_MIN_WIDTH_PX = 420;
const DESKTOP_COMMENTS_BREAKPOINT_PX = 1024;

export function useSidebarLayout(viewportWidth: number, commentsOpen: boolean) {
  const [fileWidth, setFileWidth] = useState(FILE_SIDEBAR_INITIAL_WIDTH_PX);
  const [commentWidth, setCommentWidth] = useState(COMMENT_SIDEBAR_INITIAL_WIDTH_PX);
  const commentsVisible = viewportWidth >= DESKTOP_COMMENTS_BREAKPOINT_PX && commentsOpen;

  const fileBounds: ResizeBounds = {
    min: FILE_SIDEBAR_MIN_WIDTH_PX,
    max: Math.max(
      FILE_SIDEBAR_MIN_WIDTH_PX,
      Math.min(
        FILE_SIDEBAR_MAX_WIDTH_PX,
        viewportWidth - (commentsVisible ? commentWidth : 0) - REVIEW_AREA_MIN_WIDTH_PX,
      ),
    ),
  };
  const visibleFileWidth = clampSidebarWidth(fileWidth, fileBounds);
  const commentBounds: ResizeBounds = {
    min: COMMENT_SIDEBAR_MIN_WIDTH_PX,
    max: Math.max(
      COMMENT_SIDEBAR_MIN_WIDTH_PX,
      Math.min(
        COMMENT_SIDEBAR_MAX_WIDTH_PX,
        viewportWidth - visibleFileWidth - REVIEW_AREA_MIN_WIDTH_PX,
      ),
    ),
  };

  return {
    commentsVisible,
    file: {
      width: visibleFileWidth,
      bounds: fileBounds,
      resize: setFileWidth,
    },
    comments: {
      width: clampSidebarWidth(commentWidth, commentBounds),
      bounds: commentBounds,
      resize: setCommentWidth,
    },
  };
}
