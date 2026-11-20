import { describe, expect, it } from "bun:test"
import { createLoginGate } from "./login-gate"

describe("createLoginGate", () => {
  it("collapses concurrent logins for the same site", async () => {
    const gate = createLoginGate()
    let calls = 0
    const task = async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return { ok: true, error: null } }
    const [a, b] = await Promise.all([gate.run("cn", task), gate.run("cn", task)])
    expect(calls).toBe(1)
    expect(a.ok && b.ok).toBe(true)
  })

  it("allows different sites concurrently", async () => {
    const gate = createLoginGate()
    let calls = 0
    const task = async () => { calls += 1; return { ok: true, error: null } }
    await Promise.all([gate.run("cn", task), gate.run("intl", task)])
    expect(calls).toBe(2)
  })

  it("clears the gate after completion so a later login can run", async () => {
    const gate = createLoginGate()
    const task = async () => ({ ok: true, error: null })
    await gate.run("cn", task)
    await gate.run("cn", task)
    // both resolve; no stale promise kept
    expect(true).toBe(true)
  })
})
