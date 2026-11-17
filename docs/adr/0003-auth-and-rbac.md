# 0003 · Authentication and roles

**Context.** Teams mix QA staff, developers and clients; some clients need more rights in one project than elsewhere.

**Decision.** Better Auth (email/password, Google, Microsoft) with HTTP-only session cookies. Seven roles (Owner, Admin, QA Lead, QA Engineer, Developer, Client, Viewer) with a permission matrix in `@qaforge/shared`. A `ProjectMember` row overrides the organization role inside one project (never for Owners). The permission guard returns **404** to non-members.

**Consequences.** Permission checks are declarative (`@RequirePermission`). The UI checks the organization role only, so an overridden user can see an action the API then refuses (known limitation). Sign-in is rate-limited per IP.
