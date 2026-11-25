"use strict";

export function createPrivateWatchlistController({ supabase, catalogKeys }) {
  if (!supabase?.auth || typeof supabase.from !== "function") throw new TypeError("A Supabase client is required.");
  const allowed = new Set(catalogKeys);
  let userId = null;
  let activeName = "My Stocks";
  let keys = [];
  let revision = 0;
  let saveQueue = Promise.resolve();
  let requestVersion = 0;
  let sessionGeneration = 0;
  const names = ["My Stocks", "Banking", "NIFTY", "F&O"];

  function reset(nextUserId = null) {
    sessionGeneration++;
    userId = nextUserId;
    activeName = names[0];
    keys = [];
    revision++;
    requestVersion++;
  }

  async function load(name = activeName) {
    if (!names.includes(name)) throw new Error("Invalid watchlist name.");
    const uid = userId;
    if (!uid) throw new Error("Sign in to load private watchlists.");
    const request = ++requestVersion;
    const { data, error } = await supabase.from("paper_watchlists")
      .select("name,instrument_keys").eq("user_id", uid);
    if (error) throw error;
    if (request !== requestVersion || uid !== userId) return { stale: true, keys: [] };
    const row = (data || []).find(item => item.name === name);
    activeName = name;
    keys = Array.isArray(row?.instrument_keys)
      ? row.instrument_keys.filter((key, index, all) => typeof key === "string" && key.length > 0 && all.indexOf(key) === index).slice(0, 50)
      : [];
    revision++;
    return { stale: false, keys: [...keys], unknownKeys: keys.filter(key => !allowed.has(key)) };
  }

  function persist(nextKeys, expectedUserId = userId) {
    if (!expectedUserId || expectedUserId !== userId) return Promise.reject(new Error("Account changed; save cancelled."));
    if (!Array.isArray(nextKeys) || nextKeys.length > 50 || nextKeys.some(key => typeof key !== "string" || !key)) {
      return Promise.reject(new Error("Watchlists allow up to 50 valid instrument keys."));
    }
    const uniqueKeys = [...new Set(nextKeys)];
    const snapshot = uniqueKeys.filter(key => allowed.has(key));
    const discardedKeys = uniqueKeys.length - snapshot.length;
    const listName = activeName;
    const currentRevision = ++revision;
    const generation = sessionGeneration;
    keys = snapshot;
    const task = async () => {
      if (expectedUserId !== userId || generation !== sessionGeneration) throw new Error("Account changed; save cancelled.");
      const { error } = await supabase.from("paper_watchlists").upsert({
        user_id: expectedUserId,
        name: listName,
        instrument_keys: snapshot,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,name" });
      if (error) throw error;
      if (expectedUserId !== userId || generation !== sessionGeneration || currentRevision !== revision) return { stale: true, keys: [...keys], discardedKeys };
      return { stale: false, keys: [...keys], discardedKeys };
    };
    saveQueue = saveQueue.catch(() => undefined).then(task);
    return saveQueue;
  }

  async function mutate(nextKeys) {
    return persist(nextKeys);
  }

  return {
    names,
    get userId() { return userId; },
    get activeName() { return activeName; },
    get keys() { return [...keys]; },
    reset,
    load,
    mutate,
    setActiveName(name) {
      if (!names.includes(name)) throw new Error("Invalid watchlist name.");
      activeName = name;
      requestVersion++;
    }
  };
}

export async function mountPrivateWatchlists(host, { model, el, field, selectControl, money }) {
  const panel = el("section", "catalog-panel");
  const title = el("h3", "", "Private Watchlists");
  const intro = el("p", "sub", "Sign in with your ZENURA Supabase account. Lists are private to your authenticated account.");
  const authForm = el("form", "catalog-controls");
  const email = el("input"); email.type = "email"; email.autocomplete = "username"; email.required = true; email.placeholder = "Email address"; email.setAttribute("aria-label", "Email address");
  const password = el("input"); password.type = "password"; password.autocomplete = "current-password"; password.required = true; password.minLength = 8; password.placeholder = "Password"; password.setAttribute("aria-label", "Password");
  const signIn = el("button", "catalog-add", "SIGN IN"); signIn.type = "submit";
  const signUp = el("button", "catalog-action", "CREATE ACCOUNT"); signUp.type = "button";
  const signOut = el("button", "catalog-action", "SIGN OUT"); signOut.type = "button"; signOut.hidden = true;
  authForm.append(field("Email", email), field("Password", password), signIn, signUp, signOut);
  const authStatus = el("p", "sub", "Checking sign-in status…");
  const controls = el("div", "catalog-controls");
  const listSelect = selectControl("private-watchlist-select", ["My Stocks", "Banking", "NIFTY", "F&O"].map(x => [x, x]));
  const search = el("input"); search.type = "search"; search.placeholder = "Filter saved instruments"; search.setAttribute("aria-label", "Filter saved instruments");
  const sort = selectControl("private-watchlist-sort", [["manual", "Manual order"], ["symbol-asc", "Symbol A–Z"], ["symbol-desc", "Symbol Z–A"], ["price-desc", "Price high–low"], ["price-asc", "Price low–high"]]);
  const instrument = selectControl("private-watchlist-instrument", model.market.instruments.map(x => [x.instrumentKey, x.symbol + " · " + x.exchange + " · " + x.assetClass]));
  const add = el("button", "catalog-add", "ADD MOCK"); add.type = "button";
  controls.append(field("Watchlist", listSelect), field("Filter", search), field("Sort", sort), field("Add from canonical MOCK catalog", instrument), add);
  const listStatus = el("p", "sub", "");
  const rowsHost = el("div", "catalog-results");
  panel.append(title, intro, authForm, authStatus, controls, listStatus, rowsHost);
  host.append(panel);

  let supabase, controller, currentUid = null, authSubscription = null, busy = false;
  const catalog = new Map(model.market.instruments.map(item => [item.instrumentKey, item]));
  const setBusy = value => { busy = value; add.disabled = value || !currentUid; signIn.disabled = value; signUp.disabled = value; };
  const showSignedOut = message => {
    currentUid = null;
    controller?.reset(null);
    password.value = "";
    email.hidden = false; password.hidden = false; signIn.hidden = false; signUp.hidden = false; signOut.hidden = true;
    controls.hidden = true; listStatus.textContent = ""; rowsHost.replaceChildren();
    authStatus.textContent = message;
    setBusy(false);
  };
  const renderRows = () => {
    const raw = controller?.keys || [];
    const known = raw.map((key, index) => ({ key, index, item: catalog.get(key) }));
    const query = search.value.trim().toLowerCase();
    let visible = known.filter(row => !query || (row.item && [row.item.symbol, row.item.exchange, row.item.assetClass].join(" ").toLowerCase().includes(query)) || row.key.toLowerCase().includes(query));
    if (sort.value === "symbol-asc") visible.sort((a,b) => (a.item?.symbol || a.key).localeCompare(b.item?.symbol || b.key));
    if (sort.value === "symbol-desc") visible.sort((a,b) => (b.item?.symbol || b.key).localeCompare(a.item?.symbol || a.key));
    if (sort.value === "price-desc") visible.sort((a,b) => (b.item?.lastPricePaise || 0) - (a.item?.lastPricePaise || 0));
    if (sort.value === "price-asc") visible.sort((a,b) => (a.item?.lastPricePaise || 0) - (b.item?.lastPricePaise || 0));
    listStatus.textContent = raw.length + " / 50 saved · " + visible.length + " shown · private account data";
    const tableWrap = el("div", "table-wrap"); tableWrap.tabIndex = 0; tableWrap.setAttribute("role", "region"); tableWrap.setAttribute("aria-label", "Private watchlist instruments");
    const table = el("table"), head = el("thead"), header = el("tr"), body = el("tbody");
    ["SYMBOL", "EXCHANGE", "TYPE", "MOCK PRICE", "ORDER", "REMOVE"].forEach(label => header.append(el("th", "", label)));
    head.append(header);
    if (!visible.length) {
      const tr = el("tr"), td = el("td", "empty", raw.length ? "No instruments match this filter." : "This private watchlist is empty. Add a MOCK instrument to begin.");
      td.colSpan = 6; tr.append(td); body.append(tr);
    }
    for (const row of visible) {
      const tr = el("tr"), item = row.item;
      [item?.symbol || "Unavailable saved key", item?.exchange || "—", item?.assetClass || "—", item ? money(item.lastPricePaise) : "—"].forEach(value => tr.append(el("td", "", value)));
      const orderCell = el("td");
      const up = el("button", "catalog-action", "↑"); up.type = "button"; up.disabled = busy || sort.value !== "manual" || row.index === 0; up.setAttribute("aria-label", "Move " + (item?.symbol || row.key) + " up");
      up.addEventListener("click", () => updateOrder(row.index, -1));
      const down = el("button", "catalog-action", "↓"); down.type = "button"; down.disabled = busy || sort.value !== "manual" || row.index === raw.length - 1; down.setAttribute("aria-label", "Move " + (item?.symbol || row.key) + " down");
      down.addEventListener("click", () => updateOrder(row.index, 1));
      orderCell.append(up, down); tr.append(orderCell);
      const removeCell = el("td"), remove = el("button", "catalog-action", "REMOVE"); remove.type = "button"; remove.disabled = busy;
      remove.addEventListener("click", async () => {
        await saveKeys(raw.filter(key => key !== row.key));
      });
      removeCell.append(remove); tr.append(removeCell); body.append(tr);
    }
    table.append(head, body); tableWrap.append(table); rowsHost.replaceChildren(tableWrap);
    add.disabled = busy || !currentUid || !instrument.value || raw.includes(instrument.value) || raw.length >= 50;
  };
  async function saveKeys(next) {
    if (!controller || !currentUid || busy) return;
    const uid = currentUid;
    setBusy(true);
    try {
      const result = await controller.mutate(next);
      if (uid !== currentUid) return;
      authStatus.textContent = result?.discardedKeys
        ? "Saved securely. " + result.discardedKeys + " non-canonical saved key(s) were omitted."
        : "Saved securely to your private Supabase watchlist.";
    } catch (error) {
      if (uid === currentUid) {
        authStatus.textContent = error?.message || "Save failed. Your saved list was not confirmed.";
        try { await controller.load(listSelect.value); } catch (_) {}
      }
    } finally {
      if (uid === currentUid) { setBusy(false); renderRows(); }
    }
  }
  async function loadList(name) {
    if (!controller || !currentUid) return;
    const uid = currentUid;
    setBusy(true); listStatus.textContent = "Loading private watchlist…";
    try {
      controller.setActiveName(name);
      const result = await controller.load(name);
      if (result.stale || uid !== currentUid) return;
      const unknown = result.unknownKeys?.length || 0;
      authStatus.textContent = unknown ? unknown + " saved instrument key(s) are outside the current MOCK catalog and will be omitted on the next save." : "Private watchlist loaded.";
      renderRows();
    } catch (error) {
      if (uid === currentUid) {
        listStatus.textContent = "Could not load this private watchlist.";
        authStatus.textContent = error?.message || "Load failed. Check your connection and retry.";
        rowsHost.replaceChildren();
      }
    } finally { if (uid === currentUid) setBusy(false); }
  }
  try {
    ({ supabase } = await import("./supabase-client.js"));
    controller = createPrivateWatchlistController({ supabase, catalogKeys: [...catalog.keys()] });
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const session = data?.session;
    if (session?.user?.id) {
      currentUid = session.user.id; controller.reset(currentUid);
      email.hidden = true; password.hidden = true; signIn.hidden = true; signUp.hidden = true; signOut.hidden = false; controls.hidden = false;
      authStatus.textContent = "Signed in. Loading your private lists…";
      await loadList(listSelect.value);
    } else showSignedOut("Sign in to access private watchlists. Your demo data stays separate.");
    const listener = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUid = nextSession?.user?.id || null;
      if (nextUid === currentUid) return;
      currentUid = nextUid;
      if (!nextUid) { showSignedOut("Signed out. Private list data cleared from this screen."); return; }
      controller.reset(nextUid);
      email.hidden = true; password.hidden = true; signIn.hidden = true; signUp.hidden = true; signOut.hidden = false; controls.hidden = false;
      authStatus.textContent = "Account changed. Loading private watchlists…";
      queueMicrotask(() => { if (currentUid === nextUid) void loadList(listSelect.value); });
    });
    authSubscription = listener?.data?.subscription;
  } catch (error) {
    showSignedOut("Authentication service unavailable: " + (error?.message || "Please retry later."));
    controls.hidden = true;
  }
  authForm.addEventListener("submit", async event => {
    event.preventDefault(); if (!supabase || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) throw error;
      authStatus.textContent = "Signed in successfully. Loading private watchlists…";
    } catch (error) { authStatus.textContent = error?.message || "Sign in failed."; }
    finally { setBusy(false); }
  });
  signUp.addEventListener("click", async () => {
    if (!supabase || busy || !email.value.trim() || password.value.length < 8) {
      authStatus.textContent = "Enter an email and a password of at least 8 characters."; return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.value.trim(), password: password.value, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      authStatus.textContent = data?.session ? "Account created and signed in." : "Account created. Confirm your email, then sign in.";
    } catch (error) { authStatus.textContent = error?.message || "Account creation failed."; }
    finally { setBusy(false); }
  });
  signOut.addEventListener("click", async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try { const { error } = await supabase.auth.signOut(); if (error) throw error; }
    catch (error) { authStatus.textContent = error?.message || "Sign out failed."; }
    finally { setBusy(false); }
  });
  listSelect.addEventListener("change", () => void loadList(listSelect.value));
  search.addEventListener("input", renderRows);
  sort.addEventListener("change", renderRows);
  instrument.addEventListener("change", renderRows);
  add.addEventListener("click", () => {
    const next = [...(controller?.keys || [])];
    if (instrument.value && catalog.has(instrument.value) && !next.includes(instrument.value) && next.length < 50) next.push(instrument.value);
    void saveKeys(next);
  });
  async function updateOrder(index, delta) {
    const next = [...(controller?.keys || [])], target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await saveKeys(next);
  }
  return () => {
    authSubscription?.unsubscribe?.();
    currentUid = null;
    controller?.reset(null);
    password.value = "";
    rowsHost.replaceChildren();
  };
}
