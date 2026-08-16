import { createJobStore, type Job } from "@labforge/jobs";
import { recordAnswer } from "@labforge/orchestrator";

export interface PrepareRequest {
  jobsDir: string;
  jobId: string;
  answer?: string;
}

export function prepareJob(request: PrepareRequest): Job {
  const answering = request.answer !== undefined;
  const job = createJobStore(request.jobsDir).openJob(request.jobId, { create: !answering });

  if (request.answer !== undefined) {
    recordAnswer(job, request.answer);
  }

  return job;
}
