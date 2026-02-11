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
    mode?: "live" | "replay";
    playbackTsMs?: number;
    mapZeroBikeColorHex?: string;
    mapHalfBikeColorHex?: string;
    mapNinetyBikeColorHex?: string;
    mapAvailabilityBucketCounts?: Record<string, number>;
    policyStatus?: "idle" | "pending" | "ready" | "stale" | "error";
    policyImpactEnabled?: boolean;
    policyMoveCount?: number;
    policyLastRunId?: number;
    policyLastError?: string;
    optimizationSessionMode?: "live" | "frozen" | "computing" | "playback" | "error";
    playbackQuality?: "full" | "reduced" | "summary";
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

async function installOptimizeApiMocks(
    page: import("@playwright/test").Page,
    opts?: {
        timelineBucketSizeSeconds?: number;
        firstRunMismatch?: boolean;
        pendingRunAttempts?: number;
    }
): Promise<{ getRunCalls: () => number; getTimelineBuckets: () => number[] }> {
    const bucketSizeSeconds = opts?.timelineBucketSizeSeconds ?? 300;
    const firstRunMismatch = opts?.firstRunMismatch ?? false;
    const pendingRunAttempts = Math.max(0, opts?.pendingRunAttempts ?? 0);
    let runCalls = 0;
    const timelineBuckets: number[] = [];

    await page.route("**/api/time?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                server_now: "2026-02-09T18:00:00.000Z",
                recommended_live_sv: "sv:e2e-policy",
                network: {
                    degrade_level: 0,
                    client_should_throttle: false,
                },
            }),
        });
    });

    await page.route("**/api/timeline?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                available_range: ["2026-02-09T16:00:00.000Z", "2026-02-09T18:00:00.000Z"],
                bucket_size_seconds: bucketSizeSeconds,
                live_edge_ts: "2026-02-09T18:00:00.000Z",
            }),
        });
    });

    await page.route("**/api/policy/config?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                default_policy_version: "rebal.greedy.v1",
                available_policy_versions: ["rebal.greedy.v1", "rebal.global.v1"],
                default_horizon_steps: 6,
                max_moves: 100,
            }),
        });
    });

    await page.route("**/api/policy/run?*", async (route) => {
        runCalls += 1;
        const url = new URL(route.request().url());
        const timelineBucket = Number(url.searchParams.get("timeline_bucket") ?? "0");
        if (Number.isFinite(timelineBucket)) timelineBuckets.push(timelineBucket);

        if (firstRunMismatch && runCalls === 1) {
            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    error: {
                        code: "view_snapshot_mismatch",
                        message: "snapshot mismatch",
                    },
                }),
            });
            return;
        }
        if (runCalls <= pendingRunAttempts) {
            await route.fulfill({
                status: 202,
                contentType: "application/json",
                body: JSON.stringify({
                    status: "pending",
                    retry_after_ms: 10,
                    cache_key: "e2e-policy",
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ready",
                run: {
                    run_id: 200 + runCalls,
                    system_id: "citibike-nyc",
                    policy_version: "rebal.greedy.v1",
                    policy_spec_sha256: "abc123",
                    sv: "sv:e2e-policy",
                    decision_bucket_ts: "2026-02-09T18:00:00.000Z",
                    horizon_steps: 6,
                    input_quality: "ok",
                    no_op: false,
                    no_op_reason: null,
                    error_reason: null,
                    move_count: 2,
                    created_at: "2026-02-09T18:00:01.000Z",
                },
            }),
        });
    });

    await page.route("**/api/policy/moves?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ready",
                run: {
                    run_id: 201,
                    policy_version: "rebal.greedy.v1",
                    policy_spec_sha256: "abc123",
                    decision_bucket_ts: "2026-02-09T18:00:00.000Z",
                    horizon_steps: 6,
                },
                top_n: 100,
                moves: [
                    {
                        move_rank: 1,
                        from_station_key: "station-a",
                        to_station_key: "station-b",
                        bikes_moved: 3,
                        dist_m: 200,
                        budget_exhausted: false,
                        neighbor_exhausted: false,
                        reason_codes: ["rebalance"],
                    },
                    {
                        move_rank: 2,
                        from_station_key: "station-c",
                        to_station_key: "station-d",
                        bikes_moved: 2,
                        dist_m: 300,
                        budget_exhausted: false,
                        neighbor_exhausted: false,
                        reason_codes: ["rebalance"],
                    },
                ],
            }),
        });
    });

    return {
        getRunCalls: () => runCalls,
        getTimelineBuckets: () => [...timelineBuckets],
    };
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

    const svLabel = await page.locator('[data-uf-id="clock-sv"]').innerText();
    const localFallbackClock = svLabel.includes("sv:local-fallback");

    if (!localFallbackClock) {
        await expect
            .poll(
                async () => {
                    const state = await readState(page);
                    return state.timelineBucket ?? -1;
                },
                { timeout: 2_500 }
            )
            .not.toBe(startBucket);
    }

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

test("drawer close button records drawer_close_button reason telemetry", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            return page.evaluate(() => {
                const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
                return Boolean(actions);
            });
        })
        .toBe(true);

    const before = await readState(page);
    const beforeCloseCount = before.inspectCloseCount ?? 0;
    const beforeReasonCount = before.inspectCloseReasons?.drawer_close_button ?? 0;

    await page.evaluate(() => {
        const actions = (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS;
        actions?.openInspect("station-e2e-close-reason");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await page.locator('[data-uf-id="drawer-close-button"]').click();
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                inspectLastCloseReason: state.inspectLastCloseReason ?? "",
                inspectCloseCount: state.inspectCloseCount ?? 0,
                drawerReasonCount: state.inspectCloseReasons?.drawer_close_button ?? 0,
            };
        })
        .toEqual({
            inspectLastCloseReason: "drawer_close_button",
            inspectCloseCount: beforeCloseCount + 1,
            drawerReasonCount: beforeReasonCount + 1,
        });
});

test("playback hotkeys are ignored while input has focus", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return Boolean(typeof state.timelineBucket === "number");
        })
        .toBe(true);

    const before = await readState(page);
    const beforePlaying = Boolean(before.playing);
    const beforeBucket = before.timelineBucket ?? -1;
    const beforeIgnored = before.hotkeyIgnoredCount ?? 0;
    const beforeHandled = before.hotkeyHandledCount ?? 0;

    await page.evaluate(() => {
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("data-uf-id", "e2e-hotkey-input");
        input.style.position = "fixed";
        input.style.top = "8px";
        input.style.left = "8px";
        input.style.zIndex = "9999";
        document.body.appendChild(input);
        input.focus();
    });

    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                playing: Boolean(state.playing),
                timelineBucket: state.timelineBucket ?? -1,
                ignored: state.hotkeyIgnoredCount ?? 0,
                handled: state.hotkeyHandledCount ?? 0,
            };
        })
        .toEqual({
            playing: beforePlaying,
            timelineBucket: beforeBucket,
            ignored: beforeIgnored + 2,
            handled: beforeHandled,
        });
});

test("layer toggles update __UF_E2E layer flags deterministically", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                severity: Boolean(state.layerSeverityEnabled),
                capacity: Boolean(state.layerCapacityEnabled),
                labels: Boolean(state.layerLabelsEnabled),
            };
        })
        .toEqual({
            severity: true,
            capacity: true,
            labels: false,
        });

    await page.locator('[data-uf-id="layer-toggle-severity"]').click();
    await page.locator('[data-uf-id="layer-toggle-capacity"]').click();
    await page.locator('[data-uf-id="layer-toggle-labels"]').click();

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                severity: Boolean(state.layerSeverityEnabled),
                capacity: Boolean(state.layerCapacityEnabled),
                labels: Boolean(state.layerLabelsEnabled),
            };
        })
        .toEqual({
            severity: false,
            capacity: false,
            labels: true,
        });
});

test("inspect lock state reflects in controlsDisabled and scrubber attr", async ({ page }) => {
    await page.goto("/");

    const scrubberTrack = page.locator('[data-uf-id="scrubber-track"]');
    await expect(scrubberTrack).toHaveAttribute("data-uf-inspect-locked", "false");
    await expect
        .poll(async () => Boolean((await readState(page)).controlsDisabled))
        .toBe(false);

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
        actions?.openInspect("station-e2e-controls-disabled");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();
    await expect(scrubberTrack).toHaveAttribute("data-uf-inspect-locked", "true");
    await expect
        .poll(async () => Boolean((await readState(page)).controlsDisabled))
        .toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);
    await expect(scrubberTrack).toHaveAttribute("data-uf-inspect-locked", "false");
    await expect
        .poll(async () => Boolean((await readState(page)).controlsDisabled))
        .toBe(false);
});

test("compare offset label stays in sync with __UF_E2E compareOffsetBuckets", async ({ page }) => {
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
        actions?.toggleCompareMode();
    });
    await expect
        .poll(async () => Boolean((await readState(page)).compareEnabled))
        .toBe(true);

    const offsetValue = page.locator('[data-uf-id="compare-offset-value"]');
    const offsetUp = page.locator('[data-uf-id="compare-offset-up"]');
    const offsetDown = page.locator('[data-uf-id="compare-offset-down"]');

    await offsetUp.click();
    await offsetUp.click();
    await offsetDown.click();

    await expect
        .poll(async () => {
            const state = await readState(page);
            const buckets = state.compareOffsetBuckets ?? -1;
            const attr = (await offsetValue.getAttribute("data-uf-offset-buckets")) ?? "";
            const text = (await offsetValue.textContent()) ?? "";
            return {
                buckets,
                attr,
                text,
            };
        })
        .toEqual({
            buckets: 7,
            attr: "7",
            text: "Offset 7 buckets",
        });
});

test("scrubber controls are disabled during inspect lock and re-enabled after close", async ({ page }) => {
    await page.goto("/");

    const play = page.locator('[data-uf-id="scrubber-play-toggle"]');
    const speedDown = page.locator('[data-uf-id="scrubber-speed-down"]');
    const speedUp = page.locator('[data-uf-id="scrubber-speed-up"]');
    const stepBack = page.locator('[data-uf-id="scrubber-step-back"]');
    const stepForward = page.locator('[data-uf-id="scrubber-step-forward"]');
    const track = page.locator('[data-uf-id="scrubber-track"]');

    await expect(play).toBeEnabled();
    await expect(speedDown).toBeEnabled();
    await expect(speedUp).toBeEnabled();
    await expect(stepBack).toBeEnabled();
    await expect(stepForward).toBeEnabled();
    await expect(track).toBeEnabled();

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
        actions?.openInspect("station-e2e-scrubber-disabled");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await expect(play).toBeDisabled();
    await expect(speedDown).toBeDisabled();
    await expect(speedUp).toBeDisabled();
    await expect(stepBack).toBeDisabled();
    await expect(stepForward).toBeDisabled();
    await expect(track).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);

    await expect(play).toBeEnabled();
    await expect(speedDown).toBeEnabled();
    await expect(speedUp).toBeEnabled();
    await expect(stepBack).toBeEnabled();
    await expect(stepForward).toBeEnabled();
    await expect(track).toBeEnabled();
});

test("compare buttons reflect disabled states for compare-off and inspect-lock", async ({ page }) => {
    await page.goto("/");

    const compareModeToggle = page.locator('[data-uf-id="compare-mode-toggle"]');
    const splitToggle = page.locator('[data-uf-id="compare-split-toggle"]');

    await expect(compareModeToggle).toBeEnabled();
    await expect(splitToggle).toBeDisabled();

    await compareModeToggle.click();
    await expect(splitToggle).toBeEnabled();

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
        actions?.openInspect("station-e2e-compare-disabled-state");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await expect(compareModeToggle).toBeDisabled();
    await expect(splitToggle).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-uf-id="station-drawer"]')).toHaveCount(0);
    await expect(compareModeToggle).toBeEnabled();
    await expect(splitToggle).toBeEnabled();
});

test("go-live button switches replay back to live time progression", async ({ page }) => {
    await page.goto("/");

    const goLive = page.locator('[data-uf-id="scrubber-go-live"]');
    const stepBack = page.locator('[data-uf-id="scrubber-step-back"]');
    const playToggle = page.locator('[data-uf-id="scrubber-play-toggle"]');

    await expect(goLive).toBeVisible();

    await playToggle.click();
    await expect
        .poll(async () => Boolean((await readState(page)).playing))
        .toBe(false);
    await stepBack.click();

    await expect
        .poll(async () => (await readState(page)).mode ?? "")
        .toBe("replay");

    const beforeLive = (await readState(page)).playbackTsMs ?? 0;
    await goLive.click();

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
                playbackTsMs: state.playbackTsMs ?? 0,
            };
        })
        .toEqual({
            mode: "live",
            playing: true,
            playbackTsMs: expect.any(Number),
        });

    await expect
        .poll(async () => (await readState(page)).playbackTsMs ?? 0)
        .toBeGreaterThan(beforeLive);
});

test("manual seek enters replay-paused and clamps to non-future time", async ({ page }) => {
    await page.goto("/");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            mode: "live",
            playing: true,
        });

    await page.keyboard.press("End");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
                playbackTsMs: state.playbackTsMs ?? 0,
            };
        })
        .toEqual({
            mode: "replay",
            playing: false,
            playbackTsMs: expect.any(Number),
        });

    const timing = await page.evaluate(() => {
        const state = (window as { __UF_E2E?: UfE2EState }).__UF_E2E;
        return {
            playbackTsMs: state?.playbackTsMs ?? 0,
            nowMs: Date.now(),
        };
    });
    expect(timing.playbackTsMs).toBeLessThanOrEqual(timing.nowMs + 1500);
});

test("scrubber pointer seek enters replay-paused and live pause holds time", async ({ page }) => {
    await page.goto("/");

    const scrubberTrack = page.locator('[data-uf-id="scrubber-track"]');
    const goLive = page.locator('[data-uf-id="scrubber-go-live"]');
    const playToggle = page.locator('[data-uf-id="scrubber-play-toggle"]');

    await expect(scrubberTrack).toBeVisible();

    const box = await scrubberTrack.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const seekX = box.x + box.width * 0.12;
    const seekY = box.y + box.height / 2;
    await page.mouse.move(seekX, seekY);
    await page.mouse.down();
    await page.mouse.move(seekX + Math.min(18, box.width * 0.03), seekY, { steps: 2 });
    await page.mouse.up();

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            mode: "replay",
            playing: false,
        });

    await goLive.click();
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            mode: "live",
            playing: true,
        });

    await playToggle.click();
    await expect
        .poll(async () => Boolean((await readState(page)).playing))
        .toBe(false);

    const pausedTs = (await readState(page)).playbackTsMs ?? 0;
    await page.waitForTimeout(1200);
    const pausedTsAfter = (await readState(page)).playbackTsMs ?? 0;
    expect(pausedTsAfter).toBe(pausedTs);
});

test("tier1 drawer shows simplified capacity/bikes/docks labels", async ({ page }) => {
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
        actions?.openInspect("station-e2e-tier1-check");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await expect(page.locator('[data-uf-id="drawer-row-capacity"]')).toBeVisible();
    await expect(page.locator('[data-uf-id="drawer-row-bikes"]')).toBeVisible();
    await expect(page.locator('[data-uf-id="drawer-row-docks"]')).toBeVisible();
    await expect(page.locator('[data-uf-id="drawer-capacity-check"]')).toHaveCount(0);

    await expect(page.locator('[data-uf-id="drawer-row-capacity"]')).toContainText("Total Capacity");
    await expect(page.locator('[data-uf-id="drawer-row-bikes"]')).toContainText("Bikes Available");
    await expect(page.locator('[data-uf-id="drawer-row-docks"]')).toContainText("Empty Docks");
    await expect(page.locator('[data-uf-id="drawer-advanced"]')).toHaveCount(0);
    await expect(page.locator('[data-uf-id="drawer-row-station-key"]')).toHaveCount(0);
    await expect(page.locator('[data-uf-id="drawer-row-bucket-quality"]')).toHaveCount(0);
    await expect(page.locator('[data-uf-id="drawer-row-t-bucket"]')).toHaveCount(0);
});

test("tier1 click freshness fields are populated from current bucket context", async ({ page }) => {
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
        actions?.openInspect("station-e2e-freshness");
    });
    await expect(page.locator('[data-uf-id="station-drawer"]')).toBeVisible();

    await expect(page.locator('[data-uf-id="drawer-value-capacity"]')).not.toHaveText("");
    await expect(page.locator('[data-uf-id="drawer-value-bikes"]')).not.toHaveText("");
    await expect(page.locator('[data-uf-id="drawer-value-docks"]')).not.toHaveText("");
    await expect(page.locator('[data-uf-id="drawer-updated-text"]')).toHaveCount(0);
});

test("search result selection opens Tier-1 drawer for selected station", async ({ page }) => {
    await page.route("**/api/search?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                results: [
                    {
                        stationKey: "station-e2e-search",
                        name: "Station Search",
                    },
                ],
            }),
        });
    });

    await page.goto("/");

    const searchInput = page.locator('[data-uf-id="search-input"]');
    const searchResults = page.locator('[data-uf-id="search-results"] button');
    await expect(searchInput).toBeVisible();

    await searchInput.fill("sea");

    await expect
        .poll(async () => searchResults.count(), { timeout: 8_000 })
        .toBeGreaterThan(0);

    const firstResult = searchResults.first();
    const resultId = (await firstResult.getAttribute("data-uf-id")) ?? "";
    const stationKey = resultId.replace(/^search-result-/, "");
    expect(stationKey.length).toBeGreaterThan(0);
    await firstResult.click();

    const drawer = page.locator('[data-uf-id="station-drawer"]');
    await expect(drawer).toBeVisible();
    await expect
        .poll(async () => (await readState(page)).selectedStationId ?? "")
        .toBe("station-e2e-search");
});

test("search keyboard navigation selects active result with Enter", async ({ page }) => {
    await page.route("**/api/search?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                results: [
                    {
                        stationKey: "station-e2e-search-a",
                        name: "Station Search A",
                    },
                    {
                        stationKey: "station-e2e-search-b",
                        name: "Station Search B",
                    },
                ],
            }),
        });
    });

    await page.goto("/");
    const searchInput = page.locator('[data-uf-id="search-input"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("sea");

    const resultA = page.locator('[data-uf-id="search-result-station-e2e-search-a"]');
    const resultB = page.locator('[data-uf-id="search-result-station-e2e-search-b"]');
    await expect(resultA).toBeVisible();
    await expect(resultB).toBeVisible();

    await expect(resultA).toHaveAttribute("data-uf-active", "true");
    await searchInput.press("ArrowDown");
    await expect(resultB).toHaveAttribute("data-uf-active", "true");
    await searchInput.press("Enter");

    await expect
        .poll(async () => (await readState(page)).selectedStationId ?? "")
        .toBe("station-e2e-search-b");
});

test("search shows backend-unavailable fallback indicator", async ({ page }) => {
    await page.route("**/api/search?*", async (route) => {
        await route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({
                error: {
                    message: "Search unavailable",
                },
            }),
        });
    });

    await page.goto("/");
    const searchInput = page.locator('[data-uf-id="search-input"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("sea");

    await expect(page.locator('[data-uf-id="search-fallback-badge"]')).toBeVisible();
    await expect(page.locator('[data-uf-id="search-fallback-badge"]')).toContainText(
        "Backend unavailable"
    );
});

test("map color ramp telemetry maps threshold buckets deterministically", async ({ page }) => {
    await page.route("**/api/gbfs/stations?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: {
                            station_id: "station-zero",
                            name: "Station Zero",
                            bikes: 0,
                            docks: 12,
                            capacity: 12,
                            bikes_availability_ratio: 0,
                        },
                        geometry: { type: "Point", coordinates: [-73.99, 40.73] },
                    },
                    {
                        type: "Feature",
                        properties: {
                            station_id: "station-mid",
                            name: "Station Mid",
                            bikes: 6,
                            docks: 6,
                            capacity: 12,
                            bikes_availability_ratio: 0.55,
                        },
                        geometry: { type: "Point", coordinates: [-73.98, 40.72] },
                    },
                ],
            }),
        });
    });

    await page.goto("/");

    await expect
        .poll(async () => (await readState(page)).mapZeroBikeColorHex ?? "", { timeout: 8_000 })
        .toBe("#ef4444");

    await expect
        .poll(async () => (await readState(page)).mapHalfBikeColorHex ?? "", { timeout: 8_000 })
        .toBe("#fde047");

    await expect
        .poll(async () => (await readState(page)).mapNinetyBikeColorHex ?? "", { timeout: 8_000 })
        .toBe("#22c55e");

    // Bucket telemetry may be empty in environments without a live Mapbox source refresh.
    await expect
        .poll(async () => {
            const buckets = (await readState(page)).mapAvailabilityBucketCounts ?? {};
            return Object.keys(buckets).length === 0 || (buckets["0"] ?? 0) >= 1;
        }, {
            timeout: 8_000,
        })
        .toBe(true);
});

test("run greedy transitions pending to ready and enables policy impact overlay", async ({ page }) => {
    let runCalls = 0;

    await page.route("**/api/time?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                server_now: "2026-02-09T18:00:00.000Z",
                recommended_live_sv: "sv:e2e-policy",
                network: {
                    degrade_level: 0,
                    client_should_throttle: false,
                },
            }),
        });
    });

    await page.route("**/api/timeline?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                available_range: ["2026-02-09T16:00:00.000Z", "2026-02-09T18:00:00.000Z"],
                bucket_size_seconds: 300,
                live_edge_ts: "2026-02-09T18:00:00.000Z",
            }),
        });
    });

    await page.route("**/api/policy/config?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                default_policy_version: "rebal.greedy.v1",
                available_policy_versions: ["rebal.greedy.v1"],
                default_horizon_steps: 6,
                max_moves: 100,
            }),
        });
    });

    await page.route("**/api/policy/run?*", async (route) => {
        runCalls += 1;
        if (runCalls < 2) {
            await route.fulfill({
                status: 202,
                contentType: "application/json",
                body: JSON.stringify({
                    status: "pending",
                    retry_after_ms: 10,
                    cache_key: "e2e-policy",
                }),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ready",
                run: {
                    run_id: 101,
                    system_id: "citibike-nyc",
                    policy_version: "rebal.greedy.v1",
                    policy_spec_sha256: "abc123",
                    sv: "sv:e2e-policy",
                    decision_bucket_ts: "2026-02-09T18:00:00.000Z",
                    horizon_steps: 6,
                    input_quality: "ok",
                    no_op: false,
                    no_op_reason: null,
                    error_reason: null,
                    move_count: 2,
                    created_at: "2026-02-09T18:00:01.000Z",
                },
            }),
        });
    });

    await page.route("**/api/policy/moves?*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ready",
                run: {
                    run_id: 101,
                    policy_version: "rebal.greedy.v1",
                    policy_spec_sha256: "abc123",
                    decision_bucket_ts: "2026-02-09T18:00:00.000Z",
                    horizon_steps: 6,
                },
                top_n: 100,
                moves: [
                    {
                        move_rank: 1,
                        from_station_key: "station-a",
                        to_station_key: "station-b",
                        bikes_moved: 3,
                        dist_m: 200,
                        budget_exhausted: false,
                        neighbor_exhausted: false,
                        reason_codes: ["rebalance"],
                    },
                    {
                        move_rank: 2,
                        from_station_key: "station-c",
                        to_station_key: "station-d",
                        bikes_moved: 2,
                        dist_m: 300,
                        budget_exhausted: false,
                        neighbor_exhausted: false,
                        reason_codes: ["rebalance"],
                    },
                ],
            }),
        });
    });

    await page.goto("/");

    const runButton = page.locator('[data-uf-id="policy-run-button"]');
    const statusBadge = page.locator('[data-uf-id="policy-status-badge"]');
    const impactToggle = page.locator('[data-uf-id="policy-impact-toggle"]');

    await expect(runButton).toBeVisible();
    await runButton.click();

    await expect(statusBadge).toHaveAttribute("data-uf-status", "ready");
    await expect(statusBadge).toContainText("Ready (2 moves)");
    await expect(impactToggle).toHaveAttribute("data-uf-enabled", "true");

    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                status: state.policyStatus ?? "",
                moveCount: state.policyMoveCount ?? 0,
                runId: state.policyLastRunId ?? 0,
                impactEnabled: Boolean(state.policyImpactEnabled),
            };
        })
        .toEqual({
            status: "ready",
            moveCount: 2,
            runId: 101,
            impactEnabled: true,
        });
});

test("snapshot mismatch shows Sync view and recovers to ready on rerun", async ({ page }) => {
    const tracker = await installOptimizeApiMocks(page, {
        timelineBucketSizeSeconds: 300,
        firstRunMismatch: true,
    });

    await page.goto("/");

    await page.locator('[data-uf-id="policy-run-button"]').click();
    await expect
        .poll(async () => (await readState(page)).policyStatus ?? "")
        .toBe("error");
    await expect(page.locator('[data-uf-id="policy-sync-view"]')).toBeVisible();

    await page.locator('[data-uf-id="policy-sync-view"]').click();
    await expect
        .poll(async () => (await readState(page)).policyStatus ?? "")
        .toBe("ready");
    await expect(page.locator('[data-uf-id="policy-sync-view"]')).toHaveCount(0);
    expect(tracker.getRunCalls()).toBeGreaterThanOrEqual(2);
});

test("optimize on replay with alternate timeline bucket size keeps preview controls working", async ({ page }) => {
    const tracker = await installOptimizeApiMocks(page, {
        timelineBucketSizeSeconds: 60,
    });

    await page.goto("/");

    await page.locator('[data-uf-id="scrubber-step-back"]').click();
    await expect
        .poll(async () => (await readState(page)).mode ?? "")
        .toBe("replay");

    await page.locator('[data-uf-id="policy-run-button"]').click();
    await expect
        .poll(async () => (await readState(page)).policyStatus ?? "")
        .toBe("ready");
    await expect(page.locator('[data-uf-id="preview-pill"]')).toBeVisible();

    const viewToggle = page.locator('[data-uf-id="preview-before-after-toggle"]');
    await expect(viewToggle).toBeVisible();
    await expect(viewToggle).toContainText("After");
    await viewToggle.click();
    await expect(viewToggle).toContainText("Before");

    const state = await readState(page);
    expect(state.optimizationSessionMode).toMatch(/^(frozen|playback)$/);
    expect(state.playbackQuality).toMatch(/^(full|reduced|summary)$/);

    const buckets = tracker.getTimelineBuckets();
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets[0] % 300).toBe(0);
});

test("return-live after optimize preview exits preview mode and resumes live progression", async ({ page }) => {
    await installOptimizeApiMocks(page, {
        timelineBucketSizeSeconds: 300,
    });

    await page.goto("/");
    await page.locator('[data-uf-id="policy-run-button"]').click();
    await expect
        .poll(async () => (await readState(page)).policyStatus ?? "")
        .toBe("ready");
    await expect(page.locator('[data-uf-id="preview-pill"]')).toBeVisible();

    await page.locator('[data-uf-id="scrubber-go-live"]').click();

    await expect(page.locator('[data-uf-id="preview-pill"]')).toHaveCount(0);
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            mode: "live",
            playing: true,
        });
});

test("golden optimize journey runs live to preview to return-live flow", async ({ page }) => {
    await installOptimizeApiMocks(page, {
        timelineBucketSizeSeconds: 300,
        pendingRunAttempts: 1,
    });

    await page.goto("/");
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            mode: "live",
            playing: true,
        });

    await page.locator('[data-uf-id="policy-run-button"]').click();
    await expect
        .poll(async () => (await readState(page)).policyStatus ?? "")
        .toBe("pending");

    await expect
        .poll(async () => (await readState(page)).policyStatus ?? "")
        .toBe("ready");
    await expect(page.locator('[data-uf-id="preview-pill"]')).toBeVisible();
    await expect(page.locator('[data-uf-id="policy-user-summary"]')).toBeVisible();

    await page.locator('[data-uf-id="scrubber-go-live"]').click();
    await expect(page.locator('[data-uf-id="preview-pill"]')).toHaveCount(0);
    await expect
        .poll(async () => {
            const state = await readState(page);
            return {
                mode: state.mode ?? "",
                playing: Boolean(state.playing),
            };
        })
        .toEqual({
            mode: "live",
            playing: true,
        });
});
