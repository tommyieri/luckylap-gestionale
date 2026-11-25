const playbackPreferences = new WeakMap();
const mountedScenes = new WeakMap();
const videoOwners = new WeakMap();

export function embroideryStoryMarkup() {
  return `<section class="embroidery-story" aria-labelledby="motion-title" data-embroidery-story>
    <div class="embroidery-stage">
      <div class="embroidery-video-media" aria-hidden="true">
        <picture class="embroidery-video-poster" data-embroidery-poster><source media="(max-width: 600px)" srcset="/media/hero-ricami-mobile-poster.webp"><img src="/media/hero-ricami-poster.webp" alt="" width="1920" height="1080" fetchpriority="high" decoding="async"></picture>
        <video id="embroidery-hero-video" class="embroidery-hero-video" data-embroidery-video data-src="/media/hero-ricami.mp4" data-mobile-src="/media/hero-ricami-mobile.mp4" data-poster="/media/hero-ricami-poster.webp" data-mobile-poster="/media/hero-ricami-mobile-poster.webp" poster="/media/hero-ricami-poster.webp" width="1920" height="1080" muted autoplay loop playsinline preload="none" tabindex="-1"></video>
      </div>
      <div class="motion-copy">
        <h1 id="motion-title">La passione prende vita.</h1>
        <p>T-shirt con ricami a macchina realizzati in Italia.</p>
        <div class="motion-actions"><a class="btn btn-light" href="#collezione">Esplora le T-shirt <svg aria-hidden="true"><use href="/icons.svg#arrow"></use></svg></a></div>
      </div>
      <button class="embroidery-video-toggle" type="button" aria-controls="embroidery-hero-video" aria-label="Riproduci il video dei ricami" data-embroidery-video-toggle hidden><span aria-hidden="true" data-embroidery-video-icon>▶</span><span data-embroidery-video-label>Riproduci</span></button>
      <p class="embroidery-video-status" role="status" aria-live="polite" data-embroidery-video-status></p>
    </div>
  </section>`;
}

export function mountEmbroideryScene(root, { labels = {} } = {}) {
  const story = root?.matches?.("[data-embroidery-story]")
    ? root
    : root?.querySelector?.("[data-embroidery-story]");
  if (!story) return () => {};
  mountedScenes.get(story)?.();
  const video = story.querySelector("[data-embroidery-video]");
  const button = story.querySelector("[data-embroidery-video-toggle]");
  const buttonLabel = story.querySelector("[data-embroidery-video-label]");
  const buttonIcon = story.querySelector("[data-embroidery-video-icon]");
  const status = story.querySelector("[data-embroidery-video-status]");
  if (!video || !button || !buttonLabel || !buttonIcon || !status) return () => {};
  const doc = story.ownerDocument;
  const view = doc.defaultView;
  const reduce = view.matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = view.matchMedia("(max-width: 600px)");
  const connection =
    view.navigator.connection || view.navigator.mozConnection || view.navigator.webkitConnection;
  const remembered = playbackPreferences.get(root) || {
    pausedByUser: false,
    motionAllowedByUser: false,
  };
  const currentRestriction = reduce.matches || Boolean(connection?.saveData);
  if (currentRestriction && !remembered.lastRestriction) remembered.motionAllowedByUser = false;
  remembered.lastRestriction = currentRestriction;
  playbackPreferences.set(root, remembered);
  const owner = {};
  videoOwners.set(video, owner);
  let disposed = false;
  let inView = false;
  let restricted = currentRestriction;
  let playPending = false;
  let playAttempt = 0;
  let blocked = false;
  let failed = false;
  let hasFrame = false;
  let forcePoster = restricted;
  let observer;
  const text = {
    pause: labels.pauseVideo || "Pausa",
    pauseLabel: labels.pauseVideoLabel || "Metti in pausa il video dei ricami",
    play: labels.playVideo || "Riproduci",
    playLabel: labels.playVideoLabel || "Riproduci il video dei ricami",
    retry: labels.retryVideo || "Riprova",
    unavailable:
      labels.videoUnavailable || "Il video non è disponibile. Puoi esplorare le T-shirt.",
  };

  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = false;
  button.hidden = false;

  function shouldPlay() {
    return (
      !disposed &&
      inView &&
      !doc.hidden &&
      !remembered.pausedByUser &&
      (!restricted || remembered.motionAllowedByUser) &&
      !blocked &&
      !failed
    );
  }
  function render() {
    const playing = !video.paused && !video.ended && !failed;
    story.dataset.videoState = failed
      ? "unavailable"
      : playing
        ? "playing"
        : blocked
          ? "blocked"
          : "paused";
    story.classList.toggle("has-video-frame", hasFrame && !forcePoster && !failed);
    buttonLabel.textContent = playing || playPending ? text.pause : failed ? text.retry : text.play;
    buttonIcon.textContent = playing || playPending ? "Ⅱ" : "▶";
    button.setAttribute("aria-label", playing || playPending ? text.pauseLabel : text.playLabel);
    status.textContent = failed ? text.unavailable : "";
  }
  function pause() {
    playAttempt++;
    playPending = false;
    video.pause();
    render();
  }
  function sourceReady() {
    if (video.getAttribute("src")) return true;
    const source =
      mobile.matches && video.dataset.mobileSrc ? video.dataset.mobileSrc : video.dataset.src;
    if (!source) {
      failed = true;
      render();
      return false;
    }
    video.preload = "auto";
    video.src = source;
    return true;
  }
  function sync() {
    if (!shouldPlay()) {
      pause();
      return;
    }
    if (playPending || !video.paused || !sourceReady()) {
      render();
      return;
    }
    const attempt = ++playAttempt;
    playPending = true;
    render();
    let promise;
    try {
      promise = video.play();
    } catch {
      promise = Promise.reject();
    }
    Promise.resolve(promise).then(
      () => {
        if (disposed || attempt !== playAttempt) {
          if (!videoOwners.has(video) || videoOwners.get(video) === owner) {
            if (!shouldPlay()) video.pause();
          }
          return;
        }
        playPending = false;
        if (!shouldPlay()) video.pause();
        render();
      },
      () => {
        if (disposed || attempt !== playAttempt) return;
        playPending = false;
        blocked = true;
        video.pause();
        render();
      },
    );
  }
  function onPlaying() {
    if (!shouldPlay()) {
      pause();
      return;
    }
    hasFrame = true;
    forcePoster = false;
    render();
  }
  function onPause() {
    if (!disposed) render();
  }
  function onError() {
    failed = true;
    forcePoster = true;
    pause();
  }
  function toggle() {
    if (!video.paused || playPending) {
      remembered.pausedByUser = true;
      pause();
      return;
    }
    remembered.pausedByUser = false;
    remembered.motionAllowedByUser = true;
    blocked = false;
    const reload = failed;
    failed = false;
    if (reload) {
      video.removeAttribute("src");
      video.load();
    }
    sync();
  }
  function onVisibility() {
    sync();
  }
  function onFormatChange() {
    pause();
    failed = false;
    hasFrame = false;
    forcePoster = true;
    video.removeAttribute("src");
    video.load();
    video.poster =
      mobile.matches && video.dataset.mobilePoster
        ? video.dataset.mobilePoster
        : video.dataset.poster || video.poster;
    sync();
  }
  function onPolicyChange() {
    const next = reduce.matches || Boolean(connection?.saveData);
    if (next && !restricted) {
      remembered.motionAllowedByUser = false;
      forcePoster = true;
    }
    restricted = next;
    remembered.lastRestriction = next;
    sync();
  }
  function measureVisibility() {
    const rect = story.getBoundingClientRect();
    inView = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < view.innerHeight;
    sync();
  }

  button.addEventListener("click", toggle);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("pause", onPause);
  video.addEventListener("error", onError);
  doc.addEventListener("visibilitychange", onVisibility);
  if (reduce.addEventListener) reduce.addEventListener("change", onPolicyChange);
  else reduce.addListener(onPolicyChange);
  connection?.addEventListener?.("change", onPolicyChange);
  if (mobile.addEventListener) mobile.addEventListener("change", onFormatChange);
  else mobile.addListener(onFormatChange);
  video.poster =
    mobile.matches && video.dataset.mobilePoster
      ? video.dataset.mobilePoster
      : video.dataset.poster || video.poster;
  if (view.IntersectionObserver) {
    observer = new view.IntersectionObserver(
      (entries) => {
        if (disposed) return;
        inView = entries.some(
          (entry) => entry.target === story && entry.isIntersecting && entry.intersectionRatio > 0,
        );
        sync();
      },
      { threshold: [0, 0.01] },
    );
    observer.observe(story);
  } else {
    view.addEventListener("scroll", measureVisibility, { passive: true });
    view.addEventListener("resize", measureVisibility, { passive: true });
  }
  render();
  measureVisibility();

  function cleanup() {
    if (disposed) return;
    disposed = true;
    playAttempt++;
    observer?.disconnect();
    button.removeEventListener("click", toggle);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("error", onError);
    doc.removeEventListener("visibilitychange", onVisibility);
    if (reduce.removeEventListener) reduce.removeEventListener("change", onPolicyChange);
    else reduce.removeListener(onPolicyChange);
    connection?.removeEventListener?.("change", onPolicyChange);
    if (mobile.removeEventListener) mobile.removeEventListener("change", onFormatChange);
    else mobile.removeListener(onFormatChange);
    view.removeEventListener("scroll", measureVisibility);
    view.removeEventListener("resize", measureVisibility);
    if (videoOwners.get(video) === owner) {
      videoOwners.delete(video);
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (mountedScenes.get(story) === cleanup) mountedScenes.delete(story);
  }
  mountedScenes.set(story, cleanup);
  return cleanup;
}
