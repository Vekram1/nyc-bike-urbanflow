from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class TimestampRange(BaseModel):
    start: datetime
    end: datetime
