/**
 * Output-device normalization for the Speaker / Monitor picker.
 *
 * Browsers often expose several MediaDeviceInfo rows for the same physical
 * route (default alias, communications alias, "Speaker" vs "iPhone Speaker",
 * duplicate AirPods rows sharing a groupId). Users should see one option per
 * physical output — not raw MediaDeviceInfo entries.
 *
 * Deduplication strategy (deterministic, documented):
 * 1. Only `kind === "audiooutput"` rows are considered.
 * 2. Skip empty deviceIds.
 * 3. Treat deviceId "default" and "communications" as aliases: if another
 *    non-alias device shares the same groupId, drop the alias. If no peer
 *    exists, keep a single "System Default" entry.
 * 4. Primary identity key = groupId when present and non-empty; otherwise
 *    deviceId. Rows sharing a groupId collapse to one representative.
 * 5. Within a group, prefer a non-generic label (Bluetooth names, "AirPods")
 *    over "Speaker" / "Default" / "Built-in…".
 * 6. Do NOT collapse solely by label: same label + different groupId stays
 *    as separate options (two "Headphones" devices can be real).
 * 7. Display labels are normalized for built-in/default routes only;
 *    Bluetooth / product names are left recognizable.
 *
 * setSinkId is Chromium/Android only. iOS Safari does not support it —
 * callers must not invent selectable sinks the platform cannot route to.
 */

export type RawOutputDevice = {
  deviceId: string;
  label: string;
  groupId?: string;
  kind?: string;
};

export type NormalizedOutputDevice = {
  /** deviceId to pass to setSinkId */
  deviceId: string;
  /** User-facing label */
  label: string;
  groupId: string;
  /** True when this is the browser "default" / "communications" alias */
  isDefaultAlias: boolean;
  /** True when label looks like headphones / BT / wired */
  isHeadphones: boolean;
};

const HEADPHONE_RE = /head|ear.?pod|airpod|headset|lightning|usb|bluetooth|wired|earphone/i;
const BUILTIN_SPEAKER_RE =
  /^(speaker|speakers|iphone speaker|ipad speaker|android speaker|phone speaker|built-?in( audio)?( output)?|internal speaker|default|default speaker|communications)$/i;
const GENERIC_LABEL_RE = /^(default|communications|speaker|speakers|audio output|built-?in.*|system)$/i;

export function looksLikeHeadphonesLabel(label: string): boolean {
  return HEADPHONE_RE.test(label || "");
}

export function isDefaultAliasId(deviceId: string): boolean {
  const id = (deviceId || "").toLowerCase();
  return id === "default" || id === "communications";
}

/**
 * Normalize a browser label into a short user-facing string.
 * Bluetooth / product names are preserved.
 */
export function normalizeOutputLabel(raw: string, isDefaultAlias: boolean): string {
  const label = (raw || "").trim();
  if (!label) return isDefaultAlias ? "System Default" : "Speaker";

  if (isDefaultAlias && GENERIC_LABEL_RE.test(label)) {
    return "System Default";
  }

  // Common built-in aliases → "Speaker"
  if (BUILTIN_SPEAKER_RE.test(label)) {
    return "Speaker";
  }

  // "Built-in Audio Output" / "MacBook Pro Speakers" style
  if (/built.?in/i.test(label) && /speaker|output|audio/i.test(label)) {
    return "Speaker";
  }
  if (/iphone|ipad/i.test(label) && /speaker/i.test(label)) {
    return "Speaker";
  }

  // Strip trailing " (…)" noise some browsers append, keep product name
  const cleaned = label.replace(/\s*\([^)]*default[^)]*\)\s*$/i, "").trim();
  return cleaned || label;
}

function labelRank(label: string, isDefaultAlias: boolean): number {
  // Higher = better representative for the group
  if (isDefaultAlias) return 0;
  if (GENERIC_LABEL_RE.test(label)) return 1;
  if (BUILTIN_SPEAKER_RE.test(label)) return 2;
  if (looksLikeHeadphonesLabel(label)) return 5;
  if (label.trim().length > 0) return 4;
  return 1;
}

/**
 * Deduplicate and normalize audiooutput devices into a clean user-facing list.
 * Input may include any MediaDeviceInfo-like objects; non-outputs are ignored
 * when `kind` is present.
 */
export function normalizeOutputDevices(
  devices: RawOutputDevice[]
): NormalizedOutputDevice[] {
  const outputs = devices.filter((d) => {
    if (d.kind && d.kind !== "audiooutput") return false;
    return Boolean(d.deviceId);
  });

  // First pass: index non-alias devices by groupId
  const groupHasConcrete = new Set<string>();
  for (const d of outputs) {
    if (!isDefaultAliasId(d.deviceId) && d.groupId) {
      groupHasConcrete.add(d.groupId);
    }
  }

  // Key → best candidate
  type Cand = RawOutputDevice & { isDefaultAlias: boolean };
  const byKey = new Map<string, Cand>();

  for (const d of outputs) {
    const isAlias = isDefaultAliasId(d.deviceId);
    const gid = (d.groupId || "").trim();

    // Drop default/communications when a concrete device shares the group
    if (isAlias && gid && groupHasConcrete.has(gid)) {
      continue;
    }

    // Identity: groupId when available, else deviceId
    // Aliases without a concrete peer use a stable "alias:default" key so
    // default + communications collapse together.
    let key: string;
    if (isAlias && (!gid || !groupHasConcrete.has(gid))) {
      key = gid ? `alias-group:${gid}` : "alias:default";
    } else if (gid) {
      key = `group:${gid}`;
    } else {
      key = `id:${d.deviceId}`;
    }

    const cand: Cand = { ...d, isDefaultAlias: isAlias };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, cand);
      continue;
    }
    const prevRank = labelRank(prev.label || "", prev.isDefaultAlias);
    const nextRank = labelRank(d.label || "", isAlias);
    if (nextRank > prevRank) {
      byKey.set(key, cand);
    } else if (nextRank === prevRank && !isAlias && prev.isDefaultAlias) {
      byKey.set(key, cand);
    }
  }

  const result: NormalizedOutputDevice[] = [];
  for (const c of byKey.values()) {
    const isAlias = c.isDefaultAlias;
    const label = normalizeOutputLabel(c.label || "", isAlias);
    result.push({
      deviceId: c.deviceId,
      label,
      groupId: c.groupId || "",
      isDefaultAlias: isAlias,
      isHeadphones: looksLikeHeadphonesLabel(c.label || "") || looksLikeHeadphonesLabel(label),
    });
  }

  // Stable sort: Speaker / default first, then headphones, then others by label
  result.sort((a, b) => {
    const bucket = (d: NormalizedOutputDevice) => {
      if (d.isDefaultAlias || (!d.isHeadphones && /speaker/i.test(d.label))) return 0;
      if (d.isHeadphones) return 2;
      return 1;
    };
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    return a.label.localeCompare(b.label);
  });

  return result;
}

/**
 * Prefer a phone/built-in speaker deviceId from a normalized list.
 */
export function preferPhoneSpeakerFromNormalized(
  devices: NormalizedOutputDevice[]
): string {
  const notHp = devices.filter((d) => !d.isHeadphones);
  const phone =
    notHp.find((d) => d.isDefaultAlias) ||
    notHp.find((d) => /speaker/i.test(d.label)) ||
    notHp[0];
  return phone?.deviceId || "";
}

/**
 * Prefer a headphone-like deviceId from a normalized list.
 */
export function preferHeadphonesFromNormalized(
  devices: NormalizedOutputDevice[]
): string {
  const hp = devices.find((d) => d.isHeadphones);
  return hp?.deviceId || "";
}
