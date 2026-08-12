import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Upgrade from "./Upgrade";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user_1", email: "electrician@example.com" },
    cloudEnabled: true,
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
  navigate: vi.fn(),
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("../lib/subscription", () => ({
  needsBillingRecovery: (status: string) => status === "past_due",
  useSubscription: () => mocks.subscription,
}));

vi.mock("../lib/billing", () => ({
  startCheckout: mocks.startCheckout,
  openBillingPortal: mocks.openBillingPortal,
}));

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

function renderUpgrade(): string {
  return renderToStaticMarkup(<Upgrade />);
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Upgrade billing state", () => {
  beforeEach(() => {
    mocks.subscription.isPro = false;
    mocks.subscription.status = "free";
    mocks.subscription.loading = false;
    mocks.subscription.ready = true;
    mocks.subscription.error = null;
    mocks.navigate.mockReset();
    mocks.startCheckout.mockReset();
    mocks.openBillingPortal.mockReset();
  });

  it("does not promise a repeat trial to a returning subscriber", () => {
    mocks.subscription.status = "canceled";

    const text = visibleText(renderUpgrade());

    expect(text).not.toContain("Start 7-day free trial");
    expect(text).not.toContain("You won't be charged during the trial");
    expect(text).toMatch(/eligible first-time subscribers.*7-day trial/i);
    expect(text).toMatch(/continue to (secure )?checkout|restart pro/i);
  });

  it("labels the trial as eligibility-dependent for a free account", () => {
    const text = visibleText(renderUpgrade());

    expect(text).toMatch(/eligible first-time subscribers.*7-day trial/i);
    expect(text).not.toContain("You won't be charged during the trial");
  });

  it("routes a past-due account to billing recovery instead of checkout", () => {
    mocks.subscription.status = "past_due";

    const text = visibleText(renderUpgrade());

    expect(text).toMatch(/fix billing/i);
    expect(text).not.toMatch(/start 7-day free trial|continue to (secure )?checkout/i);
  });
});
