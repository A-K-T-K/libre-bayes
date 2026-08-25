import { Menu, MenuItem, MenuList, MenuPopover } from "@fluentui/react-components";
import { Delete16Regular } from "@fluentui/react-icons";
import { useMemo } from "react";

interface EdgeContextMenuProps {
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}

/** A right-click context menu anchored at arbitrary screen coordinates
 * (there's no DOM trigger element for an SVG edge path), using Fluent's
 * virtual-element positioning target. */
export function EdgeContextMenu({ x, y, onDelete, onClose }: EdgeContextMenuProps) {
  const virtualTarget = useMemo(
    () => ({
      getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    }),
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
          <MenuItem icon={<Delete16Regular />} onClick={onDelete}>
            Delete Connection
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
