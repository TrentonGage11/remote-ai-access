const statusEl = document.getElementById("media-status");
const videoEl = document.getElementById("shared-video");

async function prepareSharedVideo() {
  const contentUrl = String(videoEl?.dataset.contentUrl || "");
  if (!statusEl || !videoEl || !contentUrl) return;

  for (;;) {
    const response = await fetch(contentUrl, { method: "HEAD" });
    if (response.ok) {
      videoEl.src = contentUrl;
      statusEl.remove();
      return;
    }
    if (response.status !== 202) {
      statusEl.textContent = "Video preparation failed.";
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

prepareSharedVideo().catch(() => {
  if (statusEl) statusEl.textContent = "Video preparation failed.";
});