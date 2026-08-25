import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover } from "@fluentui/react-components";
import { useMemo } from "react";

import { ALIGNMENT_ACTIONS } from "../lib/alignmentActions";
import { useNetworkStore } from "../store/useNetworkStore";

interface CanvasContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
}

/** Right-click menu on empty canvas -- only ever opened (see App.tsx) when
 * 2+ nodes are selected, so it always has alignment/distribution actions to
 * offer; the floating toolbar is the other entry point to the same
 * actions. */
export function CanvasContextMenu({ x, y, onClose }: CanvasContextMenuProps) {
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const alignNodes = useNetworkStore((s) => s.alignNodes);
  const distributeNodes = useNetworkStore((s) => s.distributeNodes);
  const equalizeSize = useNetworkStore((s) => s.equalizeSize);

  const virtualTarget = useMemo(
    () => ({ getBoundingClientRect: () => new DOMRect(x, y, 0, 0) }),
    [x, y],
  );

  return (
    <Menu
      open
      positioning={{ target: virtualTarget as unknown as HTMLElement }}
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <MenuPopover>
        <MenuList>
          {ALIGNMENT_ACTIONS.slice(0, 6).map((action) => (
            <MenuItem
              key={action.key}
              icon={<action.icon />}
              disabled={selectedNodeIds.length < action.minSelected}
              onClick={() => {
                action.run({ alignNodes, distributeNodes, equalizeSize });
                onClose();
              }}
            >
              {action.label}
            </MenuItem>
          ))}
          <MenuDivider />
          {ALIGNMENT_ACTIONS.slice(6, 8).map((action) => (
            <MenuItem
              key={action.key}
              icon={<action.icon />}
              disabled={selectedNodeIds.length < action.minSelected}
              onClick={() => {
                action.run({ alignNodes, distributeNodes, equalizeSize });
                onClose();
              }}
            >
              {action.label}
            </MenuItem>
          ))}
          <MenuDivider />
          {ALIGNMENT_ACTIONS.slice(8).map((action) => (
            <MenuItem
              key={action.key}
              icon={<action.icon />}
              disabled={selectedNodeIds.length < action.minSelected}
              onClick={() => {
                action.run({ alignNodes, distributeNodes, equalizeSize });
                onClose();
              }}
            >
              {action.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
