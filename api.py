from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional
from uuid import uuid4
from datetime import datetime, timezone
import traceback
import threading

from pipeline import run_research_pipeline

# ============================================================
# FastAPI application & Static File Configuration
# ============================================================

app = FastAPI(
    title="AI Research Assistant API",
    description="Backend API for the Multi-Agent AI Research System",
    version="1.0.0",
)

# Mount the frontend folder so CSS and JS load properly
app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/")
def read_root():
    return FileResponse("frontend/index.html")


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://ai-research-assistance-1.onrender.com",
        "https://ai-research-assistance.onrender.com",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# In-memory job storage
# ============================================================

jobs: Dict[str, Dict[str, Any]] = {}
jobs_lock = threading.Lock()


# ============================================================
# Request / response models
# ============================================================

class ResearchRequest(BaseModel):
    topic: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="Research topic entered by the user",
    )


class ResearchStartResponse(BaseModel):
    job_id: str
    status: str
    message: str


# ============================================================
# Utility functions
# ============================================================

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_json_safe(value: Any) -> Any:
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, dict):
        return {
            str(key): make_json_safe(val)
            for key, val in value.items()
        }

    if isinstance(value, list):
        return [make_json_safe(item) for item in value]

    if hasattr(value, "content"):
        return make_json_safe(value.content)

    return str(value)


def update_job(job_id: str, **updates: Any) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(updates)
            jobs[job_id]["updated_at"] = now_iso()


# ============================================================
# Background research job
# ============================================================

def _run_research_job(job_id: str, topic: str) -> None:
    try:
        update_job(
            job_id,
            status="running",
            progress=5,
            step="Starting",
            message="Starting the multi-agent research pipeline...",
        )

        update_job(
            job_id,
            progress=15,
            step="Search Agent",
            message="Search Agent is finding relevant information...",
        )

        result = run_research_pipeline(topic)

        update_job(
            job_id,
            status="completed",
            progress=100,
            step="Completed",
            message="Research completed successfully.",
            result=make_json_safe(result),
            completed_at=now_iso(),
        )

        print(f"[job {job_id}] research completed successfully")

    except Exception as exc:
        error_message = str(exc)

        print(f"[job {job_id}] pipeline error:")
        traceback.print_exc()

        update_job(
            job_id,
            status="failed",
            progress=100,
            step="Failed",
            message="The research pipeline failed.",
            error=error_message,
            completed_at=now_iso(),
        )


# ============================================================
# Routes
# ============================================================

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": "AI Research Assistant API",
        "timestamp": now_iso(),
    }


@app.post(
    "/api/research",
    response_model=ResearchStartResponse,
)
def start_research(
    request: ResearchRequest,
    background_tasks: BackgroundTasks,
):
    topic = request.topic.strip()

    if not topic:
        raise HTTPException(
            status_code=400,
            detail="Research topic cannot be empty.",
        )

    job_id = str(uuid4())

    with jobs_lock:
        jobs[job_id] = {
            "job_id": job_id,
            "topic": topic,
            "status": "queued",
            "progress": 0,
            "step": "Queued",
            "message": "Research job created.",
            "result": None,
            "error": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "completed_at": None,
        }

    background_tasks.add_task(
        _run_research_job,
        job_id,
        topic,
    )

    return ResearchStartResponse(
        job_id=job_id,
        status="queued",
        message="Research started successfully.",
    )


@app.get("/api/research/{job_id}/status")
def research_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Research job not found.",
        )

    return {
        "job_id": job["job_id"],
        "topic": job["topic"],
        "status": job["status"],
        "progress": job["progress"],
        "step": job["step"],
        "message": job["message"],
        "error": job["error"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "completed_at": job["completed_at"],
    }


@app.get("/api/research/{job_id}/result")
def research_result(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Research job not found.",
        )

    if job["status"] == "failed":
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Research pipeline failed.",
                "error": job["error"],
            },
        )

    if job["status"] != "completed":
        raise HTTPException(
            status_code=409,
            detail="Research is not completed yet.",
        )

    result = job.get("result") or {}

    return {
        "job_id": job["job_id"],
        "topic": job["topic"],
        "status": job["status"],
        "search_results": result.get("search_results"),
        "scraped_content": result.get("scraped_content"),
        "report": result.get("report"),
        "feedback": result.get("feedback"),
    }


@app.get("/api/research")
def list_research_jobs():
    with jobs_lock:
        items = list(jobs.values())

    items.sort(
        key=lambda item: item.get("created_at", ""),
        reverse=True,
    )

    return [
        {
            "job_id": item["job_id"],
            "topic": item["topic"],
            "status": item["status"],
            "progress": item["progress"],
            "step": item["step"],
            "created_at": item["created_at"],
            "completed_at": item["completed_at"],
        }
        for item in items[:20]
    ]


@app.delete("/api/research/{job_id}")
def delete_research(job_id: str):
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(
                status_code=404,
                detail="Research job not found.",
            )

        del jobs[job_id]

    return {
        "message": "Research job deleted successfully.",
        "job_id": job_id,
    }


# ============================================================
# Development entry point
# ============================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )