"use strict";

// Stable, non-sensitive public API error taxonomy. Keep the HTTP status and
// legacy `error` message fields unchanged; never expose raw SQL/provider codes.
function publicErrorCode(status){
  switch(status){
    case 400:return "INVALID_REQUEST";
    case 401:return "UNAUTHENTICATED";
    case 403:return "FORBIDDEN";
    case 404:return "NOT_FOUND";
    case 408:return "REQUEST_TIMEOUT";
    case 409:return "CONFLICT";
    case 413:return "PAYLOAD_TOO_LARGE";
    case 422:return "VALIDATION_FAILED";
    case 429:return "RATE_LIMITED";
    case 502:return "UPSTREAM_ERROR";
    case 503:return "SERVICE_UNAVAILABLE";
    case 504:return "UPSTREAM_TIMEOUT";
    default:return status>=500?"INTERNAL_ERROR":"REQUEST_FAILED";
  }
}
module.exports={publicErrorCode};
