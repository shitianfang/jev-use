import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postJson } from "../src/backends/http.js";

describe("Retry-After timing", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "America/New_York");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["Wed, 07 Oct 2026 12:00:05 GMT", 5000],
    ["Wednesday, 07-Oct-26 12:00:05 GMT", 5000],
    ["Friday, 07-Oct-50 12:00:05 GMT", 60000],
    ["Thursday, 07-Oct-99 12:00:05 GMT", 0],
    ["Wed Oct  7 12:00:05 2026", 5000],
    ["Wed, 07 Oct 2026 12:02:05 GMT", 60000],
    ["Wed, 07 Oct 2026 11:59:59 GMT", 0],
    ["2", 2000],
    ["not-a-date", 500],
  ])("honors %s before the next HTTP attempt", async (header, delay) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "try later" }), {
        status: 503, headers: { "Retry-After": header },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const pending = postJson("test", "https://example.invalid/judge", {}, {}, { maxRetries: 1 });
    await vi.advanceTimersByTimeAsync(0);
    if (delay > 0) {
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
    } else {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toEqual({ ok: true });
  });
});
