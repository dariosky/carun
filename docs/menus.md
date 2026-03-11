# Menu Behavior Spec

Generic rules for all keyboard-driven menus.

## Menu Flow

```
Main Menu
├── LOGIN → Login Providers (Google / Facebook / Back)
├── RACE / RACE ANONYMOUSLY → Game Mode Select
│   ├── SINGLE RACE → Track Select (grid, Enter starts race)
│   ├── TOURNAMENT → Track Select (grid, Enter toggles checkbox, Start Tournament button)
│   │   └── Race → Tournament Standings → ... → Tournament Final (podium)
│   └── BACK → Main Menu
└── SETTINGS → Settings (Player Name, Menu Music, AI Opponents, Debug, Logout, Back)
```

## Breadcrumb Bar

Every menu screen renders a thin bar at the top showing the navigation path, e.g. `CARUN › RACE › TOURNAMENT`. The last segment is highlighted in gold.

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

## Track Select Grid

- Tracks are arranged in a **3-row** grid of small cards (140px).
- Columns scroll horizontally; `ArrowLeft`/`ArrowRight` moves between columns, `ArrowUp`/`ArrowDown` moves between rows.
- A detail panel on the bottom-right shows info for the highlighted track.
- In **single race** mode, pressing `A` toggles AI opponents (pre-selected ON).
- In **tournament** mode, `Enter` toggles a checkbox on the highlighted track. A "START TOURNAMENT" button appears when ≥1 track is selected.

## Tournament Mode

- Selected tracks are shuffled into a random order.
- AI opponents are always on.
- Scoring: 1st = 10pts, 2nd = 8pts, 3rd = 6pts, 4th = 4pts, 5th = 3pts, 6th = 2pts.
- After each race, a standings screen shows cumulative scores.
- After the final race, a podium screen shows gold/silver/bronze medals with confetti for the winner.

## Context Notes

- Submenus include screens such as Game Mode Select, Settings, Track Select, and Editor.
- Parent menus include Main Menu and higher-level selection menus.
- Modes: `menu`, `gameModeSelect`, `loginProviders`, `settings`, `trackSelect`, `racing`, `editor`, `tournamentStandings`, `tournamentFinal`.
