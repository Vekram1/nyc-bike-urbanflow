import { expect, test } from "@playwright/test";

type UfE2EState = {
    mapShellMounted?: boolean;
    mapShellMountCount?: number;
    mapShellUnmountCount?: number;
    mapViewMountCount?: number;
    tileRequestKey?: string;
    inspectOpen?: boolean;
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
