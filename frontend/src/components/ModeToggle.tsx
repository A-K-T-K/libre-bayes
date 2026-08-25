import { Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { CutRegular, EyeRegular, WrenchRegular } from "@fluentui/react-icons";

import { useNetworkStore } from "../store/useNetworkStore";
import type { AppMode } from "../lib/types";

const MODES: { value: AppMode; label: string; icon: typeof WrenchRegular; hint: string }[] = [
  { value: "design", label: "Design & Edit", icon: WrenchRegular, hint: "Build structure, edit CPTs, arrange the canvas" },
  { value: "observe", label: "Observation", icon: EyeRegular, hint: "Click a state to pin it as observed evidence — P(Y | X=x)" },
  { value: "intervene", label: "Intervention", icon: CutRegular, hint: "Click a state to do() it — P(Y | do(X=x)), cutting incoming influence" },
];

const useStyles = makeStyles({
  group: {
    display: "flex",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: "hidden",
  },
  segment: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground1,
    border: "none",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    transition: "background-color 0.15s ease, color 0.15s ease",
    ":last-child": {
      borderRight: "none",
    },
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  segmentActiveDesign: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
  },
  segmentActiveObserve: {
    backgroundColor: tokens.colorPaletteMarigoldBackground2,
    color: tokens.colorPaletteMarigoldForeground2,
  },
  segmentActiveIntervene: {
    backgroundColor: tokens.colorPaletteGrapeBackground2,
    color: tokens.colorPaletteGrapeForeground2,
  },
});

const ACTIVE_STYLE_KEY: Record<AppMode, "segmentActiveDesign" | "segmentActiveObserve" | "segmentActiveIntervene"> = {
  design: "segmentActiveDesign",
  observe: "segmentActiveObserve",
  intervene: "segmentActiveIntervene",
};

/** Global 3-way operational mode: what clicking a node/state means changes
 * with it across the canvas, sidebars, and context menus. */
export function ModeToggle() {
  const styles = useStyles();
  const mode = useNetworkStore((s) => s.mode);
  const setMode = useNetworkStore((s) => s.setMode);

  return (
    <div className={styles.group} role="radiogroup" aria-label="Operational mode">
      {MODES.map(({ value, label, icon: Icon, hint }) => (
        <Tooltip key={value} content={hint} relationship="label">
          <button
            type="button"
            role="radio"
            aria-checked={mode === value}
            className={mergeClasses(styles.segment, mode === value && styles[ACTIVE_STYLE_KEY[value]])}
            onClick={() => setMode(value)}
          >
            <Icon fontSize={14} />
            {label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
