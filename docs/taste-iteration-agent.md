# Taste & Iteration Agent

Sits between artist prompts and the tweak/render path.

## Behaviors

1. **Taste profile** — logs tweak directions on `profiles.metadata.taste_profile`; weak trust until multiple sessions.
2. **Variations** — ambiguous prompts (“hit harder”) return 2–3 labeled options.
3. **Commercial readiness** — peak / mono / silence notes after each render (inform, don’t hard-block export).
4. **Done signal** — optional “tracking well + clean for export” note; never auto-export.
5. **Loop note** — detects back-and-forth on the same field.
6. **History** — versioned tweaks with undo.

## Guardrails

- Current explicit request always wins over taste defaults.
- True-peak safety caps still apply in partial render.
- Export remains an explicit artist action.
