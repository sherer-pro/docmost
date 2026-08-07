from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path


JWT = re.compile(rb"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
AUTHORIZATION = re.compile(rb"(?i)(authorization(?:\\?\"|\"|')?\s*[:=]\s*(?:\\?\"|\"|')?bearer\s+)[^\"'\\\s,}]+")
CSRF_COOKIE = re.compile(rb"(?i)(csrfToken=)[A-Fa-f0-9]{32,128}")
CSRF_JSON = re.compile(rb"(?i)((?:csrfToken|x-csrf-token)(?:\\?\"|\"|')?\s*[:=]\s*(?:\\?\"|\"|')?)[A-Fa-f0-9]{32,128}")
CSRF_COOKIE_OBJECT = re.compile(
    rb'(?i)("name":"csrfToken","value":")[^"]+'
)
PASSWORD_JSON = re.compile(rb"(?i)((?:password)(?:\\?\"|\"|')?\s*[:=]\s*(?:\\?\"|\"|')?)[^\"'\\\s,}]+")
WEBSOCKET_FRAME = re.compile(
    rb'("type":"(?:send|receive)"[^\r\n]*?"data":")(?:(?:\\.)|[^"\\])*(")'
)


def sanitize(data: bytes) -> bytes:
    data = JWT.sub(b"[REDACTED_JWT]", data)
    data = AUTHORIZATION.sub(rb"\1[REDACTED]", data)
    data = CSRF_COOKIE.sub(rb"\1[REDACTED]", data)
    data = CSRF_JSON.sub(rb"\1[REDACTED]", data)
    data = CSRF_COOKIE_OBJECT.sub(rb"\1[REDACTED]", data)
    data = WEBSOCKET_FRAME.sub(rb"\1[REDACTED_WEBSOCKET_FRAME]\2", data)
    return PASSWORD_JSON.sub(rb"\1[REDACTED]", data)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: sanitize-trace.py INPUT.zip OUTPUT.zip")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    with zipfile.ZipFile(source, "r") as input_zip, zipfile.ZipFile(
        target,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as output_zip:
        for item in input_zip.infolist():
            output_zip.writestr(item, sanitize(input_zip.read(item.filename)))


if __name__ == "__main__":
    main()
