// Sends the driver's file with a progress figure, which fetch() cannot report. Failures
// are the same ApiError the rest of the website uses.
import type { ErrorResponse, UploadResponse } from "@trinetra/shared";
import { ApiError } from "../api";

export function sendFile(
  path: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    const unreachable = () => reject(new ApiError(0, "NETWORK_ERROR", "Cannot reach the server."));
    request.onerror = unreachable;
    request.ontimeout = unreachable;
    request.onload = () => {
      const body = request.response as (UploadResponse & Partial<ErrorResponse>) | null;
      if (request.status >= 200 && request.status < 300 && body) return resolve(body);
      const problem = body?.error;
      reject(
        new ApiError(
          request.status,
          problem?.code ?? "SERVER_UNREACHABLE",
          problem?.message ?? "Cannot reach the server.",
        ),
      );
    };
    // A slow site network, but not for ever.
    request.timeout = 120_000;
    request.send(form);
  });
}
