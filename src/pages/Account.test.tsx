import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Account from "./Account";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user_1", email: "electrician@example.com" } as {
      id: string;
      email: string;
    } | null,
    cloudEnabled: true,
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  },
  subscription: {
    isPro: false,
    status: "free",
    plan: null as string | null,
    currentPeriodEnd: null as string | null,
    loading: false,
    ready: true,
    error: null as string | null,
    refresh: vi.fn(),
  },
  route: {
    pathname: "/account",
    search: "?upgraded=1",
  },
  navigate: vi.fn(),
  openBillingPortal: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => <span data-navigate-to={to} />,
  useLocation: () => ({
    pathname: mocks.route.pathname,
    search: mocks.route.search,
  }),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.route.search)],
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("../lib/subscription", () => ({
  needsBillingRecovery: (status: string) => status === "past_due",
  useSubscription: () => mocks.subscription,
}));

vi.mock("../lib/billing", () => ({
  openBillingPortal: mocks.openBillingPortal,
}));

function renderAccount(path = "/account?upgraded=1"): string {
  const url = new URL(path, "https://codewire.test");
  mocks.route.pathname = url.pathname;
  mocks.route.search = url.search;
  return renderToStaticMarkup(<Account />);
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Account checkout return state", () => {
  beforeEach(() => {
    mocks.auth.user = {
      id: "user_1",
      email: "electrician@example.com",
    };
    mocks.subscription.isPro = false;
    mocks.subscription.status = "free";
    mocks.subscription.loading = false;
    mocks.subscription.ready = true;
    mocks.subscription.error = null;
    mocks.navigate.mockReset();
    mocks.subscription.refresh.mockReset();
    mocks.openBillingPortal.mockReset();
  });

  it("shows an active subscription confirmation without claiming a trial", () => {
    mocks.subscription.isPro = true;
    mocks.subscription.status = "active";

    const text = visibleText(renderAccount());

    expect(text).toMatch(/pro.*active|subscription.*active/i);
    expect(text).not.toMatch(/trial has started/i);
  });

  it("shows trial confirmation only for a verified trialing subscription", () => {
    mocks.subscription.isPro = true;
    mocks.subscription.status = "trialing";

    const text = visibleText(renderAccount());

    expect(text).toMatch(/trial (?:has started|is active)/i);
  });

  it("does not treat the upgraded query parameter as proof of payment", () => {
    const text = visibleText(renderAccount());

    expect(text).not.toMatch(/welcome to pro|trial has started|payment received/i);
    expect(text).toMatch(/verif|confirm|pending/i);
    expect(text).not.toMatch(/upgrade to pro/i);
  });

  it("keeps the past-due account action focused on billing recovery", () => {
    mocks.subscription.status = "past_due";

    const text = visibleText(renderAccount("/account"));

    expect(text).toMatch(/payment issue/i);
    expect(text).toMatch(/fix billing/i);
    expect(text).not.toMatch(/upgrade to pro/i);
  });

  it("recognizes the exact signed-out nested checkout return without claiming success", () => {
    mocks.auth.user = null;

    const text = visibleText(
      renderAccount("/login?next=%2Faccount%3Fupgraded%3D1"),
    );

    expect(text).toContain("Sign in to verify your Codewire Pro status.");
    expect(text).toMatch(/sign in/i);
    expect(text).not.toMatch(/welcome to pro|payment received|trial has started/i);
  });

  it("does not treat an arbitrary signed-out next target as a checkout return", () => {
    mocks.auth.user = null;

    const text = visibleText(
      renderAccount("/login?next=https%3A%2F%2Fevil.example%2Faccount"),
    );

    expect(text).not.toContain("Sign in to verify your Codewire Pro status.");
    expect(text).not.toMatch(/welcome to pro|payment received|trial has started/i);
  });

  it("preserves only the exact checkout return after sign-in", () => {
    const checkoutReturn = renderAccount(
      "/login?next=%2Faccount%3Fupgraded%3D1",
    );
    expect(checkoutReturn).toContain(
      'data-navigate-to="/account?upgraded=1"',
    );

    const unsafeReturn = renderAccount(
      "/login?next=https%3A%2F%2Fevil.example%2Faccount",
    );
    expect(unsafeReturn).toContain('data-navigate-to="/account"');
  });

  it("preserves a direct checkout return for the next sign-in step", () => {
    mocks.auth.user = null;

    const text = visibleText(renderAccount("/account?upgraded=1"));

    expect(text).toContain("Sign in to verify your Codewire Pro status.");
    expect(text).not.toMatch(/welcome to pro|payment received|trial has started/i);
  });
});
