# RFD0000 - <Title>

- Feature Name: `<fill_me_in_with_a_unique_ident>`
- Start Date: `<YYYY-MM-DD>`
- RFD PR: [leostera/poneglyph#0000](https://github.com/leostera/poneglyph/pull/0000)
- Poneglyph Issue: [leostera/poneglyph#0000](https://github.com/leostera/poneglyph/issues/0000)

## Summary
[summary]: #summary

One paragraph explanation of the Poneglyph feature or system improvement.

## Motivation
[motivation]: #motivation

Any changes to Poneglyph should focus on solving a real problem for Poneglyph users, operators, or contributors.
This section should explain that problem in detail, including necessary background.

It should also contain several specific use cases where this change can help, and explain how it helps.
This can then be used to guide the design of the feature.

This section is one of the most important sections of any RFD, and can be lengthy.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

Explain the proposal as if it was already included in Poneglyph and you were teaching it to another Poneglyph contributor. That generally means:

- Introducing new named concepts.
- Explaining the feature largely in terms of examples.
- Explaining how Poneglyph contributors/operators should think about the feature, and how it should impact the way they build, run, and maintain Poneglyph systems.
- If applicable, provide sample error messages, deprecation warnings, API examples, CLI examples, or migration guidance.
- If applicable, describe the differences between teaching this to existing Poneglyph contributors and new contributors.
- Discuss how this impacts the ability to read, understand, and maintain Poneglyph code. Code is read and modified far more often than written; will the proposed feature make code easier to maintain?

For implementation-oriented RFDs (for runtime internals, ports, memory, scheduling, etc.), this section should focus on how Poneglyph contributors should think about the change, and give examples of its concrete impact. For policy RFDs, this section should provide an example-driven introduction to the policy and explain its impact in concrete terms.

### Diagram template (when relevant)

```mermaid
flowchart TD
  A[Trigger or Input] --> B[Runtime Decision Point]
  B --> C[Primary Action]
  C --> D[Stored/Audited Outcome]
  D --> E[User/Operator Visible Effect]
```

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

This is the technical portion of the RFD. Explain the design in sufficient detail that:

- Its interaction with other Poneglyph subsystems is clear.
- It is reasonably clear how the feature would be implemented.
- Corner cases are dissected by example.

The section should return to the examples given in the previous section, and explain more fully how the detailed proposal makes those examples work.

## Drawbacks
[drawbacks]: #drawbacks

Why should we *not* do this?

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- Why is this design the best in the space of possible designs?
- What other designs have been considered and what is the rationale for not choosing them?
- What is the impact of not doing this?
- Could this be done in a simpler Poneglyph module, library helper, or port-level integration instead?

## Prior art
[prior-art]: #prior-art

Discuss prior art, both the good and the bad, in relation to this proposal.
A few examples of what this can include are:

- Similar features in other agent systems, orchestration runtimes, or bot frameworks.
- Prior approaches used inside Poneglyph itself.
- Practices from adjacent systems (policy engines, memory systems, event processors).
- Papers or posts that discuss related approaches.

This section is intended to encourage you as an author to think about lessons from other systems and provide readers of your RFD with fuller context.
If there is no prior art, that is fine.

Note that precedent in another system can be motivating, but does not on its own justify an RFD.
Poneglyph may intentionally diverge from common patterns when it better fits Poneglyph's architecture and goals.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- What parts of the design do you expect to resolve through the RFD process before this gets merged?
- What parts of the design do you expect to resolve through implementation before rollout?
- What related issues are out of scope for this RFD that could be addressed in the future independently of this proposal?

## Future possibilities
[future-possibilities]: #future-possibilities

Think about what the natural extension and evolution of your proposal would be and how it would affect Poneglyph holistically over time.
Use this section to consider future interactions with runtime, ports, memory, API, and operations.

This is also a good place to dump related ideas if they are out of scope for the RFD you are writing.
If you have tried and cannot think of future possibilities, you may simply state that.

Note that having something written in this section is not by itself a reason to accept the current or a future RFD.
