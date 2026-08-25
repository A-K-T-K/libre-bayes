import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Dismiss12Regular, Square12Regular, SquareMultipleRegular, Subtract12Regular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";

import { useNetworkStore } from "../store/useNetworkStore";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "32px",
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    userSelect: "none",
  },
  drag: {
    flex: 1,
    height: "100%",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingLeft: "12px",
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
  },
  controls: {
    display: "flex",
    height: "100%",
  },
  controlButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "44px",
    height: "100%",
    border: "none",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground4,
    },
  },
  closeButton: {
    "&:hover": {
      backgroundColor: "#c42b1c",
      color: "#ffffff",
    },
  },
});

export function TitleBar() {
  const styles = useStyles();
  const projectName = useNetworkStore((s) => s.projectName);
  const windowTitle = `LibRE Bayes - ${projectName}`;
  const [isMaximized, setIsMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<Awaited<
    ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>
  > | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      setAppWindow(win);
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    void appWindow?.setTitle(windowTitle);
  }, [appWindow, windowTitle]);

  if (!isTauri) {
    return (
      <div className={styles.bar}>
        <div className={styles.drag}>{windowTitle}</div>
      </div>
    );
  }

  return (
    <div className={styles.bar} data-tauri-drag-region>
      <div className={styles.drag} data-tauri-drag-region>
        {windowTitle}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          aria-label="Minimize"
          onClick={() => appWindow?.minimize()}
        >
          <Subtract12Regular />
        </button>
        <button
          type="button"
          className={styles.controlButton}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={() => appWindow?.toggleMaximize()}
        >
          {isMaximized ? <SquareMultipleRegular /> : <Square12Regular />}
        </button>
        <button
          type="button"
          className={mergeClasses(styles.controlButton, styles.closeButton)}
          aria-label="Close"
          onClick={() => appWindow?.close()}
        >
          <Dismiss12Regular />
        </button>
      </div>
    </div>
  );
}
