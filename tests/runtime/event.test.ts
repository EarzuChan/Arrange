import test from "node:test"
import assert from "node:assert/strict"
import {Box, m, dp, rememberFocusRequester, rememberInteractionState, useFocusManager} from "../../packages/runtime/src/index.ts"
import {h, renderArrange} from "../../packages/runtime/src/test/index.ts"

test("clickable is triggered through Arrange test rule", async () => {
    let clicks = 0
    const ui = await renderArrange(() => h(Box, {
        modifier: m.size(dp(40), dp(20)).clickable(() => {
            clicks += 1
        }).testTag("button")
    }))
    assert.equal(ui.node("button").performClick(), true)
    assert.equal(clicks, 1)
})

test("focus requester updates InteractionState and onFocusChanged in headless tests", async () => {
    const requester = rememberFocusRequester()
    const manager = useFocusManager()
    const interaction = rememberInteractionState()
    const changes: boolean[] = []
    const ui = await renderArrange(() => h(Box, {}, [
        h(Box, {
            modifier: m
                .size(dp(40), dp(20))
                .focusRequester(requester)
                .focusable({interactionState: interaction})
                .onFocusChanged((state: {focused: boolean}) => changes.push(state.focused))
                .testTag("field"),
        }),
        h(Box, {modifier: m.size(dp(20), dp(20)).testTag("plain")}),
    ]))

    assert.equal(ui.node("field").isFocused(), false)
    assert.equal(requester.requestFocus(), true)
    assert.equal(ui.node("field").isFocused(), true)
    assert.equal(interaction.focused, true)
    assert.deepEqual(changes, [true])

    assert.equal(ui.node("plain").requestFocus(), false)
    assert.equal(manager.clearFocus(), true)
    assert.equal(interaction.focused, false)
    assert.deepEqual(changes, [true, false])
})

test("focus requester can request focus before the node is attached", async () => {
    const requester = rememberFocusRequester()
    assert.equal(requester.requestFocus(), false)
    assert.equal(requester.requested, true)

    const ui = await renderArrange(() => h(Box, {
        modifier: m
            .size(dp(40), dp(20))
            .focusRequester(requester)
            .focusable()
            .testTag("pre-focused"),
    }))

    assert.equal(requester.requested, false)
    assert.equal(ui.node("pre-focused").isFocused(), true)
})

test("clickable is focusable by default and exposes focus through InteractionState", async () => {
    let clicks = 0
    const interaction = rememberInteractionState()
    const ui = await renderArrange(() => h(Box, {
        modifier: m
            .size(dp(40), dp(20))
            .clickable({
                interactionState: interaction, onClick: () => {
                    clicks += 1
                }
            })
            .testTag("button"),
    }))

    assert.equal(ui.node("button").performClick(), true)
    assert.equal(clicks, 1)
    assert.equal(ui.node("button").isFocused(), true)
    assert.equal(interaction.focused, true)
})

test("focused clickable can be activated by Enter and Space in headless tests", async () => {
    let clicks = 0
    const ui = await renderArrange(() => h(Box, {
        modifier: m
            .size(dp(40), dp(20))
            .clickable(() => {
                clicks += 1
            })
            .testTag("button"),
    }))

    assert.equal(ui.performKey("Enter"), false)
    assert.equal(ui.node("button").requestFocus(), true)
    assert.equal(ui.performKey("Enter"), true)
    assert.equal(ui.performKey("Space"), true)
    assert.equal(clicks, 2)
})

test("hoverable updates InteractionState and enter/exit callbacks in headless tests", async () => {
    const interaction = rememberInteractionState()
    const events: string[] = []
    const ui = await renderArrange(() => h(Box, {
        modifier: m
            .size(dp(40), dp(20))
            .hoverable({
                interactionState: interaction,
                onEnter: () => events.push("enter"),
                onExit: () => events.push("exit"),
            })
            .testTag("hover-target"),
    }))

    assert.equal(ui.node("hover-target").performHoverEnter(), true)
    assert.equal(interaction.hovered, true)
    assert.equal(ui.node("hover-target").performHoverExit(), true)
    assert.equal(interaction.hovered, false)
    assert.deepEqual(events, ["enter", "exit"])
})
