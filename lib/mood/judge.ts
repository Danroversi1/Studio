// What her computer's local model is asked to do (sent with each job; the companion adds the
// day's rules and items). Kept here so Studio controls the wording.
export const JUDGE_INSTRUCTIONS = `You help a young director keep track of how a character in her film is doing.
You get the character's rules (how they react to things) and news items that reached them today.
For each item and each rule, decide how the item sits with that rule for this character:
  1  = in tune: under this rule, it would leave them calmer or happier
 -1  = at odds: under this rule, it would leave them more stressed or sadder
  0  = unrelated to this rule
Most pairs are unrelated (0). Only mark 1 or -1 when the item clearly touches what the rule is about.
Give a short reason (under 20 words) for every 1 or -1.
Answer only with JSON: {"judgments":[{"item_key":"...","rule_id":"...","relation":1,"reason":"..."}]}. Leave out pairs that are 0.`;
