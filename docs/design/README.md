# Quote Agent – screen designs

These six files are the visual source of truth for the app. They come from the design canvas.

| File | Page |
|---|---|
| `landing.dc.html` | `/` |
| `inbox.dc.html` | `/inbox` |
| `agent-run.dc.html` | `/agent` |
| `review.dc.html` | `/review` |
| `price-lists.dc.html` | `/pricing` |
| `ask.dc.html` | `/ask` |

How to read them (they won't open as normal web pages):

- The markup inside `<x-dc>` is the screen. All styling is inline, so colours, sizes, spacing, borders, radii and shadows are the exact values to copy.
- `{{name}}` is a value filled in from the `<script type="text/x-dc">` block at the bottom of each file. That block holds the sample data shown on screen.
- `<sc-for list="{{items}}" as="x">` repeats its contents for each item in the list.
- `<sc-if value="{{flag}}">` shows its contents only when the value is true.
- The sidebar menu is built from the `nav()` function in each script block.
- Ignore `support.js`, `hint-placeholder-*` attributes and `data-props`; they belong to the design tool.

The sample data in these files is placeholder content. The real app shows real data from the database.
