/**
 * Scope — per-request bag of context that gets merged into every event
 * captured while the scope is active. Pure data + methods, no globals.
 *
 * Browser uses one scope per page lifetime (single-threaded). Server +
 * Edge use AsyncLocalStorage to isolate one scope per inflight request.
 */
import type { Breadcrumb, Contexts, Level, User } from "@volatodev/core";

const MAX_BREADCRUMBS = 100;

export class Scope {
  user?: User;
  tags: Record<string, string> = {};
  contexts: Contexts = {};
  extra: Record<string, unknown> = {};
  breadcrumbs: Breadcrumb[] = [];
  fingerprint?: string[];
  level?: Level;
  /**
   * When `true`, `addBreadcrumb` is a no-op. The hub sets this on the
   * server / edge "root" scope so a long-lived process can't accumulate
   * breadcrumbs across unrelated requests (privacy-adjacent leak).
   * Per-request scopes (cloned via `withScope` / `runWithScope`) inherit
   * `false` and behave normally.
   */
  rejectsBreadcrumbs = false;

  setUser(user: User | null): this {
    if (user === null) delete this.user;
    else this.user = { ...user };
    return this;
  }

  setTag(key: string, value: string): this {
    this.tags[key] = value;
    return this;
  }

  setTags(tags: Record<string, string>): this {
    Object.assign(this.tags, tags);
    return this;
  }

  setContext(key: string, ctx: Record<string, unknown> | null): this {
    if (ctx === null) delete this.contexts[key];
    else this.contexts[key] = { ...ctx };
    return this;
  }

  setExtra(key: string, value: unknown): this {
    this.extra[key] = value;
    return this;
  }

  setLevel(level: Level): this {
    this.level = level;
    return this;
  }

  setFingerprint(fingerprint: string[]): this {
    this.fingerprint = [...fingerprint];
    return this;
  }

  addBreadcrumb(crumb: Partial<Breadcrumb>): this {
    if (this.rejectsBreadcrumbs) return this;
    const full: Breadcrumb = {
      timestamp: crumb.timestamp ?? Date.now(),
      ...crumb,
    };
    this.breadcrumbs.push(full);
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) {
      this.breadcrumbs.splice(0, this.breadcrumbs.length - MAX_BREADCRUMBS);
    }
    return this;
  }

  clear(): this {
    delete this.user;
    this.tags = {};
    this.contexts = {};
    this.extra = {};
    this.breadcrumbs = [];
    delete this.fingerprint;
    delete this.level;
    return this;
  }

  clone(): Scope {
    const next = new Scope();
    // Cloned scopes are per-request and DO accept breadcrumbs even
    // when the source was the breadcrumb-rejecting root scope.
    next.rejectsBreadcrumbs = false;
    if (this.user) next.user = { ...this.user };
    next.tags = { ...this.tags };
    next.contexts = {};
    for (const [k, v] of Object.entries(this.contexts)) {
      next.contexts[k] = { ...v };
    }
    next.extra = { ...this.extra };
    next.breadcrumbs = [...this.breadcrumbs];
    if (this.fingerprint) next.fingerprint = [...this.fingerprint];
    if (this.level) next.level = this.level;
    return next;
  }

  /**
   * Merge this scope's state onto an event payload. Existing event fields
   * win — explicit values passed at capture time are not overwritten.
   */
  applyTo<T extends Record<string, unknown>>(event: T): T {
    const target = event as Record<string, unknown>;
    if (this.user && !target.user) target.user = { ...this.user };
    if (Object.keys(this.tags).length > 0 && !target.tags) {
      target.tags = { ...this.tags };
    }
    if (Object.keys(this.contexts).length > 0 && !target.contexts) {
      const merged: Contexts = {};
      for (const [k, v] of Object.entries(this.contexts)) merged[k] = { ...v };
      target.contexts = merged;
    }
    if (Object.keys(this.extra).length > 0 && !target.extra) {
      target.extra = { ...this.extra };
    }
    if (this.breadcrumbs.length > 0 && !target.breadcrumbs) {
      target.breadcrumbs = [...this.breadcrumbs];
    }
    if (this.fingerprint && !target.fingerprint) {
      target.fingerprint = [...this.fingerprint];
    }
    if (this.level && !target.level) target.level = this.level;
    return event;
  }
}
