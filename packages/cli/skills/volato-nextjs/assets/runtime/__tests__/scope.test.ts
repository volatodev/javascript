import { describe, expect, it, beforeEach } from "vitest";
import { Scope } from "../internal/scope";
import {
  __resetHubForTests as resetBrowserHub,
  getCurrentScope as getBrowserScope,
  withScope as withBrowserScope,
} from "../internal/hub-browser";
import {
  __resetHubForTests as resetNodeHub,
  getCurrentScope as getNodeScope,
  runWithScope as runNodeWithScope,
  withScope as withNodeScope,
} from "../internal/hub-node";

describe("Scope (data class)", () => {
  it("setUser stores a copy, setUser(null) clears it", () => {
    const s = new Scope();
    const u = { email: "a@b.c" };
    s.setUser(u);
    expect(s.user).toEqual(u);
    expect(s.user).not.toBe(u); // defensive copy
    s.setUser(null);
    expect(s.user).toBeUndefined();
  });

  it("setTag and setTags merge into the tags map", () => {
    const s = new Scope();
    s.setTag("a", "1");
    s.setTags({ b: "2", c: "3" });
    expect(s.tags).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("setContext stores a copy, setContext(key, null) deletes it", () => {
    const s = new Scope();
    s.setContext("browser", { name: "Chrome" });
    expect(s.contexts.browser).toEqual({ name: "Chrome" });
    s.setContext("browser", null);
    expect(s.contexts.browser).toBeUndefined();
  });

  it("addBreadcrumb defaults timestamp to Date.now() and caps at 100", () => {
    const s = new Scope();
    for (let i = 0; i < 105; i++) {
      s.addBreadcrumb({ message: `crumb-${i}` });
    }
    expect(s.breadcrumbs.length).toBe(100);
    expect(s.breadcrumbs[0]?.message).toBe("crumb-5");
    expect(s.breadcrumbs[99]?.message).toBe("crumb-104");
    expect(typeof s.breadcrumbs[0]?.timestamp).toBe("number");
  });

  it("clone is a deep-enough copy — mutating the clone does not touch the original", () => {
    const s = new Scope();
    s.setUser({ email: "a@b.c" });
    s.setTag("k", "v");
    s.setContext("browser", { name: "Chrome" });
    s.addBreadcrumb({ message: "x" });

    const c = s.clone();
    c.setUser({ email: "z@z.z" });
    c.setTag("k", "v2");
    c.setTag("new", "added");
    c.contexts.browser!.name = "Firefox";
    c.breadcrumbs.push({ timestamp: 0, message: "y" });

    expect(s.user?.email).toBe("a@b.c");
    expect(s.tags).toEqual({ k: "v" });
    expect(s.contexts.browser).toEqual({ name: "Chrome" });
    expect(s.breadcrumbs.length).toBe(1);
  });

  it("applyTo merges scope state but does not overwrite explicit fields on the event", () => {
    const s = new Scope();
    s.setUser({ email: "scope@x.com" });
    s.setTag("env", "ci");
    s.addBreadcrumb({ message: "hi" });
    s.setLevel("warning");
    s.setFingerprint(["override"]);

    const event: Record<string, unknown> = {
      type: "Error",
      message: "boom",
      level: "error", // explicit — must win over scope
    };
    s.applyTo(event);

    expect(event.user).toEqual({ email: "scope@x.com" });
    expect(event.tags).toEqual({ env: "ci" });
    expect((event.breadcrumbs as unknown[]).length).toBe(1);
    expect(event.fingerprint).toEqual(["override"]);
    expect(event.level).toBe("error"); // explicit wins
  });
});

describe("Browser hub", () => {
  beforeEach(() => resetBrowserHub());

  it("getCurrentScope returns a stable scope instance per stack frame", () => {
    const a = getBrowserScope();
    const b = getBrowserScope();
    expect(a).toBe(b);
  });

  it("withScope forks the scope; mutations are reverted on exit", () => {
    getBrowserScope().setUser({ email: "outer@x.com" });
    withBrowserScope((s) => {
      s.setUser({ email: "inner@x.com" });
      expect(getBrowserScope().user?.email).toBe("inner@x.com");
    });
    expect(getBrowserScope().user?.email).toBe("outer@x.com");
  });

  it("withScope is properly nested", () => {
    withBrowserScope((s1) => {
      s1.setTag("level", "1");
      withBrowserScope((s2) => {
        s2.setTag("level", "2");
        expect(getBrowserScope().tags.level).toBe("2");
      });
      expect(getBrowserScope().tags.level).toBe("1");
    });
  });
});

describe("Node hub (AsyncLocalStorage isolation)", () => {
  beforeEach(() => resetNodeHub());

  it("two parallel runWithScope frames do not see each other's state", async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all([
      runNodeWithScope(new Scope(), async () => {
        getNodeScope().setUser({ email: "alice@x.com" });
        await new Promise((r) => setTimeout(r, 10));
        seen.push(getNodeScope().user?.email);
      }),
      runNodeWithScope(new Scope(), async () => {
        getNodeScope().setUser({ email: "bob@x.com" });
        await new Promise((r) => setTimeout(r, 10));
        seen.push(getNodeScope().user?.email);
      }),
    ]);
    expect(new Set(seen)).toEqual(new Set(["alice@x.com", "bob@x.com"]));
  });

  it("withScope inside a runWithScope frame inherits and forks", async () => {
    await runNodeWithScope(new Scope(), async () => {
      getNodeScope().setTag("outer", "yes");
      withNodeScope((s) => {
        s.setTag("inner", "yes");
        expect(getNodeScope().tags).toEqual({ outer: "yes", inner: "yes" });
      });
      expect(getNodeScope().tags).toEqual({ outer: "yes" });
    });
  });

  it("falls back to the root scope when no ALS frame is active", () => {
    getNodeScope().setTag("root", "1");
    expect(getNodeScope().tags.root).toBe("1");
  });
});
