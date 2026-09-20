# Theme Name: Dark
# Vibe & Description: Against a dark base, information density is intentionally reduced, using whitespace and rhythm to structure content. Hierarchy is built primarily through font size, weight, and spacing rather than ornamentation. The overall design is highly restrained, with almost no shadows or strokes, keeping the interface calm and visually durable in dark environments.

# Color
""- Primary Background: #0B0F19;
- Secondary Background / Cards: #0F172A.
- Primary Text: #E5E7EB.
-Secondary Text: #9CA3AF.
-Border: #1F2937 (1px).
- Unique Signal Color (selectable based on user requirements): Used for selected states, primary buttons, and current status indicators. → Should remain clear but not glaring in dark environments.

# Font
- Heading & Body: Montserrat (url: https://resource-static.bj.bcebos.com/fonts/Montserrat-VariableFont_wght.woff2)
# Animation
## Elemental animation
- The animation is minimalist and linear. Elements slide into place along the grid lines;
##Entrance animation
- There is no bouncing or elasticity effect; the page scrolls naturally like a document with an ease-out effect.
## Transition animation
- Use a fade-in or slight shift when loading content;
## Animation implementation
- The project integrates the tailwindcss-intersect plugin, which allows you to achieve animation effects when elements enter the viewport in a manner similar to the following:
opacity-0 intersect:opacity-100 transition duration-700
-Animations can also be achieved using motion/react.

# Layout
- Content is organized into clear modules. Ample white space is used to distinguish different sections.
- Prefers left-aligned text and structured image layouts, avoiding decorative misalignments.

# Elements
- Prefers minimalist linear charts with uniform stroke thickness and no fill.
- Shadow ≈ 0, border ≤ 1px, minimizes the button's visual impact; main button ≠ large color block, emphasizes text more.