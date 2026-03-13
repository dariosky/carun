function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  return fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
}

export async function fetchAuthMe() {
  const response = await request("/api/auth/me", { method: "GET" });
  if (!response.ok) return { authenticated: false };
  const payload = await parseJsonSafe(response);
  if (!isObject(payload)) return { authenticated: false };
  return payload;
}

export async function fetchTracks() {
  const response = await request("/api/tracks", { method: "GET" });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Could not load tracks";
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload : [];
}

export async function updateAuthDisplayName(displayName) {
  const response = await request("/api/auth/display-name", {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Update failed";
    throw new Error(message);
  }
  if (!isObject(payload)) throw new Error("Update failed");
  return payload;
}

export async function logoutAuth() {
  const response = await request("/api/auth/logout", { method: "POST" });
  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Logout failed";
    throw new Error(message);
  }
  return { ok: true };
}

export async function saveTrackToDb(name, trackPayload) {
  const response = await request("/api/tracks", {
    method: "POST",
    body: JSON.stringify({
      name,
      track_payload_json: trackPayload,
    }),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Save failed";
    throw new Error(message);
  }
  return payload;
}

export async function updateTrackInDb(trackId, { name, trackPayload } = {}) {
  const body = {};
  if (typeof name === "string") body.name = name;
  if (trackPayload && typeof trackPayload === "object")
    body.track_payload_json = trackPayload;
  const response = await request(`/api/tracks/${encodeURIComponent(trackId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Save failed";
    throw new Error(message);
  }
  if (!isObject(payload)) throw new Error("Save failed");
  return payload;
}

export async function fetchTrackById(trackId) {
  const response = await request(`/api/tracks/${encodeURIComponent(trackId)}`, {
    method: "GET",
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Track not found";
    throw new Error(message);
  }
  return payload;
}

export async function fetchMyTracks() {
  const response = await request("/api/tracks/mine", { method: "GET" });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Could not load tracks";
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload : [];
}

export async function fetchSharedTrack(shareToken) {
  const response = await request(
    `/api/tracks/share/${encodeURIComponent(shareToken)}`,
    { method: "GET" },
  );
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Track not found";
    throw new Error(message);
  }
  return payload;
}

export async function setTrackPublished(trackId, isPublished) {
  const response = await request(
    `/api/tracks/${encodeURIComponent(trackId)}/publish`,
    {
      method: "PATCH",
      body: JSON.stringify({ is_published: Boolean(isPublished) }),
    },
  );
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Publish update failed";
    throw new Error(message);
  }
  if (!isObject(payload)) throw new Error("Publish update failed");
  return payload;
}

export async function renameTrack(trackId, name) {
  try {
    return await updateTrackInDb(trackId, { name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rename failed";
    throw new Error(message);
  }
}

export async function deleteTrackById(trackId) {
  const response = await request(`/api/tracks/${encodeURIComponent(trackId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    const message =
      isObject(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "Delete failed";
    throw new Error(message);
  }
}

export async function submitLapResult(payload) {
  const response = await request("/api/laps", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(data) && typeof data.detail === "string"
        ? data.detail
        : "Lap submit failed";
    throw new Error(message);
  }
  if (!isObject(data)) throw new Error("Lap submit failed");
  return data;
}

export async function submitRaceResult(payload) {
  const response = await request("/api/races", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(data) && typeof data.detail === "string"
        ? data.detail
        : "Race submit failed";
    throw new Error(message);
  }
  if (!isObject(data)) throw new Error("Race submit failed");
  return data;
}

export async function createTournamentRoom(payload) {
  const response = await request("/api/tournaments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(data) && typeof data.detail === "string"
        ? data.detail
        : "Tournament room create failed";
    throw new Error(message);
  }
  if (!isObject(data)) throw new Error("Tournament room create failed");
  return data;
}

export async function fetchTournamentRoom(roomId) {
  const response = await request(
    `/api/tournaments/${encodeURIComponent(roomId)}`,
    {
      method: "GET",
    },
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(data) && typeof data.detail === "string"
        ? data.detail
        : "Tournament room not found";
    throw new Error(message);
  }
  if (!isObject(data)) throw new Error("Tournament room not found");
  return data;
}

export async function joinTournamentRoom(roomId, payload) {
  const response = await request(
    `/api/tournaments/${encodeURIComponent(roomId)}/join`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      isObject(data) && typeof data.detail === "string"
        ? data.detail
        : "Tournament room join failed";
    throw new Error(message);
  }
  if (!isObject(data)) throw new Error("Tournament room join failed");
  return data;
}
