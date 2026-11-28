# Frontend rules

- Keep compact Console panel styles scoped in components/producer-panels.css and inherit theme roles from ProducerView; this avoids changing audio logic or unrelated screens.

- Keep clip tool visibility separate from track selection; single selection and dragging must not open editing overlays.
- Keep transient recording guidance tied to cue identity rather than playhead ticks, with timing and tap rules in lib/console-guidance.ts so they can be tested independently.
