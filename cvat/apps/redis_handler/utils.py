# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

import importlib
from pathlib import Path

import rq


def get_class_from_module(module_path: str | Path, class_name: str) -> type | None:
    module = importlib.import_module(module_path)
    klass = getattr(module, class_name, None)
    return klass


def get_current_job_current_attempt() -> int:
    job = rq.get_current_job()

    if job is None or job.retry_intervals is None or job.retries_left is None:
        raise ValueError("Current RQ job has no retry configuration")

    max_retry_attempts = len(job.retry_intervals)
    retries_left = job.retries_left
    # NOTE @sosov: first ever attempt is not scored as a "retry" attempt,
    # so on it max_retry_attempts == retries_left; the "+ 1" makes the
    # current overall attempt 1-based.
    return max_retry_attempts - retries_left + 1
