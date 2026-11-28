"use strict";

/**
 * Provider-neutral lifecycle coordinator for one dedicated Redis subscriber.
 * The selected Redis client owns its reconnect/backoff policy. This module
 * owns readiness gating, one subscription attempt per connection generation,
 * stale-state signalling, and suppression of callbacks from old generations.
 */
function createRedisSubscriberLifecycle({
  client,
  ensureSubscription,
  markUnavailable = () => {},
  markReady = () => {},
  onError = () => {},
  closeOwnedClient = false,
}) {
  if (!client || typeof client.on !== "function" ||
      typeof client.removeListener !== "function" ||
      typeof ensureSubscription !== "function" ||
      typeof markUnavailable !== "function" ||
      typeof markReady !== "function" ||
      typeof onError !== "function" ||
      typeof closeOwnedClient !== "boolean") {
    throw new TypeError("Redis lifecycle dependencies are invalid.");
  }

  let state = "idle";
  let generation = 0;
  let subscribedGeneration = -1;
  let readyPromise = null;

  function report(error) {
    try { onError(error); } catch (_) {}
  }

  function unavailable(reason) {
    if (state === "stopped" || state === "unavailable") return;
    generation += 1;
    subscribedGeneration = -1;
    readyPromise = null;
    state = "unavailable";
    try { markUnavailable(reason, generation); } catch (error) { report(error); }
  }

  async function onReady() {
    if (state === "stopped") return false;
    const current = generation;
    if (subscribedGeneration === current) return true;
    if (readyPromise) return readyPromise;

    state = "subscribing";
    readyPromise = Promise.resolve().then(() => ensureSubscription({
      generation: current,
      isCurrent: () => state !== "stopped" && generation === current,
    })).then(() => {
      if (state === "stopped" || generation !== current) return false;
      subscribedGeneration = current;
      state = "ready";
      try { markReady(current); } catch (error) { report(error); }
      return true;
    }).catch((error) => {
      if (state !== "stopped" && generation === current) {
        state = "degraded";
        report(error);
      }
      return false;
    }).finally(() => {
      if (generation === current) readyPromise = null;
    });
    return readyPromise;
  }

  function onReconnect() {
    if (state === "stopped") return;
    if (state !== "unavailable" && state !== "reconnecting") {
      generation += 1;
      subscribedGeneration = -1;
      readyPromise = null;
      try { markUnavailable("reconnecting", generation); } catch (error) { report(error); }
    }
    state = "reconnecting";
  }
  function onEnd() {
    if (state === "stopped") return;
    if (state === "reconnecting") {
      state = "unavailable";
      return;
    }
    unavailable("end");
  }
  function onClientError(error) { report(error); }

  async function start() {
    if (state !== "idle") {
      throw Object.assign(new Error("Redis lifecycle can only start once."), {
        code: "redis_lifecycle_invalid_state", status: 409,
      });
    }
    state = "connecting";
    client.on("ready", onReady);
    client.on("reconnecting", onReconnect);
    client.on("end", onEnd);
    client.on("error", onClientError);
    if (client.isReady === true) await onReady();
    return true;
  }

  function isCurrentGeneration(candidate) {
    return state === "ready" && candidate === generation &&
      subscribedGeneration === generation;
  }

  async function dispatchIfCurrent(candidate, dispatch) {
    if (typeof dispatch !== "function") throw new TypeError("dispatch must be a function.");
    if (!isCurrentGeneration(candidate)) return false;
    await dispatch();
    return isCurrentGeneration(candidate);
  }

  async function stop() {
    if (state === "stopped") return false;
    state = "stopped";
    generation += 1;
    subscribedGeneration = -1;
    client.removeListener("ready", onReady);
    client.removeListener("reconnecting", onReconnect);
    client.removeListener("end", onEnd);
    client.removeListener("error", onClientError);
    // Do not close the dedicated client while a subscription attempt is still
    // in flight. The generation/state guards prevent that attempt from
    // restoring readiness after shutdown.
    if (readyPromise) await readyPromise;
    if (closeOwnedClient) {
      if (typeof client.quit === "function") await client.quit();
      else if (typeof client.disconnect === "function") await client.disconnect();
      else throw new TypeError("Owned Redis client has no supported close method.");
    }
    return true;
  }

  function getStatus() {
    return Object.freeze({ state, generation, subscribedGeneration });
  }

  return Object.freeze({ start, stop, onReady, isCurrentGeneration, dispatchIfCurrent, getStatus });
}

module.exports = { createRedisSubscriberLifecycle };
