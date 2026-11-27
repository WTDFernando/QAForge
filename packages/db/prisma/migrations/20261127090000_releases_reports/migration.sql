-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RELEASED');

-- CreateEnum
CREATE TYPE "GateMetric" AS ENUM ('PASS_RATE', 'EXECUTION_COMPLETE', 'OPEN_BUGS', 'REQUIREMENT_COVERAGE', 'HIGH_PRIORITY_COVERAGE', 'AUTOMATION_PASS_RATE');

-- CreateEnum
CREATE TYPE "GateOperator" AS ENUM ('GTE', 'LTE', 'EQ');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('TEST_EXECUTION', 'GO_NO_GO', 'TRACEABILITY_MATRIX', 'BUG_SUMMARY', 'SPRINT_SUMMARY', 'AUTOMATION_TREND');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "release" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "targetDate" TIMESTAMP(3),
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "gateSnapshot" JSONB,
    "requestedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_item" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "requirementId" UUID,
    "bugId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_gate" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "metric" "GateMetric" NOT NULL,
    "operator" "GateOperator" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quality_gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "approverId" UUID NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT NOT NULL DEFAULT '',
    "gateSnapshot" JSONB,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "releaseId" UUID,
    "scheduleId" UUID,
    "type" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "data" JSONB,
    "narrative" JSONB,
    "aiJobId" UUID,
    "shareTokenHash" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedule" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "formats" TEXT[] DEFAULT ARRAY['pdf']::TEXT[],
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "release_projectId_seq_key" ON "release"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "release_projectId_version_key" ON "release"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "release_item_releaseId_requirementId_key" ON "release_item"("releaseId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "release_item_releaseId_bugId_key" ON "release_item"("releaseId", "bugId");

-- CreateIndex
CREATE INDEX "quality_gate_releaseId_idx" ON "quality_gate"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_releaseId_approverId_key" ON "approval"("releaseId", "approverId");

-- CreateIndex
CREATE UNIQUE INDEX "report_shareTokenHash_key" ON "report"("shareTokenHash");

-- CreateIndex
CREATE INDEX "report_projectId_createdAt_idx" ON "report"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "report_schedule_enabled_nextRunAt_idx" ON "report_schedule"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release" ADD CONSTRAINT "release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_item" ADD CONSTRAINT "release_item_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_item" ADD CONSTRAINT "release_item_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_item" ADD CONSTRAINT "release_item_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_gate" ADD CONSTRAINT "quality_gate_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "report_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one scope column is set per release item.
ALTER TABLE "release_item" ADD CONSTRAINT "release_item_one_target" CHECK (num_nonnulls("requirementId", "bugId") = 1);
