import {
  AlignBottomRegular,
  AlignCenterHorizontalRegular,
  AlignCenterVerticalRegular,
  AlignLeftRegular,
  AlignRightRegular,
  AlignTopRegular,
  AlignSpaceEvenlyHorizontalRegular,
  AlignSpaceEvenlyVerticalRegular,
  ResizeRegular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";

import type { AlignMode, DistributeAxis } from "../store/useNetworkStore";

export interface AlignmentAction {
  key: string;
  label: string;
  icon: FluentIcon;
  minSelected: number;
  run: (helpers: {
    alignNodes: (mode: AlignMode) => void;
    distributeNodes: (axis: DistributeAxis) => void;
    equalizeSize: () => void;
  }) => void;
}

/** Shared definitions for both the floating multi-select toolbar and the
 * canvas right-click context menu, so the two surfaces can never drift out
 * of sync with each other. */
export const ALIGNMENT_ACTIONS: AlignmentAction[] = [
  {
    key: "align-left",
    label: "Align Left",
    icon: AlignLeftRegular,
    minSelected: 2,
    run: ({ alignNodes }) => alignNodes("left"),
  },
  {
    key: "align-center-x",
    label: "Align Vertically (Centers)",
    icon: AlignCenterVerticalRegular,
    minSelected: 2,
    run: ({ alignNodes }) => alignNodes("centerX"),
  },
  {
    key: "align-right",
    label: "Align Right",
    icon: AlignRightRegular,
    minSelected: 2,
    run: ({ alignNodes }) => alignNodes("right"),
  },
  {
    key: "align-top",
    label: "Align Top",
    icon: AlignTopRegular,
    minSelected: 2,
    run: ({ alignNodes }) => alignNodes("top"),
  },
  {
    key: "align-center-y",
    label: "Align Horizontally (Centers)",
    icon: AlignCenterHorizontalRegular,
    minSelected: 2,
    run: ({ alignNodes }) => alignNodes("centerY"),
  },
  {
    key: "align-bottom",
    label: "Align Bottom",
    icon: AlignBottomRegular,
    minSelected: 2,
    run: ({ alignNodes }) => alignNodes("bottom"),
  },
  {
    key: "distribute-horizontal",
    label: "Distribute Horizontally",
    icon: AlignSpaceEvenlyHorizontalRegular,
    minSelected: 3,
    run: ({ distributeNodes }) => distributeNodes("horizontal"),
  },
  {
    key: "distribute-vertical",
    label: "Distribute Vertically",
    icon: AlignSpaceEvenlyVerticalRegular,
    minSelected: 3,
    run: ({ distributeNodes }) => distributeNodes("vertical"),
  },
  {
    key: "equalize-size",
    label: "Make Equal Size",
    icon: ResizeRegular,
    minSelected: 2,
    run: ({ equalizeSize }) => equalizeSize(),
  },
];
