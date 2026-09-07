import rootPackage from "../package.json" with { type: "json" };

declare const __SUPERREVIEW_VERSION__: string | undefined;

export const version =
  typeof __SUPERREVIEW_VERSION__ === "undefined" ? rootPackage.version : __SUPERREVIEW_VERSION__;
