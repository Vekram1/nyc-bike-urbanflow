import { expect, test } from "@playwright/test";

type UfE2EState = {
    mapShellMounted?: boolean;
    mapShellMountCount?: number;
    mapShellUnmountCount?: number;
    mapViewMountCount?: number;
    tileRequestKey?: string;
    inspectOpen?: boolean;
    inspectCloseCount?: number;
    inspectCloseReasons?: Record<string, number>;
    inspectLastCloseReason?: string;
    playing?: boolean;
    selectedStationId?: string | null;
    blockedActions?: Record<string, number>;
};

type UfE2EActions = {
    openInspect: (stationId?: string) => void;
    closeInspect: (reason?: "drawer_close_button" | "escape_key") => void;
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
