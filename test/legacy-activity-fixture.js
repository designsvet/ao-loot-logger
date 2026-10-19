// TEST ONLY: September fixture bytes remain unchanged. Translate their five old
// activity event ordinals to the October table solely to retain field/reconciliation
// coverage. These historical replays are not evidence of fresh live-game capture.
const codes = new Map([[267, 266], [355, 354], [393, 392], [394, 393], [497, 496]])
const octoberActivityFixture = (parameters) => ({
  ...parameters,
  252: codes.get(parameters[252]) ?? parameters[252]
})
module.exports = { octoberActivityFixture }
