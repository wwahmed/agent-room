# WakiChat design system

This is the shared visual contract for the T-38 redesign. Components should use these semantic tokens instead of inventing one-off pixel values or state colors.

## Typography

Use the named Tailwind sizes: `text-caption` (12), `text-meta` (13), `text-body` (15), `text-title` (17), `text-heading` (20), and `text-display` (24). The supported weights are 400, 600, and 700. Editorial text never renders below 12px. Uppercase tracking is reserved for section eyebrows.

## Geometry

The layout follows a 4px grid. Use 8px for related gaps, 12px for grouped gaps, 24px between sections, and 16px/24px screen margins on mobile/desktop. Controls use an 8px radius and a 44px minimum target; cards use 12px; sheets and modals use 16px. Icons use 16px or 20px with a consistent 1.5 stroke where possible.

## Color and elevation

Use `surface-0`, `surface-1`, and `surface-2` for background hierarchy; `ink`, `ink-muted`, `ink-soft`, and `ink-faint` for text; `border-subtle` and `border-strong` for edges. Accent is reserved for selection and primary action. Success, warning, and danger communicate actual state and must also have a non-color cue. The automated token test enforces 4.5:1 for text colors on the primary card surface.

Dark-theme elevation comes primarily from surface changes and borders. Light theme adds one soft shadow. `shadow-card` and `shadow-elevated` encode that difference.

## Motion and primitives

Use `duration-micro` (150ms) for control feedback and `duration-panel` (250ms) for panels, with `ease-product`. All motion is suppressed by the global reduced-motion rule. Shared `.ui-control`, `.ui-card`, `.ui-sheet`, and `.ui-focus-ring` primitives provide the baseline geometry while screen tasks progressively migrate existing UI.
