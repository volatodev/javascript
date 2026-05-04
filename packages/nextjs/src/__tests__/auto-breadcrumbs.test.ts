import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  __resetActiveConfigForTests,
  getCurrentScope,
  initClient,
  instrumentNavigation,
} from "../client";

const DSN =
  "https://pk_test_abc@volato.dev/11111111-2222-3333-4444-555555555555";

describe("instrumentNavigation", () => {
  let popListener: ((ev: Event) => void) | null = null;
  let pushOriginal: typeof history.pushState;
  let replaceOriginal: typeof history.replaceState;

  beforeEach(() => {
    __resetActiveConfigForTests();
    vi.stubEnv("NODE_ENV", "production");
    pushOriginal = vi.fn() as unknown as typeof history.pushState;
    replaceOriginal = vi.fn() as unknown as typeof history.replaceState;
    popListener = null;
    vi.stubGlobal("history", {
      pushState: pushOriginal,
      replaceState: replaceOriginal,
    });
    vi.stubGlobal("location", { href: "https://app.example.com/a" });
    vi.stubGlobal("navigator", { userAgent: "vitest" });
    vi.stubGlobal("window", {
      addEventListener: (type: string, cb: (ev: Event) => void) => {
        if (type === "popstate") popListener = cb;
      },
      removeEventListener: () => {},
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("adds a navigation breadcrumb on pushState", () => {
    initClient({ dsn: DSN, environment: "production" });
    // Make our pushState mock change location.href as a side effect (the
    // real browser does this).
    const origPush = history.pushState as unknown as ReturnType<typeof vi.fn>;
    origPush.mockImplementation((_d: unknown, _u: string, url: string) => {
      (location as { href: string }).href = `https://app.example.com${
        url.startsWith("/") ? url : `/${url}`
      }`;
    });

    instrumentNavigation();

    const before = location.href; // /a
    history.pushState(null, "", "/b");

    const crumbs = getCurrentScope().breadcrumbs;
    expect(crumbs.length).toBe(1);
    expect(crumbs[0]).toMatchObject({
      category: "navigation",
      type: "navigation",
      data: { from: before, to: "https://app.example.com/b" },
    });
  });

  it("adds a navigation breadcrumb on popstate", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentNavigation();

    (location as { href: string }).href = "https://app.example.com/c";
    expect(popListener).not.toBeNull();
    popListener!({} as Event);

    const crumbs = getCurrentScope().breadcrumbs;
    expect(crumbs.length).toBe(1);
    expect(crumbs[0]?.category).toBe("navigation");
  });

  it("does not add a breadcrumb when from === to", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentNavigation();
    history.pushState(null, "", "/a"); // same URL
    expect(getCurrentScope().breadcrumbs.length).toBe(0);
  });
});

