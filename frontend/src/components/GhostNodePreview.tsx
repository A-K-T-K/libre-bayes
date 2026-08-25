import { makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { NodeProps } from "@xyflow/react";

const useStyles = makeStyles({
  ghost: {
    boxSizing: "border-box",
    borderRadius: "999px",
    ...shorthands.border("2px", "dashed", tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
    opacity: 0.6,
    pointerEvents: "none",
  },
});

export function GhostNodePreview({ data }: NodeProps) {
  const styles = useStyles();
  const { width, height } = data as { width: number; height: number };
  return <div className={styles.ghost} style={{ width, height }} />;
}
