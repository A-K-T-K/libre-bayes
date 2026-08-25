import { CutRegular, EyeRegular, WrenchRegular } from "@fluentui/react-icons";

import type { AppMode } from "./types";

// Shared between ModeToggle (the toolbar segmented control) and StatusBar
// (a persistent hint for the active mode, since the toggle's own tooltip
// only appears on hover -- easy to never discover).
export const MODES: { value: AppMode; label: string; icon: typeof WrenchRegular; hint: string }[] = [
  { value: "design", label: "Design & Edit", icon: WrenchRegular, hint: "Build structure, edit CPTs, arrange the canvas" },
  { value: "observe", label: "Observation", icon: EyeRegular, hint: "Click a state to pin it as observed evidence — P(Y | X=x)" },
  { value: "intervene", label: "Intervention", icon: CutRegular, hint: "Click a state to do() it — P(Y | do(X=x)), cutting incoming influence" },
];
