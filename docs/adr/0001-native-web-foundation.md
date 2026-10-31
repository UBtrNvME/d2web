# 0001. Native web foundation

Status: accepted (user direction, recorded 31 October 2026)

Context: d2web is a reusable D2 browser runtime and presentation library, suitable for future React bindings. Studio and d2editor are consumers. See [AGENTS.md](../../AGENTS.md) and [research findings](../research-findings.md).

Decision: Build on native HTML, JavaScript, CSS and SVG with framework-independent contracts. D2's Go compiler runs in WASM and owns compilation, layout, themes and default appearance, including TALA. d2web adds no implicit skins or application policy.

Alternatives: React Flow as the foundation (kept only as connection-drawing prior art); JointJS (studied, not selected); Web Components/Shadow DOM or a custom virtual DOM (not shown to be necessary).

Consequences: React is a consumer binding, not the architecture. Consumer-controlled effects need explicit boundaries. Stack, public API and packaging remain open until R5.
