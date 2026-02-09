import { expect, test } from "@playwright/test";

type UfE2EState = {
    mapShellMounted?: boolean;
    mapShellMountCount?: number;
    mapShellUnmountCount?: number;
    mapViewMountCount?: number;
    timelineBucket?: number;
    tileRequestKey?: string;
    inspectOpen?: boolean;
    inspectCloseCount?: number;
    inspectCloseReasons?: Record<string, number>;
    inspectLastCloseReason?: string;
    playing?: boolean;
    compareEnabled?: boolean;
    splitEnabled?: boolean;
    compareOffsetBuckets?: number;
    hudLastBlockedAction?: string;
    hudLastBlockedReason?: string;
    selectedStationId?: string | null;
    blockedActions?: Record<string, number>;
};

type UfE2EActions = {
    openInspect: (stationId?: string) => void;
    closeInspect: (reason?: "drawer_close_button" | "escape_key") => void;
    toggleCompareMode: () => void;
    toggleSplitView: () => void;
    compareOffsetUp: () => void;
    compareOffsetDown: () => void;
};

async function readState(page: import("@playwright/test").Page): Promise<UfE2EState> {
    return page.evaluate(() => {
        const state = (window as { __UF_E2E?: UfE2EState }).__UF_E2E;
        return state ?? {};
    });
}

test("MapShell mounts once and publishes e2e state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-uf-id="app-root"]')).toBeVisible();
    await expect(page.locator('[data-uf-id="map-shell"]')).toBeVisible();
    await expect(page.locator('[data-uf-id="hud-clock"]')).toBeVisible();

    await expect
        .poll(async () => {
            const state = await readState(page);
            return Boolean(
                state?.mapShellMounted &&
                    state?.mapShellMountCount === 1 &&
                    state?.mapViewMountCount &&
                    state?.tileRequestKey
            );
        })
        .toBe(true);

    const state = await readState(page);
    expect(state.mapShellMounted).toBe(true);
    expect(state.mapShellMountCount).toBe(1);
    expect(state.mapShellUnmountCount ?? 0).toBe(0);
    expect((state.mapViewMountCount ?? 0) >= 1).toBe(true);
    expect(state.tileRequestKey).toBeTruthy();
});

test("inspect lock blocks timeline mutations and keeps tile key stable", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
                const state = (window as { __UF_E2E?: UfE2EState }).__UF_E2E;
                return Boolean(actions && state?.tileRequestKey);
            });
        })
        .toBe(true);

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-1");
    });

    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();
    const lockedKey = await page.evaluate(() => {
        const state = (window as { __UF_E2E?: UfE2EState }).__UF_E2E;
        return state?.tileRequestKey ?? "";
    });

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");

    await page.waitForTimeout(150);

    const whileLocked = await readState(page);
    expect(whileLocked.inspectOpen).toBe(true);
    expect(whileLocked.selectedStationId).toBe("station-e2e-1");
    expect(whileLocked.tileRequestKey).toBe(lockedKey);
    expect((whileLocked.blockedActions?.stepForward ?? 0) >= 1).toBe(true);
    expect((whileLocked.blockedActions?.stepBack ?? 0) >= 1).toBe(true);
    expect((whileLocked.blockedActions?.togglePlay ?? 0) >= 1).toBe(true);

    await page.locator('[data-uf-id="drawer-close-button"]').click();
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);
    await page.locator('[data-uf-id="scrubber-step-forward"]').click();
    await expect
        .poll(
            async () => {
                const state = await readState(page);
                return state.tileRequestKey ?? "";
            },
            { timeout: 5_000 }
        )
        .not.toBe(lockedKey);
});

test("escape closes inspect drawer and resumes playback when previously playing", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return Boolean(state.playing);
        })
        .toBe(true);

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-escape");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                inspectOpen: Boolean(state.inspectOpen),
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            inspectOpen: true,
            playing: false,
        });

    const beforeClose = await readState(page);
    const beforeEscapeCloseCount = beforeClose.inspectCloseCount ?? 0;
    const beforeEscapeReasonCount = beforeClose.inspectCloseReasons?.escape_key ?? 0;

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                inspectOpen: Boolean(state.inspectOpen),
                playing: Boolean(state.playing),
                inspectLastCloseReason: state.inspectLastCloseReason ?? "",
                inspectCloseCount: state.inspectCloseCount ?? 0,
                escapeCloseCount: state.inspectCloseReasons?.escape_key ?? 0,
            };
        })
        .toEqual({
            inspectOpen: false,
            playing: true,
            inspectLastCloseReason: "escape_key",
            inspectCloseCount: beforeEscapeCloseCount + 1,
            escapeCloseCount: beforeEscapeReasonCount + 1,
        });
});

test("closing inspect keeps playback paused when it was paused before open", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return Boolean(state.playing);
        })
        .toBe(true);

    await page.locator('[data-uf-id="scrubber-play-toggle"]').click();
    await expect
        .poll(async () => {
            const state = await readState(page);
            return Boolean(state.playing);
        })
        .toBe(false);

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-paused");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                inspectOpen: Boolean(state.inspectOpen),
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            inspectOpen: true,
            playing: false,
        });

    await page.locator('[data-uf-id="drawer-close-button"]').click();
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                inspectOpen: Boolean(state.inspectOpen),
                playing: Boolean(state.playing),
                inspectLastCloseReason: state.inspectLastCloseReason ?? "",
            };
        })
        .toEqual({
            inspectOpen: false,
            playing: false,
            inspectLastCloseReason: "drawer_close_button",
        });
});

test("hud and inspect interactions keep MapShell/MapView single-mounted", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mapShellMountCount: state.mapShellMountCount ?? 0,
                mapViewMountCount: state.mapViewMountCount ?? 0,
            };
        })
        .toEqual({
            mapShellMountCount: 1,
            mapViewMountCount: 1,
        });

    await page.locator('[data-uf-id="scrubber-speed-up"]').click();
    await page.locator('[data-uf-id="scrubber-speed-down"]').click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-single-mount");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mapShellMountCount: state.mapShellMountCount ?? 0,
                mapViewMountCount: state.mapViewMountCount ?? 0,
                mapShellUnmountCount: state.mapShellUnmountCount ?? 0,
            };
        })
        .toEqual({
            mapShellMountCount: 1,
            mapViewMountCount: 1,
            mapShellUnmountCount: 0,
        });
});

test("timeline bucket advances while playing and stays stable while paused", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                playing: Boolean(state.playing),
                timelineBucket: state.timelineBucket ?? -1,
            };
        })
        .toEqual({
            playing: true,
            timelineBucket: expect.any(Number),
        });

    const startBucket = await page.evaluate(() => {
        const state = (window as { __UF_E2E?: UfE2EState }).__UF_E2E;
        return state?.timelineBucket ?? -1;
    });

    await expect
        .poll(
            async () => {
                const state = await readState(page);
                return state.timelineBucket ?? -1;
            },
            { timeout: 2_500 }
        )
        .not.toBe(startBucket);

    await page.locator('[data-uf-id="scrubber-play-toggle"]').click();
    await expect
        .poll(async () => {
            const state = await readState(page);
            return Boolean(state.playing);
        })
        .toBe(false);

    const pausedBucket = await page.evaluate(() => {
        const state = (window as { __UF_E2E?: UfE2EState }).__UF_E2E;
        return state?.timelineBucket ?? -1;
    });

    await page.waitForTimeout(700);

    await expect
        .poll(async () => {
            const state = await readState(page);
            return state.timelineBucket ?? -1;
        })
        .toBe(pausedBucket);
});

test("tier2 details request updates drawer status lifecycle", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
                return Boolean(actions);
            });
        })
        .toBe(true);

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-tier2");
    });
    const drawer = page.locator('[data-uf-id="station-drawer"]');
    await expect(drawer).toBeVisible();

    const tier2Button = page.locator('[data-uf-id="drawer-tier2-button"]');
    await expect(tier2Button).toBeVisible();
    await tier2Button.click();

    await expect
        .poll(
            async () => (await drawer.getAttribute("data-uf-tier2-status")) ?? "",
            { timeout: 2_000 }
        )
        .toBe("loading");

    await expect
        .poll(
            async () => (await drawer.getAttribute("data-uf-tier2-status")) ?? "",
            { timeout: 6_000 }
        )
        .toMatch(/^(success|error)$/);
});

test("clock exposes mode + sv and toggles inspect-lock badge", async ({ page }) => {
    await page.goto("/");

    const modeBadge = page.locator('[data-uf-id="clock-mode-badge"]');
    const svLabel = page.locator('[data-uf-id="clock-sv"]');
    const inspectBadge = page.locator('[data-uf-id="clock-inspect-lock"]');

    await expect(modeBadge).toBeVisible();
    await expect
        .poll(async () => (await modeBadge.getAttribute("data-uf-mode")) ?? "")
        .toMatch(/^(live|replay)$/);

    await expect(svLabel).toBeVisible();
    await expect
        .poll(async () => (await svLabel.textContent())?.trim() ?? "")
        .not.toBe("");

    await expect(inspectBadge).toHaveCount(0);

    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
                return Boolean(actions);
            });
        })
        .toBe(true);

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-clock");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();
    await expect(inspectBadge).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);
    await expect(inspectBadge).toHaveCount(0);
});

test("compare controls enforce disabled and inspect-lock guards", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
                return Boolean(actions);
            });
        })
        .toBe(true);

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                compareEnabled: Boolean(state.compareEnabled),
                splitEnabled: Boolean(state.splitEnabled),
            };
        })
        .toEqual({
            compareEnabled: false,
            splitEnabled: false,
        });

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.toggleSplitView();
    });
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                blocked: state.blockedActions?.toggleSplitView ?? 0,
                reason: state.hudLastBlockedReason ?? "",
            };
        })
        .toEqual({
            blocked: 1,
            reason: "compare_mode_disabled",
        });

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.toggleCompareMode();
    });
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                compareEnabled: Boolean(state.compareEnabled),
                splitEnabled: Boolean(state.splitEnabled),
            };
        })
        .toEqual({
            compareEnabled: true,
            splitEnabled: false,
        });

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.toggleSplitView();
    });
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                compareEnabled: Boolean(state.compareEnabled),
                splitEnabled: Boolean(state.splitEnabled),
            };
        })
        .toEqual({
            compareEnabled: true,
            splitEnabled: true,
        });

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-compare-lock");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.toggleCompareMode();
        actions?.compareOffsetUp();
    });
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                blockedToggleCompare: state.blockedActions?.toggleCompareMode ?? 0,
                blockedOffsetUp: state.blockedActions?.compareOffsetUp ?? 0,
                lastBlockedReason: state.hudLastBlockedReason ?? "",
            };
        })
        .toEqual({
            blockedToggleCompare: 1,
            blockedOffsetUp: 1,
            lastBlockedReason: "inspect_lock",
        });
});

test("compare offset clamps to bounds and blocks under inspect lock", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
                return Boolean(actions);
            });
        })
        .toBe(true);

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        for (let i = 0; i < 40; i += 1) actions?.compareOffsetDown();
    });
    await expect
        .poll(async () => (await readState(page)).compareOffsetBuckets ?? -1)
        .toBe(1);

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        for (let i = 0; i < 50; i += 1) actions?.compareOffsetUp();
    });
    await expect
        .poll(async () => (await readState(page)).compareOffsetBuckets ?? -1)
        .toBe(24);

    const before = await readState(page);
    const beforeUpBlocked = before.blockedActions?.compareOffsetUp ?? 0;
    const beforeDownBlocked = before.blockedActions?.compareOffsetDown ?? 0;

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-offset-guard");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.compareOffsetUp();
        actions?.compareOffsetDown();
    });
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                upBlocked: state.blockedActions?.compareOffsetUp ?? 0,
                downBlocked: state.blockedActions?.compareOffsetDown ?? 0,
                lastBlockedReason: state.hudLastBlockedReason ?? "",
            };
        })
        .toEqual({
            upBlocked: beforeUpBlocked + 1,
            downBlocked: beforeDownBlocked + 1,
            lastBlockedReason: "inspect_lock",
        });
});
