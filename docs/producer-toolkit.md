# Producer Toolkit

Producer Mind / prompt-to-tweak emit **tool_calls** with real parameters, not only fixed schema toggles.

## Phase 1 tools
EQ, compressor, reverb (plate/hall/room/spring), delay, saturation, de-esser, filter, stereo width, limiter.

## Knowledge
Each tool has use-cases, safe ranges, genre notes in `lib/ap-engine/toolkit/knowledge.ts`.

## Guardrails
- Max 4 tool calls per request
- True-peak safety after execution
- Arrangement/sample instruments: suggested only until confirmation UX ships

## Example
`make this breakdown feel more spacious` → reverb hall + longer decay on matched sections.
