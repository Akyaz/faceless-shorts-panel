import { ApiError, LONGFORM_WORKFLOW, REUPLOAD_WORKFLOW, WORKFLOWS, createClient } from "./api.js";

const STORAGE_KEY = "faceless-shorts-panel";
const MODES = {
  story: "Gündem haberi",
  world: "Dünya haberi (İngilizce)",
  trend: "Trend (bilim ve teknoloji)",
  digest: "Günün özeti",
  morning: "Sabah özeti",
  sports: "Spor gündemi",
  ucl: "Şampiyonlar Ligi maç programı",
  custom: "Özel metin",
  weekly: "Haftalık derleme",
  longform: "Tarih videosu",
  retry: "Yeniden yükleme",
};
const REFRESH_MS = 30000;
const VIEWS = ["status", "produce", "script", "settings"];
const DRAFT_KEY = "faceless-shorts-panel-draft";
const SCRIPT_FIELDS = ["lang", "title", "hook", "label", "text", "sources", "country", "city", "queries", "object", "mood", "tags"];

const $ = (id) => document.getElementById(id);
let client = null;
let refreshTimer = null;
let privacy = "public"; // yeniden yükleme de güncel görünürlük ayarıyla yapılır

// ---------- ayarlar

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null; // gizli pencerede depolama kapalı olabilir
  }
}

function saveSettings(settings) {
  try {
    if (settings) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    toast("Tarayıcı ayarları saklamaya izin vermiyor; her açılışta yeniden girmen gerekir.");
  }
}

// ---------- küçük yardımcılar

function toast(text) {
  const box = $("toast");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (box.hidden = true), 9000);
}

function explain(error) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Erişim anahtarı geçersiz ya da süresi dolmuş.";
    if (error.status === 403) {
      return "Anahtarın bu işlem için izni yok. GitHub'da anahtarın izinlerinde Actions ve Variables \"Read and write\" olmalı.";
    }
    if (error.status === 404) return "Depo bulunamadı ya da anahtar bu depoyu göremiyor.";
    return `GitHub hatası (${error.status}): ${error.message}`;
  }
  return "Bağlantı kurulamadı. İnternetini kontrol et.";
}

function when(iso) {
  return new Date(iso).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(text, href) {
  const node = element("a", null, text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener";
  return node;
}

async function guarded(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    toast(explain(error));
  } finally {
    button.disabled = false;
  }
}

// ---------- ekranlar

function show(view) {
  for (const name of VIEWS) {
    $(`view-${name}`).hidden = name !== view;
    $(`tab-${name}`).classList.toggle("active", name === view);
  }
}

function renderFeed(feed) {
  const list = $("feed");
  list.replaceChildren();
  if (!feed.length) {
    list.append(element("li", "empty", "Henüz kayıt yok. İlk video üretildiğinde burada görünecek."));
    return;
  }
  const uploaded = new Set(
    feed.filter((e) => e.videos.length && e.videos.every((video) => video.url)).map((e) => String(e.run)),
  );
  for (const entry of feed.slice(-15).reverse()) {
    const item = element("li");
    const head = element("div", "meta", `${when(entry.time)} · ${MODES[entry.mode] || entry.mode}`);
    item.append(head);
    for (const video of entry.videos) {
      const row = element("div", "video");
      if (video.url) row.append(link(video.title, video.url));
      else row.append(element("span", null, video.title), element("span", "badge", "yüklenmedi"));
      item.append(row);
    }
    if (entry.status !== "success") {
      const failed = element("div", "video");
      failed.append(element("span", "badge bad", "başarısız"), link("kaydı aç", entry.link));
      item.append(failed);
    }
    // Video üretilmiş ama yüklenmemişse (YouTube'un günlük sınırı ya da bilerek yüklemeden üretilmiş) dosyası
    // duruyor demektir; aynı çalışma sonradan yüklendiyse düğme gösterilmez
    if (entry.videos.some((video) => !video.url) && !uploaded.has(String(entry.run))) {
      item.append(reuploadButton(entry));
    }
    list.append(item);
  }
}

function reuploadButton(entry) {
  // Tarih videolarının dosyası saklanmaz; metinden yeniden üretilip yüklenir (yaklaşık 20 dakika)
  const longform = entry.mode === "longform" && entry.script;
  const button = element("button", "small", longform ? "Yeniden üret ve yükle" : "Kanala yükle");
  button.type = "button";
  button.addEventListener("click", () => {
    const pending = entry.videos.filter((video) => !video.url).length;
    const question = longform
      ? "Tarih videosu yeniden üretilip kanala yüklensin mi? Yaklaşık 20 dakika sürer; YouTube'un günlük sınırı doluysa yine reddedilir."
      : `${pending} video şimdi kanala yüklensin mi? YouTube'un günlük sınırı doluysa yine reddedilir.`;
    if (!confirm(question)) return;
    guarded(button, async () => {
      if (longform) await client.dispatch(LONGFORM_WORKFLOW, { script: entry.script, upload: true });
      else await client.dispatch(REUPLOAD_WORKFLOW, { run_id: entry.run, privacy });
      toast(longform ? "Üretim başlatıldı; yaklaşık 20 dakika sürer." : "Yükleme başlatıldı. Bir iki dakika içinde sonucu burada görünür.");
      setTimeout(refresh, 6000);
    });
  });
  return button;
}

function renderRuns(runs) {
  const list = $("runs");
  list.replaceChildren();
  for (const run of runs) {
    const state = run.status !== "completed" ? "busy" : run.conclusion === "success" ? "ok" : "bad";
    const label = { busy: "çalışıyor", ok: "başarılı", bad: "başarısız" }[state];
    const item = element("li");
    const row = element("div", "run");
    row.append(element("span", `dot ${state}`));
    row.append(link(`${run.name} · ${run.event === "schedule" ? "zamanlanmış" : "elle"}`, run.html_url));
    item.append(row, element("div", "meta", `${when(run.created_at)} · ${label}`));
    list.append(item);
  }
  return runs.some((run) => run.status !== "completed");
}

async function refresh() {
  if (!client) return;
  clearTimeout(refreshTimer);
  try {
    const [workflow, currentPrivacy, runs, feed] = await Promise.all([
      client.workflow(WORKFLOWS.short),
      client.privacy(),
      client.runs(),
      client.feed(),
    ]);
    const enabled = workflow.state === "active";
    $("auto-state").textContent = enabled ? "Açık" : "Durduruldu";
    $("auto-toggle").textContent = enabled ? "Durdur" : "Başlat";
    $("auto-toggle").dataset.enabled = enabled;
    privacy = currentPrivacy;
    const isPublic = privacy === "public";
    $("privacy-state").textContent = isPublic ? "Herkese açık" : "Gizli";
    $("privacy-toggle").textContent = isPublic ? "Gizliye çevir" : "Herkese aç";
    $("privacy-toggle").dataset.public = isPublic;
    renderFeed(feed);
    const busy = renderRuns(runs);
    $("updated").textContent = `Güncellendi: ${when(new Date().toISOString())}`;
    // Çalışan iş varken sık, yokken seyrek yenilenir
    refreshTimer = setTimeout(refresh, busy ? REFRESH_MS : REFRESH_MS * 4);
  } catch (error) {
    toast(explain(error));
  }
}

// ---------- eylemler

function bind() {
  for (const name of VIEWS) {
    $(`tab-${name}`).addEventListener("click", () => show(name));
  }
  $("refresh").addEventListener("click", (event) => guarded(event.currentTarget, refresh));

  $("auto-toggle").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const enable = button.dataset.enabled !== "true";
    if (!enable && !confirm("Otomatik video üretimi ve haftalık derleme durdurulsun mu?")) return;
    guarded(button, async () => {
      await Promise.all(Object.values(WORKFLOWS).map((file) => client.setWorkflowEnabled(file, enable)));
      await refresh();
      toast(enable ? "Otomatik yayın başlatıldı." : "Otomatik yayın durduruldu.");
    });
  });

  $("privacy-toggle").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const makePublic = button.dataset.public !== "true";
    if (makePublic && !confirm("Bundan sonraki videolar herkese açık yüklensin mi?")) return;
    guarded(button, async () => {
      await client.setPrivacy(makePublic ? "public" : "private");
      await refresh();
      toast(makePublic ? "Yeni videolar herkese açık yüklenecek." : "Yeni videolar gizli yüklenecek.");
    });
  });

  $("produce-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = $("mode").value;
    const count = $("count").value;
    const upload = $("upload").checked;
    const summary = `${count} × ${MODES[mode]}`;
    if (upload && !confirm(`${summary} üretilip kanala yüklenecek. Onaylıyor musun?`)) return;
    guarded($("produce-button"), async () => {
      await client.dispatch(WORKFLOWS.short, { mode, count, upload });
      toast(`${summary} başlatıldı. Birkaç dakika içinde Durum ekranında görünür.`);
      show("status");
      setTimeout(refresh, 4000);
    });
  });

  $("weekly-button").addEventListener("click", (event) => {
    const upload = $("upload").checked;
    if (!confirm(`Haftalık derleme üretilsin mi?${upload ? " Bitince kanala yüklenecek." : ""}`)) return;
    guarded(event.currentTarget, async () => {
      await client.dispatch(WORKFLOWS.weekly, { upload });
      toast("Haftalık derleme başlatıldı; yaklaşık 10 dakika sürer.");
      show("status");
      setTimeout(refresh, 4000);
    });
  });

  bindScript();

  $("longform-button").addEventListener("click", (event) => {
    const upload = $("upload").checked;
    if (!confirm(`Sıradaki tarih videosu üretilsin mi?${upload ? " Bitince kanala yüklenecek." : ""} Yaklaşık 20 dakika sürer.`)) return;
    guarded(event.currentTarget, async () => {
      await client.dispatch(LONGFORM_WORKFLOW, { upload });
      toast("Tarih videosu başlatıldı; yaklaşık 20 dakika sürer.");
      show("status");
      setTimeout(refresh, 4000);
    });
  });

  $("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const [owner, repo] = $("repo").value.trim().split("/");
    const token = $("token").value.trim();
    if (!owner || !repo || !token) {
      toast("Depoyu sahip/ad biçiminde yaz ve anahtarı gir.");
      return;
    }
    guarded($("settings-save"), async () => {
      const candidate = createClient({ owner, repo, token });
      await candidate.repository(); // yanlış anahtar kaydedilmesin
      client = candidate;
      saveSettings({ owner, repo, token });
      $("token").value = "";
      toast("Bağlantı kuruldu.");
      show("status");
      await refresh();
    });
  });

  $("sign-out").addEventListener("click", () => {
    if (!confirm("Anahtar bu cihazdan silinsin mi?")) return;
    saveSettings(null);
    client = null;
    clearTimeout(refreshTimer);
    show("settings");
    toast("Anahtar silindi.");
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}

// ---------- kendi metninle video

const split = (value) => value.split(",").map((part) => part.trim()).filter(Boolean);

function readScript() {
  const value = (name) => $(`s-${name}`).value.trim();
  const paragraphs = value("text").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sources = value("sources")
    .split(/\n+/)
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter(([title]) => title)
    .map(([title, source = ""]) => ({ title, source }));
  const english = value("lang") === "en";
  return {
    lang: value("lang"),
    title: value("title"),
    hook_title: value("hook"),
    label: value("label") || (english ? "NEWS" : "GÜNDEM"),
    paragraphs,
    sources,
    country: value("country"),
    city: value("city"),
    image_queries: split(value("queries")),
    object_query: value("object"),
    mood: value("mood"),
    hashtags: split(value("tags")),
  };
}

function saveDraft() {
  try {
    const draft = Object.fromEntries(SCRIPT_FIELDS.map((name) => [name, $(`s-${name}`).value]));
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // taslak saklanamazsa form yine çalışır
  }
}

function countWords() {
  const words = $("s-text").value.split(/\s+/).filter(Boolean).length;
  // Konuşma hızıyla yaklaşık süre: dakikada 160 kelime
  $("s-count").textContent = words ? `${words} kelime, yaklaşık ${Math.round((words / 160) * 60)} saniye` : "";
}

function bindScript() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY)) || {};
    for (const name of SCRIPT_FIELDS) if (draft[name] !== undefined) $(`s-${name}`).value = draft[name];
  } catch {
    // taslak yoksa boş form
  }
  countWords();
  $("script-form").addEventListener("input", () => {
    saveDraft();
    countWords();
  });

  $("script-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const item = readScript();
    if (item.paragraphs.length < 2) return toast("Metin en az iki paragraf olmalı (her paragraf ayrı satırda).");
    if (!item.sources.length) return toast("En az bir kaynak başlık yaz: Başlık | Yayın adı");
    if (!item.image_queries.length && !item.country && !item.object_query) {
      return toast("Görsel bulunabilmesi için ülke ya da görsel araması gir.");
    }
    const upload = $("s-upload").checked;
    if (!confirm(upload ? "Video üretilip kanala yüklenecek. Onaylıyor musun?" : "Video üretilsin mi?")) return;
    guarded($("script-button"), async () => {
      await client.dispatch(WORKFLOWS.short, { script_json: JSON.stringify([item]), upload });
      toast("Üretim başlatıldı; birkaç dakika içinde Durum ekranında görünür.");
      show("status");
      setTimeout(refresh, 4000);
    });
  });
}

function start() {
  bind();
  const settings = loadSettings();
  if (settings) {
    client = createClient(settings);
    $("repo").value = `${settings.owner}/${settings.repo}`;
    show("status");
    refresh();
  } else {
    show("settings");
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
