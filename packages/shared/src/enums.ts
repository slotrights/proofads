/** Delivery metric a campaign pays for. Mirrors `ProofAdsMarket.MetricType`. */
export enum MetricType {
	/** One qualifying 10-second in-view render per browser session. */
	VIEW_10_SECONDS = 0,
	/**
	 * As above, but the session must also carry a World Selfie Check liveness credential.
	 * Present in the type system and in the qualification logic; NOT enabled in this MVP
	 * because Selfie Check access is gated (see docs/WORLD_STATUS.md).
	 */
	SELFIE_CHECKED_VIEW_10_SECONDS = 1,
}

export const METRIC_LABELS: Record<MetricType, string> = {
	[MetricType.VIEW_10_SECONDS]: '10-second view',
	[MetricType.SELFIE_CHECKED_VIEW_10_SECONDS]: 'Liveness-checked 10-second view',
}

/** Mirrors `ProofAdsMarket.ListingStatus`. */
export enum ListingStatus {
	NONE = 0,
	OPEN = 1,
	FINALIZED = 2,
	CANCELLED = 3,
}

/** Mirrors `ProofAdsMarket.CampaignStatus`. */
export enum CampaignStatus {
	NONE = 0,
	ACTIVE = 1,
	CLOSED = 2,
}

/** Measurement events the SDK emits. Only `VIEW_10_SECONDS_REACHED` can earn a unit. */
export const EVENT_TYPES = [
	'SLOT_MOUNTED',
	'CREATIVE_RENDERED',
	'VISIBILITY_CHANGED',
	'QUALIFYING_TIME_PROGRESS',
	'VIEW_10_SECONDS_REACHED',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** Milliseconds of qualifying visibility needed for one unit. */
export const QUALIFYING_MS = 10_000

/** Minimum fraction of the creative that must be inside the viewport to accrue time. */
export const MIN_VISIBLE_RATIO = 0.5

/** The application-defined ENSv2 EAC role, nybble 10. */
export const ROLE_SELL_SLOT = 1n << 40n

/** Its admin counterpart, nybble 42. */
export const ROLE_SELL_SLOT_ADMIN = ROLE_SELL_SLOT << 128n
