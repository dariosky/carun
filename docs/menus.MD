# Menu Behavior Spec

Generic rules for all keyboard-driven menus.

## Navigation Rules

- `Enter` activates the currently selected item.
- `Escape` on a submenu goes back to its parent menu.
- When returning to a parent menu, keep the parent item that opened the submenu selected.

## Row/Axis Rules

- `ArrowUp` and `ArrowDown` move between previous/next row.
- Vertical navigation must not wrap (no cycling from top to bottom or bottom to top).
- If already on top row and pressing `ArrowUp`, stay on top row.
- If already on bottom row and pressing `ArrowDown`, stay on bottom row.

## Multi-Item Row Rules

- `ArrowLeft` and `ArrowRight` move within the current row.
- Horizontal cycling is allowed where applicable (for example in track-card rows).

## Context Notes

- Submenus include screens such as Settings, Track Select, and Editor.
- Parent menus include Main Menu and higher-level selection menus.
