# 0006 · Files: object storage, signed URLs, optional scanning

**Context.** Evidence screenshots and documents are sensitive and user-supplied.

**Decision.** Files go to local disk in development and S3 in production. Uploads are type-checked, size-limited (25 MB) and hashed. Downloads use short-lived signed URLs (HMAC for local, presigned for S3), issued only after a permission check. With `CLAMAV_HOST` set, uploads are scanned and unusable until clean; infected files are deleted and audited. Without a scanner, files are marked "not scanned".

**Consequences.** A leaked link expires in 5 minutes and is bound to one file. Scanning is an opt-in compose profile so local setup stays light.
