const API_BASE_URL = "https://ai-research-assistance.onrender.com";
const POLL_INTERVAL = 1500;

const state = {
  jobId: null,
  pollTimer: null,
  running: false,
  lastResult: null
};

const $ = (id) => document.getElementById(id);

const topicInput = $("topicInput");
const startBtn = $("startBtn");
const pipelineSection = $("pipelineSection");
const resultSection = $("resultSection");
const errorCard = $("errorCard");
const progressFill = $("progressFill");
const progressNumber = $("progressNumber");
const currentMessage = $("currentMessage");
const toast = $("toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

function setAgentState(agent, status) {
  const card = document.querySelector(`[data-agent-card="${agent}"]`);
  const mini = document.querySelector(`[data-agent="${agent}"]`);

  if (card) {
    card.classList.remove("running", "completed", "failed");
    card.classList.add(status.toLowerCase());
    const statusEl = card.querySelector("[data-status]");
    if (statusEl) {
      statusEl.textContent =
        status === "completed" ? "Completed" :
        status === "running" ? "Running" :
        status === "failed" ? "Failed" : "Waiting";
    }
  }

  if (mini) {
    mini.classList.remove("running", "completed", "failed");
    mini.classList.add(status.toLowerCase());
  }
}

function resetAgents() {
  ["Search Agent", "Reader Agent", "Writer", "Critic"].forEach(agent => {
    setAgentState(agent, "waiting");
  });
}

function updateProgress(data) {
  const progress = Number(data.progress || 0);
  progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  progressNumber.textContent = `${progress}%`;
  currentMessage.textContent = data.message || data.step || "Working...";

  const step = data.step || "";

  if (step.includes("Search")) {
    setAgentState("Search Agent", data.status === "completed" && progress >= 25 ? "completed" : "running");
  } else if (step.includes("Reader")) {
    setAgentState("Search Agent", "completed");
    setAgentState("Reader Agent", "running");
  } else if (step.includes("Writer")) {
    setAgentState("Search Agent", "completed");
    setAgentState("Reader Agent", "completed");
    setAgentState("Writer", "running");
  } else if (step.includes("Critic")) {
    setAgentState("Search Agent", "completed");
    setAgentState("Reader Agent", "completed");
    setAgentState("Writer", "completed");
    setAgentState("Critic", "running");
  } else if (step.includes("Completed")) {
    ["Search Agent", "Reader Agent", "Writer", "Critic"].forEach(a => setAgentState(a, "completed"));
  }
}

function formatReport(text) {
  if (!text) return "No report was returned.";
  return String(text)
    .replace(/\r\n/g, "\n")
    .trim();
}

async function startResearch() {
  const topic = topicInput.value.trim();

  if (topic.length < 3) {
    showToast("Please enter a research topic.");
    topicInput.focus();
    return;
  }

  if (state.running) return;

  state.running = true;
  state.jobId = null;
  startBtn.disabled = true;
  startBtn.querySelector("span:first-child").textContent = "Starting...";
  errorCard.classList.add("hidden");
  resultSection.classList.add("hidden");
  pipelineSection.classList.remove("hidden");
  resetAgents();
  progressFill.style.width = "0%";
  progressNumber.textContent = "0%";
  currentMessage.textContent = "Creating your research job...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Could not start research.");
    }

    state.jobId = data.job_id;
    showToast("Research started.");
    pollStatus();
  } catch (error) {
    finishWithError(error.message);
  }
}

async function pollStatus() {
  if (!state.jobId) return;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/research/${state.jobId}/status`,
      { cache: "no-store" }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Unable to read research status.");
    }

    updateProgress(data);

    if (data.status === "completed") {
      await loadResult();
      return;
    }

    if (data.status === "failed") {
      throw new Error(data.error || data.message || "Research pipeline failed.");
    }

    state.pollTimer = setTimeout(pollStatus, POLL_INTERVAL);
  } catch (error) {
    finishWithError(error.message);
  }
}

async function loadResult() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/research/${state.jobId}/result`,
      { cache: "no-store" }
    );

    const data = await response.json();

    if (!response.ok) {
      const detail = typeof data.detail === "object"
        ? data.detail.error || data.detail.message
        : data.detail;
      throw new Error(detail || "Unable to load research result.");
    }

    state.lastResult = data;
    renderResult(data);
    showToast("Research completed successfully.");
  } catch (error) {
    finishWithError(error.message);
  }
}

function renderResult(data) {
  pipelineSection.classList.add("hidden");
  resultSection.classList.remove("hidden");

  $("resultTitle").textContent = "Research Report";
  $("resultTopic").textContent = data.topic || "";

  $("searchStat").textContent =
    data.search_results ? "Available" : "Not returned";
  $("sourceStat").textContent =
    data.scraped_content ? "Available" : "Not returned";

  $("reportContent").textContent = formatReport(data.report);
  $("sourcesContent").textContent =
    `SEARCH RESULTS\n\n${formatReport(data.search_results)}\n\n` +
    `DETAILED SCRAPED CONTENT\n\n${formatReport(data.scraped_content)}`;
  $("feedbackContent").textContent = formatReport(data.feedback);

  ["Search Agent", "Reader Agent", "Writer", "Critic"].forEach(
    agent => setAgentState(agent, "completed")
  );

  progressFill.style.width = "100%";
  progressNumber.textContent = "100%";
  currentMessage.textContent = "Research completed successfully.";
}

function finishWithError(message) {
  clearTimeout(state.pollTimer);
  state.running = false;
  startBtn.disabled = false;
  startBtn.querySelector("span:first-child").textContent = "Start research";

  pipelineSection.classList.add("hidden");
  errorCard.classList.remove("hidden");
  $("errorMessage").textContent = message || "Something went wrong.";

  showToast("Research failed.");
}

function resetResearch() {
  clearTimeout(state.pollTimer);
  state.jobId = null;
  state.running = false;
  state.lastResult = null;
  topicInput.value = "";
  startBtn.disabled = false;
  startBtn.querySelector("span:first-child").textContent = "Start research";
  pipelineSection.classList.add("hidden");
  resultSection.classList.add("hidden");
  errorCard.classList.add("hidden");
  resetAgents();
  progressFill.style.width = "0%";
  progressNumber.textContent = "0%";
  currentMessage.textContent = "Preparing your research...";
  topicInput.focus();
}

async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`);
    const data = await response.json();

    if (response.ok && data.status === "healthy") {
      showToast("FastAPI backend is connected.");
    } else {
      throw new Error("Backend is not healthy.");
    }
  } catch (error) {
    showToast("Cannot reach FastAPI backend.");
  }
}

async function loadHistory() {
  const list = $("historyList");
  list.innerHTML = '<div class="empty-state">Loading history...</div>';

  try {
    const response = await fetch(`${API_BASE_URL}/api/research`);
    const items = await response.json();

    if (!response.ok || !Array.isArray(items) || items.length === 0) {
      list.innerHTML = '<div class="empty-state">No research jobs yet.</div>';
      return;
    }

    list.innerHTML = items.map(item => `
      <div class="history-item">
        <div>
          <div class="history-topic">${escapeHtml(item.topic)}</div>
          <div class="history-meta">${escapeHtml(item.job_id)} · ${escapeHtml(item.step)}</div>
        </div>
        <div class="history-status">${escapeHtml(item.status)}</div>
      </div>
    `).join("");
  } catch {
    list.innerHTML = '<div class="empty-state">Could not load history.</div>';
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.querySelectorAll(".example-chip").forEach(button => {
  button.addEventListener("click", () => {
    topicInput.value = button.textContent.trim();
    topicInput.focus();
  });
});

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".result-panel").forEach(p => p.classList.remove("active"));

    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    item.classList.add("active");

    const view = item.dataset.view;
    $("researchView").classList.toggle("hidden", view !== "research");
    $("historyView").classList.toggle("hidden", view !== "history");

    if (view === "history") loadHistory();
    $("sidebar").classList.remove("open");
  });
});

$("newResearchBtn").addEventListener("click", resetResearch);
$("newBtn").addEventListener("click", resetResearch);
$("startBtn").addEventListener("click", startResearch);
$("healthBtn").addEventListener("click", checkHealth);

$("copyBtn").addEventListener("click", async () => {
  const report = state.lastResult?.report || "";
  if (!report) {
    showToast("There is no report to copy.");
    return;
  }

  try {
    await navigator.clipboard.writeText(String(report));
    showToast("Report copied to clipboard.");
  } catch {
    showToast("Copy failed. Select and copy the report manually.");
  }
});

$("mobileMenu").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
});

topicInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    startResearch();
  }
});