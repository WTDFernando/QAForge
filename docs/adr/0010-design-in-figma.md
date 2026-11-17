# 0010 · Design screens in Figma first

**Context.** The product owner asked for designed screens before code, and for a consistent visual system.

**Decision.** New screens are designed in Figma (https://www.figma.com/design/1r4qeekenErekQjLcqfbHN) using variables that mirror `globals.css` and components that map to `apps/web` components, then implemented to match.

**Consequences.** Figma variables are light-mode only on the current plan; dark mode lives in code. Code remains the source of truth for behaviour and accessibility.
